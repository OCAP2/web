package main

import (
	"os"
	"path/filepath"
	"sort"
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
