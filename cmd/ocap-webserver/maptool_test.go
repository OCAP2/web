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
