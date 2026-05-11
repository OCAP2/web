# Maptool CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `maptool render` subcommand to the `ocap-webserver` binary that runs the existing grad_meh → tile pipeline from the command line, with single-input and batch modes.

**Architecture:** Pure CLI driver around `internal/maptool/`. No new pipeline stages, no new on-disk formats. The CLI constructs a `maptool.Job` directly, calls `BuildGradMehPipeline(tools).Run(ctx, job)`, and renames a `.partial/` directory to the final `<world>/` on success. Concurrency is provided by a `-j` worker pool that calls the same per-map function in parallel.

**Tech Stack:** Go 1.26, stdlib `flag` package (matches existing `convert` subcommand style), `log/slog` for JSON, `golang.org/x/term` for TTY detection, `testify` for tests.

**Design spec:** `docs/superpowers/specs/2026-05-11-maptool-cli-design.md`

---

## File Structure

| File | Purpose |
|------|---------|
| `cmd/ocap-webserver/main.go` | Modified: dispatch `os.Args[1] == "maptool"` to `runMaptool`. |
| `cmd/ocap-webserver/maptool.go` | New: flag parsing, batch orchestration, summary printing. |
| `cmd/ocap-webserver/maptool_render.go` | New: per-input render function (extract → find → meta → pipeline → atomic rename). |
| `cmd/ocap-webserver/maptool_format.go` | New: text + JSON log formatters implementing a small `formatter` interface. |
| `cmd/ocap-webserver/maptool_test.go` | New: unit tests for flag parsing, input enumeration, skip/force logic, summary aggregation. |
| `cmd/ocap-webserver/maptool_format_test.go` | New: unit tests for both formatters. |
| `cmd/ocap-webserver/maptool_render_test.go` | New: integration test that runs the real pipeline on a fixture grad_meh ZIP. Skipped if tools missing. |

Splitting orchestration / per-map render / formatters into three files keeps each one under ~200 lines and lets the unit tests inject a fake `renderFunc` without dragging in the real pipeline.

---

## Task 1: Subcommand skeleton wired into main

**Files:**
- Modify: `cmd/ocap-webserver/main.go:25-32`
- Create: `cmd/ocap-webserver/maptool.go`

- [ ] **Step 1: Modify `main.go` to dispatch the `maptool` subcommand.**

Add a second subcommand branch immediately after the existing `convert` branch.

Locate this block in `cmd/ocap-webserver/main.go` (around line 25):

```go
if len(os.Args) > 1 && os.Args[1] == "convert" {
    if err := runConvert(os.Args[2:]); err != nil {
        log.Fatalf("convert: %v", err)
    }
    return
}
```

Add immediately after it:

```go
if len(os.Args) > 1 && os.Args[1] == "maptool" {
    if err := runMaptool(os.Args[2:]); err != nil {
        log.Fatalf("maptool: %v", err)
    }
    return
}
```

- [ ] **Step 2: Create `cmd/ocap-webserver/maptool.go` with a flag-parsing stub.**

```go
package main

import (
    "errors"
    "flag"
    "fmt"
    "os"
)

// maptoolOptions holds parsed CLI flags for `maptool render`.
type maptoolOptions struct {
    Input     string // positional input zip (empty if --batch is used)
    Batch     string // directory containing *.zip files
    Out       string // output directory; empty means "use OCAP_MAPS from config"
    Jobs      int
    LogFormat string // "auto" | "text" | "json"
    Force     bool
}

func runMaptool(args []string) error {
    if len(args) == 0 {
        printMaptoolUsage(os.Stderr)
        return errors.New("missing subcommand: expected 'render'")
    }
    switch args[0] {
    case "render":
        return runMaptoolRender(args[1:])
    case "-h", "--help":
        printMaptoolUsage(os.Stdout)
        return nil
    default:
        printMaptoolUsage(os.Stderr)
        return fmt.Errorf("unknown maptool subcommand: %q", args[0])
    }
}

func printMaptoolUsage(w *os.File) {
    fmt.Fprintf(w, "Usage: %s maptool render <input.zip> [flags]\n", os.Args[0])
    fmt.Fprintf(w, "       %s maptool render --batch <dir>  [flags]\n\n", os.Args[0])
    fmt.Fprintf(w, "Flags:\n")
    fmt.Fprintf(w, "  -o, --out <dir>             output directory (default: maps dir from config)\n")
    fmt.Fprintf(w, "      --batch <dir>           render every *.zip in the directory\n")
    fmt.Fprintf(w, "  -j, --jobs <N>              concurrent maps in batch mode (default 1)\n")
    fmt.Fprintf(w, "      --log-format auto|text|json   default: auto (text on TTY, JSON otherwise)\n")
    fmt.Fprintf(w, "      --force                 overwrite an existing <world>/ output directory\n")
}

// parseMaptoolRenderFlags parses the flag set for `maptool render` and validates mutual exclusion.
func parseMaptoolRenderFlags(args []string) (maptoolOptions, error) {
    fs := flag.NewFlagSet("render", flag.ContinueOnError)
    var opts maptoolOptions
    fs.StringVar(&opts.Out, "o", "", "output directory")
    fs.StringVar(&opts.Out, "out", "", "output directory")
    fs.StringVar(&opts.Batch, "batch", "", "directory of *.zip files")
    fs.IntVar(&opts.Jobs, "j", 1, "concurrent maps")
    fs.IntVar(&opts.Jobs, "jobs", 1, "concurrent maps")
    fs.StringVar(&opts.LogFormat, "log-format", "auto", "auto|text|json")
    fs.BoolVar(&opts.Force, "force", false, "overwrite existing output")
    if err := fs.Parse(args); err != nil {
        return opts, err
    }
    rest := fs.Args()

    if opts.Batch != "" && len(rest) > 0 {
        return opts, errors.New("--batch cannot be combined with a positional input")
    }
    if opts.Batch == "" && len(rest) == 0 {
        return opts, errors.New("either provide <input.zip> or --batch <dir>")
    }
    if len(rest) > 1 {
        return opts, errors.New("only one positional input is allowed")
    }
    if len(rest) == 1 {
        opts.Input = rest[0]
    }
    if opts.Jobs < 1 {
        return opts, errors.New("--jobs must be >= 1")
    }
    switch opts.LogFormat {
    case "auto", "text", "json":
    default:
        return opts, fmt.Errorf("--log-format must be auto|text|json, got %q", opts.LogFormat)
    }
    return opts, nil
}

// runMaptoolRender is the entry point for `maptool render`. Filled in by Task 4.
func runMaptoolRender(args []string) error {
    _, err := parseMaptoolRenderFlags(args)
    if err != nil {
        printMaptoolUsage(os.Stderr)
        return err
    }
    return errors.New("not implemented")
}
```

