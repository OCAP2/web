package precompresscli

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/OCAP2/web/internal/server"
	"github.com/OCAP2/web/internal/storage"
)

func testDeps(stdout, stderr *bytes.Buffer) deps {
	return deps{
		loadSettings: func() (server.Setting, error) { return server.Setting{}, nil },
		stdout:       stdout,
		stderr:       stderr,
	}
}

// legacyRecording lays out a recording the way it looks on disk after a
// conversion that predates precompression: raw artifacts, no sidecars.
func legacyRecording(t *testing.T, root, name string) []string {
	t.Helper()
	dir := filepath.Join(root, name)
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "chunks"), 0755))

	payload := bytes.Repeat([]byte("entity frame state "), 4096)
	paths := []string{
		filepath.Join(dir, "manifest.pb"),
		filepath.Join(dir, "chunks", "0000.pb"),
		filepath.Join(dir, "chunks", "0001.pb"),
	}
	for _, p := range paths {
		require.NoError(t, os.WriteFile(p, payload, 0644))
	}
	return paths
}

func run1(t *testing.T, args ...string) (int, string, string) {
	t.Helper()
	var stdout, stderr bytes.Buffer
	code := run(args, testDeps(&stdout, &stderr))
	return code, stdout.String(), stderr.String()
}

func TestRun_BackfillsLegacyRecording(t *testing.T) {
	root := t.TempDir()
	paths := legacyRecording(t, root, "old_mission")

	code, stdout, stderr := run1(t, "--data", root)

	require.Equal(t, 0, code, "stderr: %s", stderr)
	assert.Contains(t, stdout, "artifacts scanned : 3")
	assert.Contains(t, stdout, "sidecars written  : 3")

	for _, p := range paths {
		for _, coding := range storage.PrecompressEncodings {
			sidecar := p + storage.PrecompressSuffix[coding]
			info, err := os.Stat(sidecar)
			require.NoError(t, err, "%s written", sidecar)
			raw, err := os.Stat(p)
			require.NoError(t, err)
			assert.Less(t, info.Size(), raw.Size())
		}
	}
}

// The backfill must not touch the artifacts themselves — only add files beside
// them. A rewritten .pb would churn mtimes and, worse, risk corrupting data the
// server is mid-read on.
func TestRun_LeavesArtifactsUntouched(t *testing.T) {
	root := t.TempDir()
	paths := legacyRecording(t, root, "old_mission")

	before := make(map[string][]byte)
	beforeMod := make(map[string]time.Time)
	for _, p := range paths {
		data, err := os.ReadFile(p)
		require.NoError(t, err)
		before[p] = data
		info, err := os.Stat(p)
		require.NoError(t, err)
		beforeMod[p] = info.ModTime()
	}

	code, _, stderr := run1(t, "--data", root)
	require.Equal(t, 0, code, "stderr: %s", stderr)

	for _, p := range paths {
		data, err := os.ReadFile(p)
		require.NoError(t, err)
		assert.Equal(t, before[p], data, "artifact bytes unchanged")
		info, err := os.Stat(p)
		require.NoError(t, err)
		assert.Equal(t, beforeMod[p], info.ModTime(), "artifact mtime unchanged")
	}
}

func TestRun_DryRunWritesNothing(t *testing.T) {
	root := t.TempDir()
	paths := legacyRecording(t, root, "old_mission")

	code, stdout, stderr := run1(t, "--data", root, "--dry-run")

	require.Equal(t, 0, code, "stderr: %s", stderr)
	assert.Contains(t, stdout, "would write")
	for _, p := range paths {
		for _, coding := range storage.PrecompressEncodings {
			_, err := os.Stat(p + storage.PrecompressSuffix[coding])
			assert.ErrorIs(t, err, os.ErrNotExist)
		}
	}
}

