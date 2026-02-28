package maptool

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRestyleWorld_MissingMeta(t *testing.T) {
	mapsDir := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(mapsDir, "testworld"), 0755))

	err := RestyleWorld(mapsDir, "testworld")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "read meta.json")
}

func TestRestyleWorld_InvalidJSON(t *testing.T) {
	mapsDir := t.TempDir()
	worldDir := filepath.Join(mapsDir, "testworld")
	require.NoError(t, os.MkdirAll(worldDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(worldDir, "meta.json"), []byte("{invalid"), 0644))

	err := RestyleWorld(mapsDir, "testworld")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "parse meta.json")
}

func TestRestyleWorld_EmptyFeatureLayers(t *testing.T) {
	mapsDir := t.TempDir()
	worldDir := filepath.Join(mapsDir, "testworld")
	require.NoError(t, os.MkdirAll(worldDir, 0755))

	meta := map[string]any{
		"worldName":     "testworld",
		"featureLayers": []string{},
	}
	data, _ := json.Marshal(meta)
	require.NoError(t, os.WriteFile(filepath.Join(worldDir, "meta.json"), data, 0644))

	err := RestyleWorld(mapsDir, "testworld")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no featureLayers")
}

func TestRestyleWorld_StylesDirMkdirError(t *testing.T) {
	mapsDir := t.TempDir()
	worldDir := filepath.Join(mapsDir, "testworld")
	require.NoError(t, os.MkdirAll(worldDir, 0755))

	meta := map[string]any{
		"worldName":     "testworld",
		"featureLayers": []string{"house"},
	}
	data, _ := json.Marshal(meta)
	require.NoError(t, os.WriteFile(filepath.Join(worldDir, "meta.json"), data, 0644))

	// Block styles/ by placing a file where it should be a directory
	require.NoError(t, os.WriteFile(filepath.Join(worldDir, "styles"), []byte("blocker"), 0644))

	err := RestyleWorld(mapsDir, "testworld")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "create styles dir")
}

func TestRestyleWorld_ProbesTileFiles(t *testing.T) {
	mapsDir := t.TempDir()
	worldDir := filepath.Join(mapsDir, "testworld")
	tilesDir := filepath.Join(worldDir, "tiles")
	require.NoError(t, os.MkdirAll(tilesDir, 0755))

	meta := worldMetaJSON{
		WorldName:     "testworld",
		DisplayName:   "Test World",
		WorldSize:     256,
		FeatureLayers: []string{"house"},
	}
	data, _ := json.MarshalIndent(meta, "", "  ")
	require.NoError(t, os.WriteFile(filepath.Join(worldDir, "meta.json"), data, 0644))

	// Only create satellite — no other pmtiles
	require.NoError(t, os.WriteFile(filepath.Join(tilesDir, "satellite.pmtiles"), []byte("dummy"), 0644))

	err := RestyleWorld(mapsDir, "testworld")
	require.NoError(t, err)

	// Should have generated styles
	for _, name := range []string{"topo.json", "topo-dark.json", "topo-relief.json", "color-relief.json"} {
		info, err := os.Stat(filepath.Join(worldDir, "styles", name))
		require.NoError(t, err, "expected %s to exist", name)
		assert.Greater(t, info.Size(), int64(0))
	}

	// Should have generated sprites
	for _, name := range []string{"sprite.json", "sprite.png", "sprite-dark.json", "sprite-dark.png"} {
		_, err := os.Stat(filepath.Join(worldDir, "styles", name))
		assert.NoError(t, err, "expected %s to exist", name)
	}
}
