package maptool

import (
	"image/png"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestEncodeTerrainRGB(t *testing.T) {
	grid := &DEMGrid{
		Cols:     4,
		Rows:     4,
		CellSize: 10.0,
		Data:     make([]float32, 16),
	}
	// Fill with varying elevations
	for i := range grid.Data {
		grid.Data[i] = float32(i * 10)
	}

	outPath := filepath.Join(t.TempDir(), "terrain-rgb.png")
	err := encodeTerrainRGB(grid, outPath)
	require.NoError(t, err)

	// Verify output is valid PNG of correct dimensions
	f, err := os.Open(outPath)
	require.NoError(t, err)
	defer f.Close()
	img, err := png.Decode(f)
	require.NoError(t, err)
	assert.Equal(t, 4, img.Bounds().Dx())
	assert.Equal(t, 4, img.Bounds().Dy())
}

func TestEncodeTerrainRGB_NegativeElevation(t *testing.T) {
	grid := &DEMGrid{
		Cols:     2,
		Rows:     2,
		CellSize: 10.0,
		Data:     []float32{-100, -50, 0, 50},
	}

	outPath := filepath.Join(t.TempDir(), "terrain-rgb.png")
	err := encodeTerrainRGB(grid, outPath)
	require.NoError(t, err)

	info, err := os.Stat(outPath)
	require.NoError(t, err)
	assert.Greater(t, info.Size(), int64(0))
}

func TestWriteHeightmapVRT(t *testing.T) {
	dir := t.TempDir()
	pngPath := filepath.Join(dir, "heightmap.png")
	require.NoError(t, os.WriteFile(pngPath, []byte("dummy"), 0644))

	vrtPath := filepath.Join(dir, "heightmap.vrt")
	err := writeHeightmapVRT(vrtPath, pngPath, 8, 8, 256)
	require.NoError(t, err)

	data, err := os.ReadFile(vrtPath)
	require.NoError(t, err)
	content := string(data)
	assert.Contains(t, content, "VRTDataset")
	assert.Contains(t, content, "EPSG:4326")
	assert.Contains(t, content, "rasterXSize=\"8\"")
	assert.Contains(t, content, "rasterYSize=\"8\"")
	assert.Contains(t, content, "heightmap.png")
}

func TestEncodeTerrainRGB_InvalidPath(t *testing.T) {
	grid := &DEMGrid{Cols: 1, Rows: 1, Data: []float32{0}}
	err := encodeTerrainRGB(grid, "/nonexistent/dir/out.png")
	require.Error(t, err)
}

func TestWriteHeightmapVRT_InvalidPath(t *testing.T) {
	err := writeHeightmapVRT("/nonexistent/dir/out.vrt", "foo.png", 4, 4, 256)
	require.Error(t, err)
}
