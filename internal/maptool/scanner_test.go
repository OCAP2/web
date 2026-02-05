package maptool

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestScanMaps(t *testing.T) {
	dir := t.TempDir()

	// Create a complete map
	altisDir := filepath.Join(dir, "altis")
	require.NoError(t, os.MkdirAll(altisDir, 0755))
	mapData, _ := json.Marshal(map[string]interface{}{
		"name": "altis", "worldSize": 30720,
	})
	require.NoError(t, os.WriteFile(filepath.Join(altisDir, "map.json"), mapData, 0644))
	require.NoError(t, os.WriteFile(filepath.Join(altisDir, "topo.pmtiles"), []byte("fake"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(altisDir, "style.json"), []byte("{}"), 0644))

	// Create an incomplete map (no pmtiles)
	stratisDir := filepath.Join(dir, "stratis")
	require.NoError(t, os.MkdirAll(stratisDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(stratisDir, "map.json"), []byte("{}"), 0644))

	maps, err := ScanMaps(dir)
	require.NoError(t, err)
	assert.Len(t, maps, 2)

	var altis *MapInfo
	for i := range maps {
		if maps[i].Name == "altis" {
			altis = &maps[i]
		}
	}
	require.NotNil(t, altis)
	assert.True(t, altis.HasPMTiles)
	assert.True(t, altis.HasStyle)
	assert.Equal(t, 30720, altis.WorldSize)
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
