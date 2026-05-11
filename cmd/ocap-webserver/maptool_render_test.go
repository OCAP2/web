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
