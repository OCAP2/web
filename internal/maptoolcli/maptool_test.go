package maptoolcli

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/OCAP2/web/internal/maptool"
	"github.com/OCAP2/web/internal/server"
)

// ---------------------------------------------------------------------------
// parseRenderFlags tests (previously parseMaptoolRenderFlags)
// ---------------------------------------------------------------------------

func TestParseMaptoolRenderFlags_PositionalInput(t *testing.T) {
	opts, err := parseRenderFlags([]string{"altis.zip"})
	require.NoError(t, err)
	assert.Equal(t, "altis.zip", opts.Input)
	assert.Empty(t, opts.Batch)
	assert.Equal(t, 1, opts.Jobs)
	assert.Equal(t, "auto", opts.LogFormat)
}

func TestParseMaptoolRenderFlags_Batch(t *testing.T) {
	opts, err := parseRenderFlags([]string{"--batch", "/tmp/exports", "-j", "4"})
	require.NoError(t, err)
	assert.Empty(t, opts.Input)
	assert.Equal(t, "/tmp/exports", opts.Batch)
	assert.Equal(t, 4, opts.Jobs)
}

func TestParseMaptoolRenderFlags_MutuallyExclusive(t *testing.T) {
	_, err := parseRenderFlags([]string{"--batch", "/tmp/x", "altis.zip"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "cannot be combined")
}

func TestParseMaptoolRenderFlags_NeitherInputNorBatch(t *testing.T) {
	_, err := parseRenderFlags(nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "either provide")
}

func TestParseMaptoolRenderFlags_RejectsBadLogFormat(t *testing.T) {
	_, err := parseRenderFlags([]string{"--log-format", "xml", "x.zip"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "log-format")
}

func TestParseMaptoolRenderFlags_RejectsZeroJobs(t *testing.T) {
	_, err := parseRenderFlags([]string{"-j", "0", "x.zip"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "jobs")
}

func TestParseMaptoolRenderFlags_RejectsUnknownFlag(t *testing.T) {
	_, err := parseRenderFlags([]string{"--unknown-flag", "x.zip"})
	require.Error(t, err)
}

func TestParseMaptoolRenderFlags_RejectsMultiplePositionals(t *testing.T) {
	_, err := parseRenderFlags([]string{"a.zip", "b.zip"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "only one positional")
}

// ---------------------------------------------------------------------------
// enumerateInputs tests
// ---------------------------------------------------------------------------

func TestEnumerateInputs_Single(t *testing.T) {
	dir := t.TempDir()
	zipPath := filepath.Join(dir, "altis.zip")
	require.NoError(t, os.WriteFile(zipPath, []byte("PK"), 0644))

	inputs, err := enumerateInputs(renderOptions{Input: zipPath})
	require.NoError(t, err)
	assert.Equal(t, []string{zipPath}, inputs)
}

func TestEnumerateInputs_SingleMissing(t *testing.T) {
	_, err := enumerateInputs(renderOptions{Input: "/does/not/exist.zip"})
	require.Error(t, err)
}

func TestEnumerateInputs_Batch(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{"altis.zip", "stratis.zip", "readme.txt", "malden.ZIP"} {
		require.NoError(t, os.WriteFile(filepath.Join(dir, name), []byte("x"), 0644))
	}
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "subdir"), 0755))
	require.NoError(t, os.WriteFile(filepath.Join(dir, "subdir", "nope.zip"), []byte("x"), 0644))

	inputs, err := enumerateInputs(renderOptions{Batch: dir})
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
	_, err := enumerateInputs(renderOptions{Batch: dir})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no .zip")
}

func TestEnumerateInputs_BatchDirMissing(t *testing.T) {
	_, err := enumerateInputs(renderOptions{Batch: "/does/not/exist/dir"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "read batch dir")
}

// ---------------------------------------------------------------------------
// fakeRender helper
// ---------------------------------------------------------------------------

// fakeRender lets tests drive the orchestrator without touching the real pipeline.
type fakeRender struct {
	mu        sync.Mutex
	calls     []string
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
		if err := os.MkdirAll(outDir, 0755); err != nil {
			return b.world, err
		}
		if err := os.WriteFile(filepath.Join(outDir, "map.json"), []byte(`{"name":"`+b.world+`"}`), 0644); err != nil {
			return b.world, err
		}
		return b.world, nil
	}
}

// ---------------------------------------------------------------------------
// orchestrate tests
// ---------------------------------------------------------------------------

func TestOrchestrate_BatchSucceedsAndSkipsPreExisting(t *testing.T) {
	inDir := t.TempDir()
	outDir := t.TempDir()

	for _, name := range []string{"a.zip", "b.zip", "c.zip"} {
		require.NoError(t, os.WriteFile(filepath.Join(inDir, name), []byte("x"), 0644))
	}
	// c is already rendered (under its real world name from meta)
	require.NoError(t, os.MkdirAll(filepath.Join(outDir, "world_c"), 0755))
	// also seed outDir/c so the filename-guessed skip kicks in too
	require.NoError(t, os.MkdirAll(filepath.Join(outDir, "c"), 0755))

	fr := &fakeRender{behaviors: map[string]struct {
		world string
		err   error
	}{
		"a.zip": {world: "world_a"},
		"b.zip": {world: "world_b"},
		"c.zip": {world: "world_c"},
	}}

	var buf bytes.Buffer
	opts := renderOptions{Batch: inDir, Out: outDir, Jobs: 2, LogFormat: "json"}
	code := orchestrate(context.Background(), opts, fr.fn(), &buf)
	assert.Equal(t, 0, code)

	_, err := os.Stat(filepath.Join(outDir, "world_a", "map.json"))
	require.NoError(t, err)
	_, err = os.Stat(filepath.Join(outDir, "world_b", "map.json"))
	require.NoError(t, err)
	assert.Len(t, fr.calls, 2, "pre-existing input must not invoke renderer")
}

func TestOrchestrate_FailureSetsExitOne(t *testing.T) {
	inDir := t.TempDir()
	outDir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(inDir, "a.zip"), []byte("x"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(inDir, "b.zip"), []byte("x"), 0644))

	fr := &fakeRender{behaviors: map[string]struct {
		world string
		err   error
	}{
		"a.zip": {world: "world_a"},
		"b.zip": {world: "world_b", err: errors.New("kaboom")},
	}}

	var buf bytes.Buffer
	opts := renderOptions{Batch: inDir, Out: outDir, Jobs: 1, LogFormat: "json"}
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
	opts := renderOptions{Batch: inDir, Out: outDir, Jobs: 2, LogFormat: "json"}
	code := orchestrate(context.Background(), opts, renderFn, &buf)
	assert.Equal(t, 0, code)
	assert.LessOrEqual(t, peak.Load(), int32(2), "peak inflight must not exceed --jobs")
}

