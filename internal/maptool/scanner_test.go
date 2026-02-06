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

	mapData, _ := json.Marshal(map[string]interface{}{
		"name": "altis", "worldSize": 30720,
	})
	require.NoError(t, os.WriteFile(filepath.Join(altisDir, "map.json"), mapData, 0644))
	require.NoError(t, os.WriteFile(filepath.Join(altisDir, "tiles", "satellite.pmtiles"), []byte("fake"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(altisDir, "tiles", "features.pmtiles"), []byte("fake"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(altisDir, "styles", "standard.json"), []byte("{}"), 0644))

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
	require.NoError(t, os.WriteFile(filepath.Join(worldDir, "standard.json"), []byte("{}"), 0644))

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
