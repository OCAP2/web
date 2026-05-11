package main

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
	opts := maptoolOptions{Batch: inDir, Out: outDir, Jobs: 2, LogFormat: "json"}
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
