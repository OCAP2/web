package maptool

import (
	"archive/zip"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// createTestZip builds a ZIP file in memory and writes it to disk.
// Each entry is a path → content pair. Paths ending with "/" are directories.
func createTestZip(t *testing.T, dir string, entries map[string]string) string {
	t.Helper()
	zipPath := filepath.Join(dir, "test.zip")
	f, err := os.Create(zipPath)
	require.NoError(t, err)
	defer f.Close()

	w := zip.NewWriter(f)
	for name, content := range entries {
		fw, err := w.Create(name)
		require.NoError(t, err)
		_, err = fw.Write([]byte(content))
		require.NoError(t, err)
	}
	require.NoError(t, w.Close())
	return zipPath
}

// setupGradMehDir creates a valid grad_meh directory (meta.json + sat/).
func setupGradMehDir(t *testing.T, dir string) {
	t.Helper()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "meta.json"), []byte(`{}`), 0644))
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "sat"), 0755))
}

// --- ExtractZip tests ---

func TestExtractZip_NormalExtraction(t *testing.T) {
	srcDir := t.TempDir()
	zipPath := createTestZip(t, srcDir, map[string]string{
		"subdir/":        "",
		"subdir/file.txt": "hello world",
		"root.txt":       "root content",
	})

	targetDir := t.TempDir()
	err := ExtractZip(zipPath, targetDir)
	require.NoError(t, err)

	// Verify extracted files
	content, err := os.ReadFile(filepath.Join(targetDir, "root.txt"))
	require.NoError(t, err)
	assert.Equal(t, "root content", string(content))

	content, err = os.ReadFile(filepath.Join(targetDir, "subdir", "file.txt"))
	require.NoError(t, err)
	assert.Equal(t, "hello world", string(content))

	// Verify directory was created
	info, err := os.Stat(filepath.Join(targetDir, "subdir"))
	require.NoError(t, err)
	assert.True(t, info.IsDir())
}

func TestExtractZip_ZipSlipRejected(t *testing.T) {
	// Build a ZIP with a malicious path manually using zip.FileHeader
	srcDir := t.TempDir()
	zipPath := filepath.Join(srcDir, "malicious.zip")
	f, err := os.Create(zipPath)
	require.NoError(t, err)

	w := zip.NewWriter(f)
	header := &zip.FileHeader{
		Name:   "../../../etc/passwd",
		Method: zip.Deflate,
	}
	fw, err := w.CreateHeader(header)
	require.NoError(t, err)
	_, err = fw.Write([]byte("malicious content"))
	require.NoError(t, err)
	require.NoError(t, w.Close())
	require.NoError(t, f.Close())

	targetDir := t.TempDir()
	err = ExtractZip(zipPath, targetDir)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "illegal file path")
}

func TestExtractZip_EmptyZip(t *testing.T) {
	srcDir := t.TempDir()
	zipPath := createTestZip(t, srcDir, map[string]string{})

	targetDir := t.TempDir()
	err := ExtractZip(zipPath, targetDir)
	require.NoError(t, err)

	// Target dir should exist but be empty (besides . and ..)
	entries, err := os.ReadDir(targetDir)
	require.NoError(t, err)
	assert.Empty(t, entries)
}

func TestExtractZip_InvalidZipFile(t *testing.T) {
	srcDir := t.TempDir()
	badPath := filepath.Join(srcDir, "notazip.zip")
	require.NoError(t, os.WriteFile(badPath, []byte("this is not a zip file"), 0644))

	targetDir := t.TempDir()
	err := ExtractZip(badPath, targetDir)
	require.Error(t, err)
}

// --- FindGradMehDir tests ---

func TestFindGradMehDir_ValidAtRoot(t *testing.T) {
	dir := t.TempDir()
	setupGradMehDir(t, dir)

	found, err := FindGradMehDir(dir)
	require.NoError(t, err)
	assert.Equal(t, dir, found)
}

func TestFindGradMehDir_ValidOneLevelDeep(t *testing.T) {
	dir := t.TempDir()
	subDir := filepath.Join(dir, "world_export")
	require.NoError(t, os.MkdirAll(subDir, 0755))
	setupGradMehDir(t, subDir)

	found, err := FindGradMehDir(dir)
	require.NoError(t, err)
	assert.Equal(t, subDir, found)
}

func TestFindGradMehDir_NoValidDir(t *testing.T) {
	dir := t.TempDir()
	// Create a subdirectory without meta.json or sat/
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "empty_sub"), 0755))

	_, err := FindGradMehDir(dir)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no directory with meta.json and sat/ found")
}

func TestFindGradMehDir_SkipsFiles(t *testing.T) {
	dir := t.TempDir()
	// Regular file at top level — should be skipped
	require.NoError(t, os.WriteFile(filepath.Join(dir, "readme.txt"), []byte("hi"), 0644))
	// Valid grad_meh dir one level deep
	subDir := filepath.Join(dir, "export")
	require.NoError(t, os.MkdirAll(subDir, 0755))
	setupGradMehDir(t, subDir)

	found, err := FindGradMehDir(dir)
	require.NoError(t, err)
	assert.Equal(t, subDir, found)
}

func TestFindGradMehDir_NonexistentDirectory(t *testing.T) {
	_, err := FindGradMehDir("/nonexistent/path/that/does/not/exist")
	require.Error(t, err)
}