- [ ] **Step 3: Create `cmd/ocap-webserver/maptool_test.go` with parser tests.**

```go
package main

import (
    "testing"

    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/require"
)

func TestParseMaptoolRenderFlags_PositionalInput(t *testing.T) {
    opts, err := parseMaptoolRenderFlags([]string{"altis.zip"})
    require.NoError(t, err)
    assert.Equal(t, "altis.zip", opts.Input)
    assert.Empty(t, opts.Batch)
    assert.Equal(t, 1, opts.Jobs)
    assert.Equal(t, "auto", opts.LogFormat)
}

func TestParseMaptoolRenderFlags_Batch(t *testing.T) {
    opts, err := parseMaptoolRenderFlags([]string{"--batch", "/tmp/exports", "-j", "4"})
    require.NoError(t, err)
    assert.Empty(t, opts.Input)
    assert.Equal(t, "/tmp/exports", opts.Batch)
    assert.Equal(t, 4, opts.Jobs)
}

func TestParseMaptoolRenderFlags_MutuallyExclusive(t *testing.T) {
    _, err := parseMaptoolRenderFlags([]string{"--batch", "/tmp/x", "altis.zip"})
    require.Error(t, err)
    assert.Contains(t, err.Error(), "cannot be combined")
}

func TestParseMaptoolRenderFlags_NeitherInputNorBatch(t *testing.T) {
    _, err := parseMaptoolRenderFlags(nil)
    require.Error(t, err)
    assert.Contains(t, err.Error(), "either provide")
}

func TestParseMaptoolRenderFlags_RejectsBadLogFormat(t *testing.T) {
    _, err := parseMaptoolRenderFlags([]string{"--log-format", "xml", "x.zip"})
    require.Error(t, err)
    assert.Contains(t, err.Error(), "log-format")
}

func TestParseMaptoolRenderFlags_RejectsZeroJobs(t *testing.T) {
    _, err := parseMaptoolRenderFlags([]string{"-j", "0", "x.zip"})
    require.Error(t, err)
    assert.Contains(t, err.Error(), "jobs")
}
```

- [ ] **Step 4: Run the tests to confirm they pass.**

Run: `go test ./cmd/ocap-webserver/ -run TestParseMaptoolRenderFlags -v`
Expected: all 6 tests pass.

- [ ] **Step 5: Verify the binary still builds and the subcommand is reachable.**

Run: `go build -o /tmp/ocap-webserver ./cmd/ocap-webserver && /tmp/ocap-webserver maptool render 2>&1 | head -5`
Expected: stderr contains "Usage:" and "either provide" or similar (no panic, exit non-zero).

- [ ] **Step 6: Commit.**

```bash
git add cmd/ocap-webserver/main.go cmd/ocap-webserver/maptool.go cmd/ocap-webserver/maptool_test.go
git commit -m "feat(cli): scaffold maptool render subcommand with flag parsing"
```

---

## Task 2: Input enumeration

Given a parsed `maptoolOptions`, produce the ordered list of input zip paths to process. Single-input mode returns one entry; batch mode globs `*.zip`.

**Files:**
- Modify: `cmd/ocap-webserver/maptool.go`
- Modify: `cmd/ocap-webserver/maptool_test.go`

- [ ] **Step 1: Write the failing tests first.**

Append to `cmd/ocap-webserver/maptool_test.go`:

```go
import "os"
import "path/filepath"
import "sort"

func TestEnumerateInputs_Single(t *testing.T) {
    dir := t.TempDir()
    zipPath := filepath.Join(dir, "altis.zip")
    require.NoError(t, os.WriteFile(zipPath, []byte("PK"), 0644))

    inputs, err := enumerateInputs(maptoolOptions{Input: zipPath})
    require.NoError(t, err)
    assert.Equal(t, []string{zipPath}, inputs)
}

func TestEnumerateInputs_SingleMissing(t *testing.T) {
    _, err := enumerateInputs(maptoolOptions{Input: "/does/not/exist.zip"})
    require.Error(t, err)
}

func TestEnumerateInputs_Batch(t *testing.T) {
    dir := t.TempDir()
    for _, name := range []string{"altis.zip", "stratis.zip", "readme.txt", "malden.ZIP"} {
        require.NoError(t, os.WriteFile(filepath.Join(dir, name), []byte("x"), 0644))
    }
    require.NoError(t, os.MkdirAll(filepath.Join(dir, "subdir"), 0755))
    require.NoError(t, os.WriteFile(filepath.Join(dir, "subdir", "nope.zip"), []byte("x"), 0644))

    inputs, err := enumerateInputs(maptoolOptions{Batch: dir})
    require.NoError(t, err)
    sort.Strings(inputs)
    assert.Equal(t, []string{
        filepath.Join(dir, "altis.zip"),
        filepath.Join(dir, "malden.ZIP"),
        filepath.Join(dir, "stratis.zip"),
    }, inputs)
}

func TestEnumerateInputs_BatchEmpty(t *testing.T) {
    dir := t.TempDir()
    _, err := enumerateInputs(maptoolOptions{Batch: dir})
    require.Error(t, err)
    assert.Contains(t, err.Error(), "no .zip")
}
```

- [ ] **Step 2: Run tests to confirm they fail (function missing).**

Run: `go test ./cmd/ocap-webserver/ -run TestEnumerateInputs -v`
Expected: compile failure ("undefined: enumerateInputs").

- [ ] **Step 3: Implement `enumerateInputs` in `cmd/ocap-webserver/maptool.go`.**

Append:

