package maptoolcli

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
