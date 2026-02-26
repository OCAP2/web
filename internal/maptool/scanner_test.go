package maptool

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestScanMaps_Complete(t *testing.T) {
	dir := t.TempDir()

	altisDir := filepath.Join(dir, "altis")
	require.NoError(t, os.MkdirAll(filepath.Join(altisDir, "tiles"), 0755))
	require.NoError(t, os.MkdirAll(filepath.Join(altisDir, "styles"), 0755))

	mapData, _ := json.Marshal(map[string]any{
		"name": "altis", "worldSize": 30720,
	})
	require.NoError(t, os.WriteFile(filepath.Join(altisDir, "map.json"), mapData, 0644))
	require.NoError(t, os.WriteFile(filepath.Join(altisDir, "tiles", "satellite.pmtiles"), []byte("fake"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(altisDir, "tiles", "features.pmtiles"), []byte("fake"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(altisDir, "styles", "color-relief.json"), []byte("{}"), 0644))

	maps, err := ScanMaps(dir)
	require.NoError(t, err)
	require.Len(t, maps, 1)
	assert.Equal(t, "altis", maps[0].Name)
	assert.Equal(t, 30720, maps[0].WorldSize)
	assert.Equal(t, MapStatusComplete, maps[0].Status)
}

func TestScanMaps_Incomplete(t *testing.T) {
	dir := t.TempDir()

	// Only map.json, no tiles or styles
	worldDir := filepath.Join(dir, "stratis")
	require.NoError(t, os.MkdirAll(worldDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(worldDir, "map.json"), []byte("{}"), 0644))

	maps, err := ScanMaps(dir)
	require.NoError(t, err)
	require.Len(t, maps, 1)
	assert.Equal(t, MapStatusIncomplete, maps[0].Status)
}

func TestScanMaps_None(t *testing.T) {
	dir := t.TempDir()

	// Empty directory — no generated files
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "empty"), 0755))

	maps, err := ScanMaps(dir)
	require.NoError(t, err)
	require.Len(t, maps, 1)
	assert.Equal(t, MapStatusNone, maps[0].Status)
}

func TestScanMaps_RootFallback(t *testing.T) {
	dir := t.TempDir()

	// Files in root (no tiles/ or styles/ subdirs)
	worldDir := filepath.Join(dir, "tanoa")
	require.NoError(t, os.MkdirAll(worldDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(worldDir, "map.json"), []byte(`{"worldSize":5120}`), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(worldDir, "satellite.pmtiles"), []byte("fake"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(worldDir, "features.pmtiles"), []byte("fake"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(worldDir, "color-relief.json"), []byte("{}"), 0644))

	maps, err := ScanMaps(dir)
	require.NoError(t, err)
	require.Len(t, maps, 1)
	assert.Equal(t, MapStatusComplete, maps[0].Status)
	assert.Equal(t, 5120, maps[0].WorldSize)
}

func TestScanMaps_EmptyDir(t *testing.T) {
	dir := t.TempDir()
	maps, err := ScanMaps(dir)
	require.NoError(t, err)
	assert.Empty(t, maps)
}

func TestScanMaps_NonExistent(t *testing.T) {
	maps, err := ScanMaps("/tmp/nonexistent-dir-12345")
	require.NoError(t, err)
	assert.Nil(t, maps)
}

func TestScanMaps_MetaJSON(t *testing.T) {
	dir := t.TempDir()

	worldDir := filepath.Join(dir, "altis")
	require.NoError(t, os.MkdirAll(worldDir, 0755))

	metaData, _ := json.Marshal(map[string]any{
		"worldSize":     30720,
		"featureLayers": []string{"buildings", "roads", "contours"},
		"elevation": map[string]any{
			"min": 0.0, "max": 350.5, "avg": 42.1, "stddev": 55.3,
		},
	})
	require.NoError(t, os.WriteFile(filepath.Join(worldDir, "meta.json"), metaData, 0644))

	maps, err := ScanMaps(dir)
	require.NoError(t, err)
	require.Len(t, maps, 1)

	assert.Equal(t, 30720, maps[0].WorldSize)
	assert.Equal(t, []string{"buildings", "roads", "contours"}, maps[0].FeatureLayers)
	require.NotNil(t, maps[0].Elevation)
	assert.Equal(t, 0.0, maps[0].Elevation.Min)
	assert.Equal(t, 350.5, maps[0].Elevation.Max)
	assert.Equal(t, 42.1, maps[0].Elevation.Avg)
	assert.Equal(t, 55.3, maps[0].Elevation.StdDev)
}

func TestScanMaps_MapJSONFallback(t *testing.T) {
	dir := t.TempDir()

	worldDir := filepath.Join(dir, "stratis")
	require.NoError(t, os.MkdirAll(worldDir, 0755))

	// No meta.json — only map.json with worldSize
	mapData, _ := json.Marshal(map[string]any{
		"worldSize": 8192,
	})
	require.NoError(t, os.WriteFile(filepath.Join(worldDir, "map.json"), mapData, 0644))

	maps, err := ScanMaps(dir)
	require.NoError(t, err)
	require.Len(t, maps, 1)

	assert.Equal(t, 8192, maps[0].WorldSize)
	// No elevation or featureLayers from map.json
	assert.Nil(t, maps[0].Elevation)
	assert.Nil(t, maps[0].FeatureLayers)
}

func TestScanMaps_Preview(t *testing.T) {
	dir := t.TempDir()

	worldDir := filepath.Join(dir, "altis")
	require.NoError(t, os.MkdirAll(worldDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(worldDir, "preview_256.png"), []byte("fake-png"), 0644))

	maps, err := ScanMaps(dir)
	require.NoError(t, err)
	require.Len(t, maps, 1)

	assert.True(t, maps[0].HasPreview)
}

func TestScanMaps_ExtraFiles(t *testing.T) {
	dir := t.TempDir()

	worldDir := filepath.Join(dir, "altis")
	require.NoError(t, os.MkdirAll(filepath.Join(worldDir, "tiles"), 0755))

	// Write the extra files in tiles/ subdirectory
	require.NoError(t, os.WriteFile(filepath.Join(worldDir, "tiles", "heightmap.pmtiles"), []byte("fake-heightmap"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(worldDir, "tiles", "hillshade.pmtiles"), []byte("fake-hillshade"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(worldDir, "tiles", "color-relief.pmtiles"), []byte("fake-colorrelief"), 0644))

	maps, err := ScanMaps(dir)
	require.NoError(t, err)
	require.Len(t, maps, 1)

	assert.Contains(t, maps[0].Files, "heightmap.pmtiles")
	assert.Contains(t, maps[0].Files, "hillshade.pmtiles")
	assert.Contains(t, maps[0].Files, "color-relief.pmtiles")
}