```go
import (
    "os"
    "path/filepath"
    "sort"
    "strings"
)

// enumerateInputs returns the absolute paths of all zip files to render, in deterministic order.
func enumerateInputs(opts maptoolOptions) ([]string, error) {
    if opts.Batch != "" {
        entries, err := os.ReadDir(opts.Batch)
        if err != nil {
            return nil, fmt.Errorf("read batch dir: %w", err)
        }
        var inputs []string
        for _, e := range entries {
            if e.IsDir() {
                continue
            }
            if !strings.EqualFold(filepath.Ext(e.Name()), ".zip") {
                continue
            }
            inputs = append(inputs, filepath.Join(opts.Batch, e.Name()))
        }
        if len(inputs) == 0 {
            return nil, fmt.Errorf("no .zip files in %s", opts.Batch)
        }
        sort.Strings(inputs)
        return inputs, nil
    }

    if _, err := os.Stat(opts.Input); err != nil {
        return nil, fmt.Errorf("input: %w", err)
    }
    return []string{opts.Input}, nil
}
```

(The duplicate `import` block in this snippet is illustrative — merge with the existing import block at the top of the file.)

- [ ] **Step 4: Run tests to confirm they pass.**

Run: `go test ./cmd/ocap-webserver/ -run TestEnumerateInputs -v`
Expected: all 4 tests pass.

- [ ] **Step 5: Commit.**

```bash
git add cmd/ocap-webserver/maptool.go cmd/ocap-webserver/maptool_test.go
git commit -m "feat(cli): enumerate single and batch inputs for maptool render"
```

---

## Task 3: Output target resolution and skip / force logic

For each input, compute the final output directory under `--out`, decide whether to skip (already exists) or proceed (force / partial / fresh).

**Files:**
- Modify: `cmd/ocap-webserver/maptool.go`
- Modify: `cmd/ocap-webserver/maptool_test.go`

- [ ] **Step 1: Write the failing tests first.**

Append to `cmd/ocap-webserver/maptool_test.go`:

```go
func TestResolveTarget_Fresh(t *testing.T) {
    out := t.TempDir()
    decision, err := resolveTarget(out, "altis", false)
    require.NoError(t, err)
    assert.Equal(t, targetDecisionProceed, decision.Action)
    assert.Equal(t, filepath.Join(out, "altis"), decision.FinalDir)
    assert.Equal(t, filepath.Join(out, ".altis.partial"), decision.PartialDir)
}

func TestResolveTarget_AlreadyExistsSkip(t *testing.T) {
    out := t.TempDir()
    require.NoError(t, os.MkdirAll(filepath.Join(out, "altis"), 0755))

    decision, err := resolveTarget(out, "altis", false)
    require.NoError(t, err)
    assert.Equal(t, targetDecisionSkip, decision.Action)
}

func TestResolveTarget_AlreadyExistsForce(t *testing.T) {
    out := t.TempDir()
    require.NoError(t, os.MkdirAll(filepath.Join(out, "altis"), 0755))

    decision, err := resolveTarget(out, "altis", true)
    require.NoError(t, err)
    assert.Equal(t, targetDecisionProceed, decision.Action)
}

func TestResolveTarget_PartialDirCleanedBeforeRun(t *testing.T) {
    out := t.TempDir()
    require.NoError(t, os.MkdirAll(filepath.Join(out, ".altis.partial"), 0755))
    require.NoError(t, os.WriteFile(filepath.Join(out, ".altis.partial", "stale.txt"), []byte("x"), 0644))

    _, err := resolveTarget(out, "altis", false)
    require.NoError(t, err)
    _, err = os.Stat(filepath.Join(out, ".altis.partial"))
    assert.True(t, os.IsNotExist(err), "stale partial dir must be removed before render")
}
```

- [ ] **Step 2: Run tests to confirm failure.**

Run: `go test ./cmd/ocap-webserver/ -run TestResolveTarget -v`
Expected: compile failure.

- [ ] **Step 3: Implement target resolution in `maptool.go`.**

Append:

```go
type targetAction int

const (
    targetDecisionProceed targetAction = iota
    targetDecisionSkip
)

type targetDecision struct {
    Action     targetAction
    FinalDir   string
    PartialDir string
}

// resolveTarget computes output paths and decides whether to render or skip.
// It also removes any stale .partial dir from a previous interrupted run, so the
// render stage starts with a clean slate.
func resolveTarget(outDir, world string, force bool) (targetDecision, error) {
    final := filepath.Join(outDir, world)
    partial := filepath.Join(outDir, "."+world+".partial")

    if _, err := os.Stat(final); err == nil {
        if !force {
            return targetDecision{Action: targetDecisionSkip, FinalDir: final, PartialDir: partial}, nil
        }
    } else if !os.IsNotExist(err) {
        return targetDecision{}, fmt.Errorf("stat final dir: %w", err)
    }

    if err := os.RemoveAll(partial); err != nil {
        return targetDecision{}, fmt.Errorf("clean partial dir: %w", err)
    }
    return targetDecision{Action: targetDecisionProceed, FinalDir: final, PartialDir: partial}, nil
}
```

- [ ] **Step 4: Run tests to confirm they pass.**

Run: `go test ./cmd/ocap-webserver/ -run TestResolveTarget -v`
Expected: all 4 tests pass.

- [ ] **Step 5: Commit.**

```bash
git add cmd/ocap-webserver/maptool.go cmd/ocap-webserver/maptool_test.go
git commit -m "feat(cli): resolve maptool output dirs with skip/force decision"
```

---

## Task 4: Log formatters (text and JSON)

Two formatters share a small interface. The orchestration code in later tasks calls these to emit lifecycle events.

**Files:**
- Create: `cmd/ocap-webserver/maptool_format.go`
- Create: `cmd/ocap-webserver/maptool_format_test.go`

- [ ] **Step 1: Write the failing tests first.**

Create `cmd/ocap-webserver/maptool_format_test.go`:

```go
package main

import (
    "bytes"
    "encoding/json"
    "strings"
    "testing"

    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/require"
)

func TestTextFormatter_EmitsLifecycleLines(t *testing.T) {
    var buf bytes.Buffer
    f := newTextFormatter(&buf, false /* no color */)

    f.MapStart("altis", "/in/altis.zip")
    f.Stage("altis", "satellite", 3, 9)
    f.MapDone("altis", "/out/altis")
    f.MapFailed("livonia", "/in/livonia.zip", assertErr("gdalwarp boom"))
    f.MapSkipped("chernarus", "already exists")
    f.Summary(summary{OK: []string{"altis"}, Skipped: []string{"chernarus"}, Failed: map[string]string{"livonia": "gdalwarp boom"}})

    out := buf.String()
    assert.Contains(t, out, "altis")
    assert.Contains(t, out, "satellite")
    assert.Contains(t, out, "livonia")
    assert.Contains(t, out, "gdalwarp boom")
    assert.Contains(t, out, "1 ok / 1 skipped / 1 failed")
}

func TestJSONFormatter_EmitsValidJSONLines(t *testing.T) {
    var buf bytes.Buffer
    f := newJSONFormatter(&buf)

    f.MapStart("altis", "/in/altis.zip")
    f.Stage("altis", "satellite", 3, 9)
    f.MapDone("altis", "/out/altis")
    f.Summary(summary{OK: []string{"altis"}})

    lines := strings.Split(strings.TrimRight(buf.String(), "\n"), "\n")
    require.Len(t, lines, 4)
    for _, line := range lines {
        var v map[string]any
        require.NoError(t, json.Unmarshal([]byte(line), &v), "line: %s", line)
        assert.NotEmpty(t, v["event"])
    }
}

type assertErr string

func (e assertErr) Error() string { return string(e) }
```

- [ ] **Step 2: Run tests to confirm failure.**

Run: `go test ./cmd/ocap-webserver/ -run 'TestTextFormatter|TestJSONFormatter' -v`
Expected: compile failure (types missing).

- [ ] **Step 3: Create `cmd/ocap-webserver/maptool_format.go`.**

```go
package main

import (
    "encoding/json"
    "fmt"
    "io"
    "os"
    "sort"
    "sync"
    "time"

    "golang.org/x/term"
)

// summary aggregates outcomes across all inputs.
type summary struct {
    OK      []string          // world names rendered successfully
    Skipped []string          // world names skipped (already exist)
    Failed  map[string]string // world name -> error message
}

// formatter receives per-map lifecycle events from the orchestration loop.
type formatter interface {
    MapStart(world, input string)
    Stage(world, stage string, num, total int)
    MapDone(world, outDir string)
    MapFailed(world, input string, err error)
    MapSkipped(world, reason string)
    Summary(s summary)
}

// chooseFormatter resolves --log-format auto/text/json against the actual stdout.
func chooseFormatter(mode string, w io.Writer) formatter {
    if mode == "auto" {
        if f, ok := w.(*os.File); ok && term.IsTerminal(int(f.Fd())) {
            mode = "text"
        } else {
            mode = "json"
        }
    }
    if mode == "json" {
        return newJSONFormatter(w)
    }
    color := false
    if f, ok := w.(*os.File); ok {
        color = term.IsTerminal(int(f.Fd()))
    }
    return newTextFormatter(w, color)
}

// ---- text formatter ----

type textFormatter struct {
    mu    sync.Mutex
    w     io.Writer
    color bool
}

func newTextFormatter(w io.Writer, color bool) *textFormatter {
    return &textFormatter{w: w, color: color}
}

func (t *textFormatter) line(format string, args ...any) {
    t.mu.Lock()
    defer t.mu.Unlock()
    fmt.Fprintf(t.w, format+"\n", args...)
}

func (t *textFormatter) MapStart(world, input string) {
    t.line("[%s] start: %s", world, input)
}
func (t *textFormatter) Stage(world, stage string, num, total int) {
    t.line("[%s]   stage %d/%d: %s", world, num, total, stage)
}
func (t *textFormatter) MapDone(world, outDir string) {
    t.line("[%s] done -> %s", world, outDir)
}
func (t *textFormatter) MapFailed(world, input string, err error) {
    t.line("[%s] FAILED: %v", world, err)
}
func (t *textFormatter) MapSkipped(world, reason string) {
    t.line("[%s] skip: %s", world, reason)
}
func (t *textFormatter) Summary(s summary) {
    t.mu.Lock()
    defer t.mu.Unlock()
    fmt.Fprintln(t.w)
    if len(s.OK) > 0 {
        sort.Strings(s.OK)
        fmt.Fprintf(t.w, "Rendered: %s\n", joinNames(s.OK))
    }
    if len(s.Skipped) > 0 {
        sort.Strings(s.Skipped)
        fmt.Fprintf(t.w, "Skipped:  %s\n", joinNames(s.Skipped))
    }
    if len(s.Failed) > 0 {
        names := make([]string, 0, len(s.Failed))
        for name := range s.Failed {
            names = append(names, name)
        }
        sort.Strings(names)
        for _, name := range names {
            fmt.Fprintf(t.w, "Failed:   %s (%s)\n", name, s.Failed[name])
        }
    }
    fmt.Fprintf(t.w, "\n%d ok / %d skipped / %d failed\n", len(s.OK), len(s.Skipped), len(s.Failed))
}

func joinNames(names []string) string {
    out := ""
    for i, n := range names {
        if i > 0 {
            out += ", "
        }
        out += n
    }
    return out
}

// ---- json formatter ----

type jsonFormatter struct {
    mu  sync.Mutex
    enc *json.Encoder
}

func newJSONFormatter(w io.Writer) *jsonFormatter {
    return &jsonFormatter{enc: json.NewEncoder(w)}
}

func (j *jsonFormatter) emit(event string, fields map[string]any) {
    j.mu.Lock()
    defer j.mu.Unlock()
    fields["event"] = event
    fields["ts"] = time.Now().UTC().Format(time.RFC3339Nano)
    _ = j.enc.Encode(fields)
}

func (j *jsonFormatter) MapStart(world, input string) {
    j.emit("map.start", map[string]any{"world": world, "input": input})
}
func (j *jsonFormatter) Stage(world, stage string, num, total int) {
    j.emit("stage", map[string]any{"world": world, "stage": stage, "num": num, "total": total})
}
func (j *jsonFormatter) MapDone(world, outDir string) {
    j.emit("map.done", map[string]any{"world": world, "out": outDir})
}
func (j *jsonFormatter) MapFailed(world, input string, err error) {
    j.emit("map.failed", map[string]any{"world": world, "input": input, "error": err.Error()})
}
func (j *jsonFormatter) MapSkipped(world, reason string) {
    j.emit("map.skipped", map[string]any{"world": world, "reason": reason})
}
func (j *jsonFormatter) Summary(s summary) {
    j.emit("summary", map[string]any{
        "ok":      s.OK,
        "skipped": s.Skipped,
        "failed":  s.Failed,
    })
}
```