// Two inputs whose grad_meh meta.json both report the same world name must be
// rejected: one publishes, the others fail with a clear duplicate error so we
// never silently overwrite a finished world with a sibling's render.
func TestOrchestrate_RejectsDuplicateWorldFromMeta(t *testing.T) {
	inDir := t.TempDir()
	outDir := t.TempDir()
	for _, name := range []string{"export-a.zip", "export-b.zip"} {
		require.NoError(t, os.WriteFile(filepath.Join(inDir, name), []byte("x"), 0644))
	}

	// Both inputs claim the same internal world name ("altis").
	renderFn := func(ctx context.Context, inputZip, outDir string, fm formatter) (string, error) {
		if err := os.MkdirAll(outDir, 0755); err != nil {
			return "", err
		}
		if err := os.WriteFile(filepath.Join(outDir, "map.json"), []byte(`{}`), 0644); err != nil {
			return "", err
		}
		return "altis", nil
	}

	var buf bytes.Buffer
	opts := renderOptions{Batch: inDir, Out: outDir, Jobs: 1, LogFormat: "json"}
	code := orchestrate(context.Background(), opts, renderFn, &buf)
	assert.Equal(t, 1, code)
	assert.Contains(t, buf.String(), "already produced from another input")

	// Exactly one altis output exists; no partial dirs left behind.
	_, err := os.Stat(filepath.Join(outDir, "altis", "map.json"))
	require.NoError(t, err)
	entries, err := os.ReadDir(outDir)
	require.NoError(t, err)
	for _, e := range entries {
		assert.NotContains(t, e.Name(), ".partial-", "partial dirs must be cleaned up")
	}
}