func TestRun_IsIdempotent(t *testing.T) {
	root := t.TempDir()
	legacyRecording(t, root, "old_mission")

	code, _, _ := run1(t, "--data", root)
	require.Equal(t, 0, code)

	code, stdout, _ := run1(t, "--data", root)
	require.Equal(t, 0, code)
	assert.Contains(t, stdout, "sidecars written  : 0")
	assert.Contains(t, stdout, "already current   : 3")
}

func TestRun_ForceRewritesCurrentSidecars(t *testing.T) {
	root := t.TempDir()
	legacyRecording(t, root, "old_mission")

	require.Equal(t, 0, func() int { c, _, _ := run1(t, "--data", root); return c }())

	code, stdout, _ := run1(t, "--data", root, "--force")
	require.Equal(t, 0, code)
	assert.Contains(t, stdout, "sidecars written  : 3")
}

// A sidecar older than its artifact is what the server treats as stale, so the
// backfill has to consider it missing and rebuild it.
func TestRun_RebuildsStaleSidecars(t *testing.T) {
	root := t.TempDir()
	paths := legacyRecording(t, root, "old_mission")

	require.Equal(t, 0, func() int { c, _, _ := run1(t, "--data", root); return c }())

	stale := time.Now().Add(-2 * time.Hour)
	for _, coding := range storage.PrecompressEncodings {
		require.NoError(t, os.Chtimes(paths[0]+storage.PrecompressSuffix[coding], stale, stale))
	}

	code, stdout, _ := run1(t, "--data", root)
	require.Equal(t, 0, code)
	assert.Contains(t, stdout, "sidecars written  : 1")
	assert.Contains(t, stdout, "already current   : 2")

	for _, coding := range storage.PrecompressEncodings {
		info, err := os.Stat(paths[0] + storage.PrecompressSuffix[coding])
		require.NoError(t, err)
		assert.True(t, info.ModTime().After(stale), "sidecar rebuilt")
	}
}

// Sidecars must not themselves be treated as artifacts, or a second run would
// produce manifest.pb.zst.zst.
func TestRun_DoesNotRecurseIntoSidecars(t *testing.T) {
	root := t.TempDir()
	paths := legacyRecording(t, root, "old_mission")

	require.Equal(t, 0, func() int { c, _, _ := run1(t, "--data", root); return c }())
	require.Equal(t, 0, func() int { c, _, _ := run1(t, "--data", root); return c }())

	for _, coding := range storage.PrecompressEncodings {
		nested := paths[0] + storage.PrecompressSuffix[coding] + storage.PrecompressSuffix[coding]
		_, err := os.Stat(nested)
		assert.ErrorIs(t, err, os.ErrNotExist, "no sidecar of a sidecar")
	}
}

func TestRun_IgnoresNonProtobufFiles(t *testing.T) {
	root := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(root, "recording.json.gz"),
		bytes.Repeat([]byte("json"), 2048), 0644))

	code, stdout, _ := run1(t, "--data", root)

	require.Equal(t, 0, code)
	assert.Contains(t, stdout, "artifacts scanned : 0")
	_, err := os.Stat(filepath.Join(root, "recording.json.gz.zst"))
	assert.ErrorIs(t, err, os.ErrNotExist, "legacy JSON uploads are left alone")
}

func TestRun_MissingDataDir(t *testing.T) {
	code, _, stderr := run1(t, "--data", filepath.Join(t.TempDir(), "nope"))
	assert.Equal(t, 1, code)
	assert.Contains(t, stderr, "is not a directory")
}

func TestRun_NoDataDirConfigured(t *testing.T) {
	var stdout, stderr bytes.Buffer
	code := run(nil, testDeps(&stdout, &stderr))
	assert.Equal(t, 1, code)
	assert.Contains(t, stderr.String(), "no data directory configured")
}

func TestRun_BadFlag(t *testing.T) {
	code, _, _ := run1(t, "--nope")
	assert.Equal(t, 2, code)
}

func TestHumanBytes(t *testing.T) {
	assert.Equal(t, "512 B", humanBytes(512))
	assert.Equal(t, "1.0 KB", humanBytes(1024))
	assert.Equal(t, "2.5 MB", humanBytes(2621440))
}