- [ ] **Step 4: Add `golang.org/x/term` dependency.**

Run: `go get golang.org/x/term && go mod tidy`
Expected: `go.mod` updated, `go.sum` updated, no errors.

- [ ] **Step 5: Run tests to confirm they pass.**

Run: `go test ./cmd/ocap-webserver/ -run 'TestTextFormatter|TestJSONFormatter' -v`
Expected: both tests pass.

- [ ] **Step 6: Commit.**

```bash
git add cmd/ocap-webserver/maptool_format.go cmd/ocap-webserver/maptool_format_test.go go.mod go.sum
git commit -m "feat(cli): add text and JSON formatters for maptool render"
```

---

## Task 5: Per-map render function

Extract → find grad_meh dir → read meta → run pipeline into partial dir → atomic rename. This is the only step that touches the real pipeline; isolating it into one function keeps later orchestration testable with a fake.

**Files:**
- Create: `cmd/ocap-webserver/maptool_render.go`
- Create: `cmd/ocap-webserver/maptool_render_test.go`

- [ ] **Step 1: Create `cmd/ocap-webserver/maptool_render.go`.**

```go
package main

import (
    "context"
    "fmt"
    "os"
    "path/filepath"

    "github.com/OCAP2/web/internal/maptool"
)

// renderFunc is the per-input rendering callback used by the orchestration loop.
// Returns the resolved world name (used for summary reporting) and an error.
//
// Implementations must:
//   - extract or otherwise resolve the grad_meh directory from inputZip
//   - run the full grad_meh pipeline writing into outDir (no subdirectory under it)
//   - leave outDir on disk on success; leave whatever exists in place on failure
type renderFunc func(ctx context.Context, inputZip, outDir string, fm formatter) (worldName string, err error)

// realRender is the production renderFunc that drives the real pipeline.
func realRender(tools maptool.ToolSet) renderFunc {
    return func(ctx context.Context, inputZip, outDir string, fm formatter) (string, error) {
        extractDir, err := os.MkdirTemp("", "ocap-maptool-cli-")
        if err != nil {
            return "", fmt.Errorf("create extract dir: %w", err)
        }
        defer os.RemoveAll(extractDir)

        if err := maptool.ExtractZip(inputZip, extractDir); err != nil {
            return "", fmt.Errorf("extract zip: %w", err)
        }

        gradMehDir, err := maptool.FindGradMehDir(extractDir)
        if err != nil {
            return "", fmt.Errorf("locate grad_meh dir: %w", err)
        }

        meta, err := maptool.ReadGradMehMeta(gradMehDir)
        if err != nil {
            return "", fmt.Errorf("read grad_meh meta: %w", err)
        }
        world := meta.WorldName

        if err := os.MkdirAll(outDir, 0755); err != nil {
            return world, fmt.Errorf("create output dir: %w", err)
        }
        tempDir, err := os.MkdirTemp("", "ocap-maptool-cli-work-")
        if err != nil {
            return world, fmt.Errorf("create temp dir: %w", err)
        }
        defer os.RemoveAll(tempDir)

        job := &maptool.Job{
            ID:        fmt.Sprintf("cli-%s", world),
            WorldName: world,
            InputPath: gradMehDir,
            OutputDir: outDir,
            TempDir:   tempDir,
            Status:    maptool.StatusPending,
            SubDirs:   true,
        }

        pipeline := maptool.BuildGradMehPipeline(tools)
        pipeline.OnProgress = func(p maptool.Progress) {
            fm.Stage(world, p.Stage, p.StageNum, p.TotalStages)
        }

        job.Start()
        if err := pipeline.Run(ctx, job); err != nil {
            return world, fmt.Errorf("pipeline: %w", err)
        }
        return world, nil
    }
}

// publishPartial atomically renames the partial dir to its final name.
// If the final dir exists (force re-render path), it is removed first.
func publishPartial(partialDir, finalDir string) error {
    if _, err := os.Stat(finalDir); err == nil {
        if err := os.RemoveAll(finalDir); err != nil {
            return fmt.Errorf("remove existing final dir: %w", err)
        }
    } else if !os.IsNotExist(err) {
        return fmt.Errorf("stat final dir: %w", err)
    }
    if err := os.Rename(partialDir, finalDir); err != nil {
        return fmt.Errorf("rename partial -> final: %w", err)
    }
    return nil
}

// preflight reports missing required external tools.
func preflight(tools maptool.ToolSet) error {
    missing := tools.MissingRequired()
    if len(missing) == 0 {
        return nil
    }
    names := make([]string, 0, len(missing))
    for _, t := range missing {
        names = append(names, t.Name)
    }
    return fmt.Errorf("missing required tools: %v\n\n"+
        "Install them locally, or run inside the OCAP full Docker image:\n"+
        "  ghcr.io/ocap2/web:full", names)
}
```

(Note: `maptool.Tool` exposes a `Name` field — verify against `internal/maptool/tools.go` and adjust the field reference if the actual property differs.)

- [ ] **Step 2: Write the publishPartial unit test.**

Create `cmd/ocap-webserver/maptool_render_test.go`:

```go
package main

import (
    "os"
    "path/filepath"
    "testing"

    "github.com/stretchr/testify/assert"
    "github.com/stretchr/testify/require"
)

func TestPublishPartial_Fresh(t *testing.T) {
    base := t.TempDir()
    partial := filepath.Join(base, ".altis.partial")
    final := filepath.Join(base, "altis")
    require.NoError(t, os.MkdirAll(partial, 0755))
    require.NoError(t, os.WriteFile(filepath.Join(partial, "map.json"), []byte("{}"), 0644))

    require.NoError(t, publishPartial(partial, final))

    _, err := os.Stat(partial)
    assert.True(t, os.IsNotExist(err))
    data, err := os.ReadFile(filepath.Join(final, "map.json"))
    require.NoError(t, err)
    assert.Equal(t, "{}", string(data))
}

func TestPublishPartial_OverwritesExisting(t *testing.T) {
    base := t.TempDir()
    partial := filepath.Join(base, ".altis.partial")
    final := filepath.Join(base, "altis")
    require.NoError(t, os.MkdirAll(partial, 0755))
    require.NoError(t, os.WriteFile(filepath.Join(partial, "new.txt"), []byte("new"), 0644))
    require.NoError(t, os.MkdirAll(final, 0755))
    require.NoError(t, os.WriteFile(filepath.Join(final, "old.txt"), []byte("old"), 0644))

    require.NoError(t, publishPartial(partial, final))

    _, err := os.Stat(filepath.Join(final, "old.txt"))
    assert.True(t, os.IsNotExist(err), "old contents must be replaced, not merged")
    data, err := os.ReadFile(filepath.Join(final, "new.txt"))
    require.NoError(t, err)
    assert.Equal(t, "new", string(data))
}
```