// orchestrate returns 2 when enumerateInputs fails (invalid batch dir).
func TestOrchestrate_InvalidBatchDir_Exit2(t *testing.T) {
	outDir := t.TempDir()
	var buf bytes.Buffer
	opts := renderOptions{Batch: "/does/not/exist/dir", Out: outDir, Jobs: 1, LogFormat: "json"}
	renderFn := func(ctx context.Context, inputZip, partialDir string, fm formatter) (string, error) {
		t.Fatal("render must not be called")
		return "", nil
	}
	code := orchestrate(context.Background(), opts, renderFn, &buf)
	assert.Equal(t, 2, code)
}

// When worldGuess returns "" (file named ".zip"), orchestrate rejects it immediately.
func TestOrchestrate_EmptyGuess_RejectsWithError(t *testing.T) {
	inDir := t.TempDir()
	outDir := t.TempDir()
	// A file named ".zip" has an empty stem after TrimSuffix
	dotZip := filepath.Join(inDir, ".zip")
	require.NoError(t, os.WriteFile(dotZip, []byte("x"), 0644))

	renderFn := func(ctx context.Context, inputZip, partialDir string, fm formatter) (string, error) {
		t.Fatal("render must not be called for a file with empty world guess")
		return "", nil
	}

	var buf bytes.Buffer
	opts := renderOptions{Input: dotZip, Out: outDir, Jobs: 1, LogFormat: "json"}
	code := orchestrate(context.Background(), opts, renderFn, &buf)
	assert.Equal(t, 1, code)
}

// When render returns empty world name, orchestrate falls back to the filename guess.
func TestOrchestrate_EmptyWorldFromRender_FallsBackToGuess(t *testing.T) {
	inDir := t.TempDir()
	outDir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(inDir, "altis.zip"), []byte("x"), 0644))

	renderFn := func(ctx context.Context, inputZip, partialDir string, fm formatter) (string, error) {
		require.NoError(t, os.MkdirAll(partialDir, 0755))
		require.NoError(t, os.WriteFile(filepath.Join(partialDir, "map.json"), []byte(`{}`), 0644))
		return "", nil // empty world name — must fall back to "altis"
	}

	var buf bytes.Buffer
	opts := renderOptions{Batch: inDir, Out: outDir, Jobs: 1, LogFormat: "json"}
	code := orchestrate(context.Background(), opts, renderFn, &buf)
	assert.Equal(t, 0, code)
	_, err := os.Stat(filepath.Join(outDir, "altis", "map.json"))
	require.NoError(t, err)
}

// When render fails and world is empty, summary uses filepath.Base(input) as the name.
func TestOrchestrate_FailureWithEmptyWorld_UsesInputBaseName(t *testing.T) {
	inDir := t.TempDir()
	outDir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(inDir, "altis.zip"), []byte("x"), 0644))

	renderFn := func(ctx context.Context, inputZip, partialDir string, fm formatter) (string, error) {
		return "", errors.New("boom")
	}

	var buf bytes.Buffer
	opts := renderOptions{Batch: inDir, Out: outDir, Jobs: 1, LogFormat: "json"}
	code := orchestrate(context.Background(), opts, renderFn, &buf)
	assert.Equal(t, 1, code)
	// World name is "altis" (derived from filename) so that's what shows in summary
	assert.Contains(t, buf.String(), "altis")
}

