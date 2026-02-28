package maptool

import (
	"bytes"
	"compress/gzip"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDecompressGz_Valid(t *testing.T) {
	dir := t.TempDir()
	srcPath := filepath.Join(dir, "test.gz")
	dstPath := filepath.Join(dir, "test.txt")

	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	_, err := gz.Write([]byte("hello world"))
	require.NoError(t, err)
	require.NoError(t, gz.Close())
	require.NoError(t, os.WriteFile(srcPath, buf.Bytes(), 0644))

	err = decompressGz(srcPath, dstPath)
	require.NoError(t, err)

	data, err := os.ReadFile(dstPath)
	require.NoError(t, err)
	assert.Equal(t, "hello world", string(data))
}

func TestDecompressGz_MissingFile(t *testing.T) {
	err := decompressGz("/nonexistent/file.gz", filepath.Join(t.TempDir(), "out"))
	require.Error(t, err)
}

func TestDecompressGz_InvalidGzip(t *testing.T) {
	dir := t.TempDir()
	srcPath := filepath.Join(dir, "bad.gz")
	require.NoError(t, os.WriteFile(srcPath, []byte("not gzip"), 0644))

	err := decompressGz(srcPath, filepath.Join(dir, "out"))
	require.Error(t, err)
}

func TestDecompressGz_InvalidOutputPath(t *testing.T) {
	dir := t.TempDir()
	srcPath := filepath.Join(dir, "test.gz")

	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	gz.Write([]byte("data"))
	gz.Close()
	require.NoError(t, os.WriteFile(srcPath, buf.Bytes(), 0644))

	err := decompressGz(srcPath, "/nonexistent/dir/out")
	require.Error(t, err)
}