- [ ] **Step 3: Verify `maptool.Tool.Name` field name.**

Run: `grep -n "type Tool struct" internal/maptool/tools.go`
If the field is not `Name`, adjust the `preflight` function in `maptool_render.go` accordingly. Re-run `go build ./...` after fixing.

- [ ] **Step 4: Run tests.**

Run: `go build ./... && go test ./cmd/ocap-webserver/ -run TestPublishPartial -v`
Expected: build succeeds, both tests pass.

- [ ] **Step 5: Commit.**

```bash
git add cmd/ocap-webserver/maptool_render.go cmd/ocap-webserver/maptool_render_test.go
git commit -m "feat(cli): per-map renderer with atomic partial->final publish"
```

---

## Task 6: Orchestration loop and worker pool

Wire flag parsing, input enumeration, target resolution, formatter selection, and the worker pool into `runMaptoolRender`. Use an injectable `renderFunc` so tests can drive the loop without the real pipeline.

**Files:**
- Modify: `cmd/ocap-webserver/maptool.go`
- Modify: `cmd/ocap-webserver/maptool_test.go`

- [ ] **Step 1: Write the failing orchestration test.**

Append to `cmd/ocap-webserver/maptool_test.go`:

```go
import (
    "bytes"
    "context"
    "errors"
    "sync"
    "sync/atomic"
)

// fakeRender lets tests drive the orchestrator without touching the real pipeline.
type fakeRender struct {
    mu    sync.Mutex
    calls []string // input zip paths in order observed
    behaviors map[string]struct {
        world string
        err   error
    }
}

func (f *fakeRender) fn() renderFunc {
    return func(ctx context.Context, inputZip, outDir string, fm formatter) (string, error) {
        f.mu.Lock()
        f.calls = append(f.calls, inputZip)
        f.mu.Unlock()
        b := f.behaviors[filepath.Base(inputZip)]
        if b.err != nil {
            return b.world, b.err
        }
        // simulate a successful render by creating the expected partial dir
        if err := os.MkdirAll(outDir, 0755); err != nil {
            return b.world, err
        }
        if err := os.WriteFile(filepath.Join(outDir, "map.json"), []byte(`{"name":"`+b.world+`"}`), 0644); err != nil {
            return b.world, err
        }
        return b.world, nil
    }
}

func TestOrchestrate_BatchSucceedsAndSkipsPreExisting(t *testing.T) {
    inDir := t.TempDir()
    outDir := t.TempDir()

    for _, name := range []string{"a.zip", "b.zip", "c.zip"} {
        require.NoError(t, os.WriteFile(filepath.Join(inDir, name), []byte("x"), 0644))
    }
    // c is already rendered
    require.NoError(t, os.MkdirAll(filepath.Join(outDir, "world_c"), 0755))

    fr := &fakeRender{behaviors: map[string]struct{ world string; err error }{
        "a.zip": {world: "world_a"},
        "b.zip": {world: "world_b"},
        "c.zip": {world: "world_c"},
    }}

    var buf bytes.Buffer
    opts := maptoolOptions{Batch: inDir, Out: outDir, Jobs: 2, LogFormat: "json"}
    code := orchestrate(context.Background(), opts, fr.fn(), &buf)
    assert.Equal(t, 0, code)

    // a and b rendered; c skipped (still exists, was not overwritten)
    _, err := os.Stat(filepath.Join(outDir, "world_a", "map.json"))
    require.NoError(t, err)
    _, err = os.Stat(filepath.Join(outDir, "world_b", "map.json"))
    require.NoError(t, err)
    assert.Len(t, fr.calls, 2, "skipped input must not invoke renderer")
}

func TestOrchestrate_FailureSetsExitOne(t *testing.T) {
    inDir := t.TempDir()
    outDir := t.TempDir()
    require.NoError(t, os.WriteFile(filepath.Join(inDir, "a.zip"), []byte("x"), 0644))
    require.NoError(t, os.WriteFile(filepath.Join(inDir, "b.zip"), []byte("x"), 0644))

    fr := &fakeRender{behaviors: map[string]struct{ world string; err error }{
        "a.zip": {world: "world_a"},
        "b.zip": {world: "world_b", err: errors.New("kaboom")},
    }}

    var buf bytes.Buffer
    opts := maptoolOptions{Batch: inDir, Out: outDir, Jobs: 1, LogFormat: "json"}
    code := orchestrate(context.Background(), opts, fr.fn(), &buf)
    assert.Equal(t, 1, code)
    assert.Contains(t, buf.String(), "kaboom")
    assert.Contains(t, buf.String(), `"event":"summary"`)
}

func TestOrchestrate_ParallelismIsBounded(t *testing.T) {
    inDir := t.TempDir()
    outDir := t.TempDir()
    for i := 0; i < 4; i++ {
        name := fmt.Sprintf("m%d.zip", i)
        require.NoError(t, os.WriteFile(filepath.Join(inDir, name), []byte("x"), 0644))
    }

    var inflight, peak atomic.Int32
    renderFn := func(ctx context.Context, inputZip, outDir string, fm formatter) (string, error) {
        cur := inflight.Add(1)
        for {
            p := peak.Load()
            if cur <= p || peak.CompareAndSwap(p, cur) {
                break
            }
        }
        // hold long enough for parallelism to manifest
        select {
        case <-time.After(20 * time.Millisecond):
        case <-ctx.Done():
        }
        inflight.Add(-1)
        if err := os.MkdirAll(outDir, 0755); err != nil {
            return "", err
        }
        world := strings.TrimSuffix(filepath.Base(inputZip), ".zip")
        return world, nil
    }

    var buf bytes.Buffer
    opts := maptoolOptions{Batch: inDir, Out: outDir, Jobs: 2, LogFormat: "json"}
    code := orchestrate(context.Background(), opts, renderFn, &buf)
    assert.Equal(t, 0, code)
    assert.LessOrEqual(t, peak.Load(), int32(2), "peak inflight must not exceed --jobs")
}
```