// When the rendered world name differs from the filename guess and the final
// dir already exists, the post-render worldClaim returns errSkippedExists.
func TestOrchestrate_PostRenderSkipWhenFinalDirExists(t *testing.T) {
	inDir := t.TempDir()
	outDir := t.TempDir()
	// Input filename is "export.zip" (guess="export"), but render returns "altis"
	require.NoError(t, os.WriteFile(filepath.Join(inDir, "export.zip"), []byte("x"), 0644))
	// Pre-create the "altis" directory so the post-render worldClaim skips it
	require.NoError(t, os.MkdirAll(filepath.Join(outDir, "altis"), 0755))

	renderFn := func(ctx context.Context, inputZip, partialDir string, fm formatter) (string, error) {
		require.NoError(t, os.MkdirAll(partialDir, 0755))
		require.NoError(t, os.WriteFile(filepath.Join(partialDir, "map.json"), []byte(`{}`), 0644))
		return "altis", nil
	}

	var buf bytes.Buffer
	opts := renderOptions{Batch: inDir, Out: outDir, Jobs: 1, LogFormat: "json"}
	code := orchestrate(context.Background(), opts, renderFn, &buf)
	// Skipped is not a failure
	assert.Equal(t, 0, code)
	assert.Contains(t, buf.String(), "skipped")
}