(Add `"time"` to the import list if not already present.)

- [ ] **Step 2: Run tests to confirm failure.**

Run: `go test ./cmd/ocap-webserver/ -run TestOrchestrate -v`
Expected: compile failure ("undefined: orchestrate").

- [ ] **Step 3: Implement `orchestrate` and rewire `runMaptoolRender` in `maptool.go`.**

Add to `cmd/ocap-webserver/maptool.go` (and import `"context"`, `"sync"`):

```go
// orchestrate is the testable core of `maptool render`. It returns the exit code.
func orchestrate(ctx context.Context, opts maptoolOptions, render renderFunc, out io.Writer) int {
    fm := chooseFormatter(opts.LogFormat, out)

    inputs, err := enumerateInputs(opts)
    if err != nil {
        fmt.Fprintln(os.Stderr, "error:", err)
        return 2
    }

    if err := os.MkdirAll(opts.Out, 0755); err != nil {
        fmt.Fprintln(os.Stderr, "error: create out dir:", err)
        return 2
    }

    type result struct {
        input  string
        world  string
        err    error
        skipped string // non-empty if skipped, contains reason
    }

    sem := make(chan struct{}, opts.Jobs)
    results := make(chan result, len(inputs))
    var wg sync.WaitGroup

    for _, in := range inputs {
        in := in
        wg.Add(1)
        sem <- struct{}{}
        go func() {
            defer wg.Done()
            defer func() { <-sem }()

            world, decision, err := resolveForInput(in, opts)
            if err != nil {
                results <- result{input: in, err: err}
                return
            }
            if decision.Action == targetDecisionSkip {
                results <- result{input: in, world: world, skipped: "already exists; use --force to re-render"}
                fm.MapSkipped(world, "already exists")
                return
            }
            fm.MapStart(world, in)
            renderedWorld, rerr := render(ctx, in, decision.PartialDir, fm)
            if rerr != nil {
                fm.MapFailed(world, in, rerr)
                results <- result{input: in, world: world, err: rerr}
                return
            }
            // The renderer reads meta.json and reports the real world name.
            // The filename-guessed dir name may differ — recompute the final
            // path to match the real world, and re-check for skip-on-collision.
            finalDir := decision.FinalDir
            if renderedWorld != "" && renderedWorld != world {
                world = renderedWorld
                finalDir = filepath.Join(opts.Out, world)
                if _, err := os.Stat(finalDir); err == nil && !opts.Force {
                    _ = os.RemoveAll(decision.PartialDir)
                    fm.MapSkipped(world, "already exists (renamed from input filename)")
                    results <- result{input: in, world: world, skipped: "already exists"}
                    return
                }
            }
            if err := publishPartial(decision.PartialDir, finalDir); err != nil {
                fm.MapFailed(world, in, err)
                results <- result{input: in, world: world, err: err}
                return
            }
            fm.MapDone(world, finalDir)
            results <- result{input: in, world: world}
        }()
    }
    wg.Wait()
    close(results)

    s := summary{Failed: map[string]string{}}
    for r := range results {
        switch {
        case r.err != nil:
            name := r.world
            if name == "" {
                name = filepath.Base(r.input)
            }
            s.Failed[name] = r.err.Error()
        case r.skipped != "":
            s.Skipped = append(s.Skipped, r.world)
        default:
            s.OK = append(s.OK, r.world)
        }
    }
    fm.Summary(s)

    if len(s.Failed) > 0 {
        return 1
    }
    return 0
}

// resolveForInput maps an input zip path to a (worldGuess, targetDecision) pair
// using the *file name* (without .zip) as a provisional world key. The real
// world name is read from grad_meh meta.json by the renderer; this is just to
// pick a skip / partial path before we extract.
func resolveForInput(inputZip string, opts maptoolOptions) (string, targetDecision, error) {
    world := strings.ToLower(strings.TrimSuffix(filepath.Base(inputZip), filepath.Ext(inputZip)))
    if world == "" {
        return "", targetDecision{}, fmt.Errorf("cannot derive world name from %q", inputZip)
    }
    d, err := resolveTarget(opts.Out, world, opts.Force)
    return world, d, err
}

func runMaptoolRender(args []string) error {
    opts, err := parseMaptoolRenderFlags(args)
    if err != nil {
        printMaptoolUsage(os.Stderr)
        return err
    }
    if opts.Out == "" {
        return errors.New("--out is required (until Task 7 wires the config default)")
    }
    code := orchestrate(context.Background(), opts, nil, os.Stdout)
    if code != 0 {
        os.Exit(code)
    }
    return nil
}
```

Note: `runMaptoolRender` deliberately passes `nil` for `render` here — that path is replaced in Task 7 with the real `realRender(tools)` plus config wiring. Task 6 only exercises orchestrate via tests.

- [ ] **Step 4: Run tests.**

Run: `go test ./cmd/ocap-webserver/ -run TestOrchestrate -v`
Expected: all 3 tests pass.

- [ ] **Step 5: Run the whole package's tests to confirm no regressions.**

Run: `go test ./cmd/ocap-webserver/ -v`
Expected: all tests pass.

- [ ] **Step 6: Commit.**

```bash
git add cmd/ocap-webserver/maptool.go cmd/ocap-webserver/maptool_test.go
git commit -m "feat(cli): orchestration loop with bounded parallelism and summary"
```

---

## Task 7: Wire production renderer, config defaults, preflight, signal handling

The final wiring: read `OCAP_MAPS` from `server.NewSetting()` when `--out` is omitted, run preflight at startup, hook SIGINT/SIGTERM cancellation, plug `realRender(tools)` into the orchestrator.

**Files:**
- Modify: `cmd/ocap-webserver/maptool.go`

- [ ] **Step 1: Replace the `runMaptoolRender` stub with the production version.**

Replace the `runMaptoolRender` function defined in Task 6 with:

```go
import (
    "github.com/OCAP2/web/internal/maptool"
    "github.com/OCAP2/web/internal/server"
    "os/signal"
    "syscall"
)

func runMaptoolRender(args []string) error {
    opts, err := parseMaptoolRenderFlags(args)
    if err != nil {
        printMaptoolUsage(os.Stderr)
        return err
    }

    if opts.Out == "" {
        setting, err := server.NewSetting()
        if err != nil {
            return fmt.Errorf("settings: %w", err)
        }
        opts.Out = setting.Maps
    }

    tools := maptool.DetectTools()
    if err := preflight(tools); err != nil {
        return err
    }

    ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
    defer stop()

    code := orchestrate(ctx, opts, realRender(tools), os.Stdout)
    if code != 0 {
        os.Exit(code)
    }
    return nil
}
```

Note: `signal.NotifyContext` cancels `ctx` on SIGINT/SIGTERM. `pipeline.Run` already respects context cancellation (see `internal/maptool/pipeline.go`), so in-flight maps will abort at the next stage boundary and the worker pool will drain naturally.

- [ ] **Step 2: Build and smoke-test the binary.**

Run: `go build -o /tmp/ocap-webserver ./cmd/ocap-webserver`
Expected: builds cleanly.

Run: `/tmp/ocap-webserver maptool render --help 2>&1; /tmp/ocap-webserver maptool render 2>&1 | head -3`
Expected: usage / error messages print without panic.

- [ ] **Step 3: Run the whole package test suite.**

Run: `go test ./cmd/ocap-webserver/ -v`
Expected: all tests pass.

- [ ] **Step 4: Run the whole module test suite to confirm no regression in `internal/maptool/` or `internal/server/`.**

Run: `go test ./...`
Expected: no failures from our changes. Pre-existing test failures (if any) are out of scope.

- [ ] **Step 5: Commit.**

```bash
git add cmd/ocap-webserver/maptool.go
git commit -m "feat(cli): wire maptool render with config defaults, preflight, signals"
```

---

## Task 8: End-to-end integration test against a real grad_meh fixture

This is the only test that runs the actual rendering pipeline. It is the safety net that catches regressions in pipeline integration (Job field plumbing, OnProgress wiring, atomic publish under real files). It is skipped automatically if external tools are missing — CI without the `full` image will skip cleanly.

**Files:**
- Modify: `cmd/ocap-webserver/maptool_render_test.go`

- [ ] **Step 1: Locate a usable grad_meh fixture in the repo.**

Run: `find . -name 'meta.json' -path '*/testdata/*' 2>/dev/null; find . -type d -name 'sat' 2>/dev/null | head -5`

If a fixture exists under `internal/maptool/testdata/`, note its path. If not, this task is reduced to a TODO and skipped — see Step 4.

- [ ] **Step 2: Append the integration test.**

Append to `cmd/ocap-webserver/maptool_render_test.go`:

```go
import (
    "context"
    "os/exec"
    "testing"

    "github.com/OCAP2/web/internal/maptool"
)

// TestRealRender_EndToEnd renders a small grad_meh fixture through the full
// pipeline. It is skipped if any required external tool is missing.
func TestRealRender_EndToEnd(t *testing.T) {
    // Locate fixture. Adjust the path to whatever exists in the repo.
    // If no fixture exists, skip.
    fixtureZip := os.Getenv("OCAP_MAPTOOL_FIXTURE_ZIP")
    if fixtureZip == "" {
        t.Skip("set OCAP_MAPTOOL_FIXTURE_ZIP to a grad_meh export to run this test")
    }
    if _, err := os.Stat(fixtureZip); err != nil {
        t.Skipf("fixture %s not available: %v", fixtureZip, err)
    }

    tools := maptool.DetectTools()
    if missing := tools.MissingRequired(); len(missing) > 0 {
        names := []string{}
        for _, m := range missing {
            names = append(names, m.Name)
        }
        t.Skipf("missing tools: %v", names)
    }

    out := t.TempDir()
    fm := newJSONFormatter(io.Discard)
    world, err := realRender(tools)(context.Background(), fixtureZip, filepath.Join(out, ".partial"), fm)
    require.NoError(t, err)
    assert.NotEmpty(t, world)

    // map.json should exist in the partial dir
    _, err = os.Stat(filepath.Join(out, ".partial", "map.json"))
    require.NoError(t, err, "pipeline must produce map.json")

    // exec is referenced to ensure the import is used in some paths;
    // remove if not needed.
    _ = exec.Command
}
```

(Trim the `exec` reference if your linter flags it; the production code already imports everything it needs.)

- [ ] **Step 3: Run the test.**

Run: `go test ./cmd/ocap-webserver/ -run TestRealRender_EndToEnd -v`
Expected: SKIP if `OCAP_MAPTOOL_FIXTURE_ZIP` is unset or tools are missing.
If a fixture is set and tools are present, the test must pass.

- [ ] **Step 4: Commit.**

```bash
git add cmd/ocap-webserver/maptool_render_test.go
git commit -m "test(cli): end-to-end maptool render against grad_meh fixture (skipped without env)"
```

---

## Final verification

- [ ] **Step 1: Full build.**

Run: `go build ./...`
Expected: success.

- [ ] **Step 2: Full test suite.**

Run: `go test ./...`
Expected: no new failures.

- [ ] **Step 3: Smoke test the help.**

Run: `go run ./cmd/ocap-webserver maptool render --help 2>&1 | head -10`
Expected: usage prints, lists `--out`, `--batch`, `--jobs`, `--log-format`, `--force`.

- [ ] **Step 4: Manual smoke test against a real grad_meh export (developer-local).**

If you have a real export and the tools installed:

```bash
go run ./cmd/ocap-webserver maptool render path/to/altis.zip -o /tmp/maps
ls /tmp/maps/altis
```

Expected: directory contains `map.json`, `tiles/*.pmtiles`, `styles/*.json`, etc. — same layout the UI upload produces.

- [ ] **Step 5: Documentation update (CLAUDE.md only, no README).**

Append a one-line note to `CLAUDE.md` under "Build Commands" or a new "CLI Subcommands" section pointing at `ocap-webserver maptool render --help`. Keep it terse — no full usage docs in CLAUDE.md.

```bash
git add CLAUDE.md
git commit -m "docs(cli): note maptool render subcommand in CLAUDE.md"
```

---

## Out of scope (deferred per spec)

- `--zip` rendered bundle output
- `--only <stage>` selective re-render
- `--docker` re-exec into the full image
- Resume / per-map completion-state tracking