// Two inputs whose filename-stems collide (case-insensitive) must each get a
// unique working partial dir so they cannot clobber each other mid-render.
// The second-in-line fails the worldClaim, but its render dir was distinct.
func TestOrchestrate_UniquePartialDirsForSameGuess(t *testing.T) {
	inDir := t.TempDir()
	outDir := t.TempDir()
	// "altis.zip" and "Altis.zip" both lowercase to "altis".
	require.NoError(t, os.WriteFile(filepath.Join(inDir, "altis.zip"), []byte("x"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(inDir, "Altis.zip"), []byte("x"), 0644))

	var observedPartials sync.Map
	renderFn := func(ctx context.Context, inputZip, outDir string, fm formatter) (string, error) {
		observedPartials.Store(outDir, true)
		// Hold long enough that both goroutines overlap.
		time.Sleep(30 * time.Millisecond)
		if err := os.MkdirAll(outDir, 0755); err != nil {
			return "", err
		}
		if err := os.WriteFile(filepath.Join(outDir, "map.json"), []byte(`{}`), 0644); err != nil {
			return "", err
		}
		// Report distinct real world names per input so the publish step doesn't reject.
		// (Use the case-sensitive basename so altis.zip != Altis.zip.)
		return "w-" + filepath.Base(inputZip), nil
	}

	var buf bytes.Buffer
	opts := renderOptions{Batch: inDir, Out: outDir, Jobs: 2, LogFormat: "json"}
	code := orchestrate(context.Background(), opts, renderFn, &buf)
	assert.Equal(t, 0, code)

	count := 0
	observedPartials.Range(func(_, _ any) bool { count++; return true })
	assert.Equal(t, 2, count, "each input must get a unique partial dir")
}

// ---------------------------------------------------------------------------
// Run tests
// ---------------------------------------------------------------------------

func TestRun_HelpFlag_Exit0(t *testing.T) {
	// Run is a thin wrapper over dispatch(args, defaultDeps()).
	// --help only calls printUsage and returns 0, no real deps exercised.
	code := Run([]string{"--help"})
	assert.Equal(t, 0, code)
}

func TestRun_EmptyArgs_Exit2(t *testing.T) {
	code := Run([]string{})
	assert.Equal(t, 2, code)
}

// ---------------------------------------------------------------------------
// dispatch tests
// ---------------------------------------------------------------------------

func TestDispatch_EmptyArgs_Exit2(t *testing.T) {
	var stdout, stderr bytes.Buffer
	d := fakeDeps(&stdout, &stderr)
	code := dispatch([]string{}, d)
	assert.Equal(t, 2, code)
	assert.Contains(t, stderr.String(), "missing subcommand")
}

func TestDispatch_HelpLong_Exit0(t *testing.T) {
	var stdout, stderr bytes.Buffer
	d := fakeDeps(&stdout, &stderr)
	code := dispatch([]string{"--help"}, d)
	assert.Equal(t, 0, code)
	assert.Contains(t, stdout.String(), "Usage:")
}

func TestDispatch_HelpShort_Exit0(t *testing.T) {
	var stdout, stderr bytes.Buffer
	d := fakeDeps(&stdout, &stderr)
	code := dispatch([]string{"-h"}, d)
	assert.Equal(t, 0, code)
	assert.Contains(t, stdout.String(), "Usage:")
}

func TestDispatch_UnknownSubcommand_Exit2(t *testing.T) {
	var stdout, stderr bytes.Buffer
	d := fakeDeps(&stdout, &stderr)
	code := dispatch([]string{"unknown"}, d)
	assert.Equal(t, 2, code)
	assert.Contains(t, stderr.String(), "unknown maptool subcommand")
}

func TestDispatch_RenderHappyPath_Exit0(t *testing.T) {
	inDir := t.TempDir()
	outDir := t.TempDir()
	zipPath := filepath.Join(inDir, "altis.zip")
	require.NoError(t, os.WriteFile(zipPath, []byte("x"), 0644))

	var stdout, stderr bytes.Buffer
	d := fakeDepsWithRender(&stdout, &stderr, func(_ maptool.ToolSet) renderFunc {
		return func(ctx context.Context, inputZip, partialDir string, fm formatter) (string, error) {
			require.NoError(t, os.MkdirAll(partialDir, 0755))
			require.NoError(t, os.WriteFile(filepath.Join(partialDir, "map.json"), []byte(`{}`), 0644))
			return "altis", nil
		}
	})
	d.detectTools = func() maptool.ToolSet { return maptool.ToolSet{{Name: "pmtiles", Required: true, Found: true}} }

	code := dispatch([]string{"render", "--out", outDir, "--log-format", "json", zipPath}, d)
	assert.Equal(t, 0, code)
}

// ---------------------------------------------------------------------------
// runRender with fake deps tests
// ---------------------------------------------------------------------------

func TestRunRender_BadFlags_Exit2(t *testing.T) {
	var stdout, stderr bytes.Buffer
	d := fakeDeps(&stdout, &stderr)
	code := runRender([]string{"--log-format", "xml", "x.zip"}, d)
	assert.Equal(t, 2, code)
}

func TestRunRender_SettingsFailure_Exit2(t *testing.T) {
	inDir := t.TempDir()
	zipPath := filepath.Join(inDir, "altis.zip")
	require.NoError(t, os.WriteFile(zipPath, []byte("x"), 0644))

	var stdout, stderr bytes.Buffer
	d := fakeDeps(&stdout, &stderr)
	d.loadSettings = func() (server.Setting, error) {
		return server.Setting{}, errors.New("boom settings")
	}
	// No --out, so it will try to load settings
	code := runRender([]string{"--log-format", "json", zipPath}, d)
	assert.Equal(t, 2, code)
	assert.Contains(t, stderr.String(), "settings")
}

func TestRunRender_PreflightFailure_Exit2(t *testing.T) {
	inDir := t.TempDir()
	outDir := t.TempDir()
	zipPath := filepath.Join(inDir, "altis.zip")
	require.NoError(t, os.WriteFile(zipPath, []byte("x"), 0644))

	var stdout, stderr bytes.Buffer
	d := fakeDeps(&stdout, &stderr)
	d.detectTools = func() maptool.ToolSet {
		return maptool.ToolSet{
			{Name: "pmtiles", Required: true, Found: false},
			{Name: "tippecanoe", Required: true, Found: false},
		}
	}
	code := runRender([]string{"--out", outDir, "--log-format", "json", zipPath}, d)
	assert.Equal(t, 2, code)
	assert.Contains(t, stderr.String(), "ghcr.io/ocap2/web:full")
}

func TestRunRender_HappyPath_WithOut_Exit0(t *testing.T) {
	inDir := t.TempDir()
	outDir := t.TempDir()
	zipPath := filepath.Join(inDir, "altis.zip")
	require.NoError(t, os.WriteFile(zipPath, []byte("x"), 0644))

	var stdout, stderr bytes.Buffer
	d := fakeDepsWithRender(&stdout, &stderr, func(_ maptool.ToolSet) renderFunc {
		return func(ctx context.Context, inputZip, partialDir string, fm formatter) (string, error) {
			require.NoError(t, os.MkdirAll(partialDir, 0755))
			require.NoError(t, os.WriteFile(filepath.Join(partialDir, "map.json"), []byte(`{}`), 0644))
			return "altis", nil
		}
	})
	d.detectTools = func() maptool.ToolSet { return maptool.ToolSet{{Name: "pmtiles", Required: true, Found: true}} }

	code := runRender([]string{"--out", outDir, "--log-format", "json", zipPath}, d)
	assert.Equal(t, 0, code)
}

func TestRunRender_HappyPath_OutFromSettings(t *testing.T) {
	inDir := t.TempDir()
	outDir := t.TempDir()
	zipPath := filepath.Join(inDir, "altis.zip")
	require.NoError(t, os.WriteFile(zipPath, []byte("x"), 0644))

	var stdout, stderr bytes.Buffer
	d := fakeDepsWithRender(&stdout, &stderr, func(_ maptool.ToolSet) renderFunc {
		return func(ctx context.Context, inputZip, partialDir string, fm formatter) (string, error) {
			require.NoError(t, os.MkdirAll(partialDir, 0755))
			require.NoError(t, os.WriteFile(filepath.Join(partialDir, "map.json"), []byte(`{}`), 0644))
			return "altis", nil
		}
	})
	d.detectTools = func() maptool.ToolSet { return maptool.ToolSet{{Name: "pmtiles", Required: true, Found: true}} }
	d.loadSettings = func() (server.Setting, error) {
		return server.Setting{Maps: outDir}, nil
	}

	// No --out flag, should fall back to settings.Maps
	code := runRender([]string{"--log-format", "json", zipPath}, d)
	assert.Equal(t, 0, code)
}

// ---------------------------------------------------------------------------
// worldClaim.publish direct unit tests
// ---------------------------------------------------------------------------

func TestWorldClaim_FreshWorld(t *testing.T) {
	dir := t.TempDir()
	finalDir := filepath.Join(dir, "altis")
	c := newWorldClaim()

	called := false
	err := c.publish("altis", finalDir, false, func() error {
		called = true
		return nil
	})
	require.NoError(t, err)
	assert.True(t, called)
	assert.True(t, c.seen["altis"])
}

func TestWorldClaim_SameWorldAgain(t *testing.T) {
	dir := t.TempDir()
	finalDir := filepath.Join(dir, "altis")
	c := newWorldClaim()

	// First publish succeeds
	require.NoError(t, c.publish("altis", finalDir, false, func() error { return nil }))

	// Second publish returns "already produced from another input"
	err := c.publish("altis", finalDir, false, func() error {
		t.Fatal("publishFn must not be called for duplicate world")
		return nil
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "already produced from another input")
}

func TestWorldClaim_FinalDirExists_ForceOff(t *testing.T) {
	dir := t.TempDir()
	finalDir := filepath.Join(dir, "altis")
	require.NoError(t, os.MkdirAll(finalDir, 0755))

	c := newWorldClaim()
	err := c.publish("altis", finalDir, false, func() error {
		t.Fatal("publishFn must not be called when final dir exists and force=false")
		return nil
	})
	assert.Equal(t, errSkippedExists, err)
}

func TestWorldClaim_FinalDirExists_ForceOn(t *testing.T) {
	dir := t.TempDir()
	finalDir := filepath.Join(dir, "altis")
	require.NoError(t, os.MkdirAll(finalDir, 0755))

	c := newWorldClaim()
	callCount := 0
	err := c.publish("altis", finalDir, true, func() error {
		callCount++
		return nil
	})
	require.NoError(t, err)
	assert.Equal(t, 1, callCount)
}

func TestWorldClaim_PublishFnError_NotMarkedSeen(t *testing.T) {
	dir := t.TempDir()
	finalDir := filepath.Join(dir, "altis")
	c := newWorldClaim()

	publishErr := errors.New("publish failed")
	err := c.publish("altis", finalDir, false, func() error {
		return publishErr
	})
	require.ErrorIs(t, err, publishErr)
	// world must NOT be marked as seen when publishFn fails
	assert.False(t, c.seen["altis"])
}

func TestWorldClaim_StatError_NotNotExist(t *testing.T) {
	// Stat a path whose parent is a regular file → ENOTDIR.
	// os.IsNotExist(ENOTDIR) == false, so the "stat final dir" branch fires.
	parent := t.TempDir()
	blocker := filepath.Join(parent, "blocker")
	require.NoError(t, os.WriteFile(blocker, []byte("x"), 0644))
	finalDir := filepath.Join(blocker, "child") // stat error: ENOTDIR

	c := newWorldClaim()
	err := c.publish("altis", finalDir, false, func() error {
		t.Fatal("publishFn must not be called when stat returns a non-NotExist error")
		return nil
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "stat final dir")
}

// ---------------------------------------------------------------------------
// printUsage tests
// ---------------------------------------------------------------------------

func TestPrintUsage_ContainsExpectedContent(t *testing.T) {
	var buf bytes.Buffer
	printUsage(&buf)
	out := buf.String()
	assert.Contains(t, out, "Usage:")
	assert.Contains(t, out, "-o")
	assert.Contains(t, out, "--batch")
	assert.Contains(t, out, "-j")
	assert.Contains(t, out, "--log-format")
	assert.Contains(t, out, "--force")
}

// ---------------------------------------------------------------------------
// worldGuess edge case tests
// ---------------------------------------------------------------------------

func TestWorldGuess_NormalPath(t *testing.T) {
	assert.Equal(t, "altis", worldGuess("/x/altis.zip"))
}

func TestWorldGuess_UppercaseExt(t *testing.T) {
	assert.Equal(t, "altis", worldGuess("/x/Altis.ZIP"))
}

func TestWorldGuess_ZeroStem(t *testing.T) {
	assert.Equal(t, "", worldGuess("/x/.zip"))
}

func TestWorldGuess_EmptyString(t *testing.T) {
	// filepath.Base("") returns ".", so worldGuess returns "." not ""
	assert.Equal(t, ".", worldGuess(""))
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// fakeDeps returns a deps with no-op render, no-op signals, all tools found.
func fakeDeps(stdout, stderr *bytes.Buffer) deps {
	return deps{
		loadSettings: func() (server.Setting, error) {
			return server.Setting{}, nil
		},
		detectTools: func() maptool.ToolSet {
			return maptool.ToolSet{{Name: "pmtiles", Required: true, Found: true}}
		},
		installSignals: func(ctx context.Context) (context.Context, context.CancelFunc) {
			return ctx, func() {}
		},
		render: func(_ maptool.ToolSet) renderFunc {
			return func(ctx context.Context, inputZip, partialDir string, fm formatter) (string, error) {
				return "", errors.New("render not configured in this test")
			}
		},
		stdout: stdout,
		stderr: stderr,
	}
}

// fakeDepsWithRender returns a deps with a custom render factory.
func fakeDepsWithRender(stdout, stderr *bytes.Buffer, render func(maptool.ToolSet) renderFunc) deps {
	d := fakeDeps(stdout, stderr)
	d.render = render
	return d
}
