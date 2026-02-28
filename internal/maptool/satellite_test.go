package maptool

import (
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestScanGradMehSatTiles_MissingDir(t *testing.T) {
	_, _, err := ScanGradMehSatTiles("/nonexistent/sat")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "read sat dir")
}

func TestScanGradMehSatTiles_NoTiles(t *testing.T) {
	dir := t.TempDir()
	// Empty directory — no tile subdirectories
	_, _, err := ScanGradMehSatTiles(dir)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no satellite tiles found")
}

func TestScanGradMehSatTiles_NonNumericDirs(t *testing.T) {
	dir := t.TempDir()
	// Create a non-numeric directory name
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "abc"), 0755))
	_, _, err := ScanGradMehSatTiles(dir)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no satellite tiles found")
}

func TestScanGradMehSatTiles_CorruptedPNG(t *testing.T) {
	dir := t.TempDir()
	xDir := filepath.Join(dir, "0")
	require.NoError(t, os.MkdirAll(xDir, 0755))
	// Write a non-PNG file with .png extension
	require.NoError(t, os.WriteFile(filepath.Join(xDir, "0.png"), []byte("not a png"), 0644))

	_, _, err := ScanGradMehSatTiles(dir)
	// Corrupted PNGs are skipped with a warning, so if that's the only tile, "no satellite tiles found"
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no satellite tiles found")
}

func TestScanGradMehSatTiles_Valid(t *testing.T) {
	dir := t.TempDir()
	xDir := filepath.Join(dir, "0")
	require.NoError(t, os.MkdirAll(xDir, 0755))
	writeSatTile(t, filepath.Join(xDir, "0.png"), 64, 64)

	tiles, tileSize, err := ScanGradMehSatTiles(dir)
	require.NoError(t, err)
	assert.Len(t, tiles, 1)
	assert.Equal(t, 64, tileSize)
	assert.Equal(t, 0, tiles[0].X)
	assert.Equal(t, 0, tiles[0].Y)
	assert.Equal(t, 64, tiles[0].Width)
	assert.Equal(t, 64, tiles[0].Height)
}

func TestScanGradMehSatTiles_MultipleTiles(t *testing.T) {
	dir := t.TempDir()
	for _, x := range []string{"0", "1"} {
		xDir := filepath.Join(dir, x)
		require.NoError(t, os.MkdirAll(xDir, 0755))
		writeSatTile(t, filepath.Join(xDir, "0.png"), 32, 32)
	}

	tiles, tileSize, err := ScanGradMehSatTiles(dir)
	require.NoError(t, err)
	assert.Len(t, tiles, 2)
	assert.Equal(t, 32, tileSize)
}

func TestScanGradMehSatTiles_SkipsNonPNG(t *testing.T) {
	dir := t.TempDir()
	xDir := filepath.Join(dir, "0")
	require.NoError(t, os.MkdirAll(xDir, 0755))
	writeSatTile(t, filepath.Join(xDir, "0.png"), 32, 32)
	require.NoError(t, os.WriteFile(filepath.Join(xDir, "readme.txt"), []byte("hi"), 0644))

	tiles, _, err := ScanGradMehSatTiles(dir)
	require.NoError(t, err)
	assert.Len(t, tiles, 1)
}

func TestScanGradMehSatTiles_NonNumericY(t *testing.T) {
	dir := t.TempDir()
	xDir := filepath.Join(dir, "0")
	require.NoError(t, os.MkdirAll(xDir, 0755))
	writeSatTile(t, filepath.Join(xDir, "0.png"), 32, 32)
	writeSatTile(t, filepath.Join(xDir, "abc.png"), 32, 32) // non-numeric Y, should be skipped

	tiles, _, err := ScanGradMehSatTiles(dir)
	require.NoError(t, err)
	assert.Len(t, tiles, 1)
}

func TestScanGradMehSatTiles_FileInRoot(t *testing.T) {
	dir := t.TempDir()
	// Place a regular file in the sat root — should be skipped (not a dir)
	require.NoError(t, os.WriteFile(filepath.Join(dir, "readme.txt"), []byte("hi"), 0644))
	// Also add a valid tile so we get a result
	xDir := filepath.Join(dir, "0")
	require.NoError(t, os.MkdirAll(xDir, 0755))
	writeSatTile(t, filepath.Join(xDir, "0.png"), 32, 32)

	tiles, _, err := ScanGradMehSatTiles(dir)
	require.NoError(t, err)
	assert.Len(t, tiles, 1)
}

func TestScanGradMehSatTiles_DirInsideXDir(t *testing.T) {
	dir := t.TempDir()
	xDir := filepath.Join(dir, "0")
	require.NoError(t, os.MkdirAll(xDir, 0755))
	writeSatTile(t, filepath.Join(xDir, "0.png"), 32, 32)
	// Place a subdirectory inside the X dir — should be skipped (yEntry.IsDir())
	require.NoError(t, os.MkdirAll(filepath.Join(xDir, "subdir"), 0755))

	tiles, _, err := ScanGradMehSatTiles(dir)
	require.NoError(t, err)
	assert.Len(t, tiles, 1)
}

func TestScanGradMehSatTiles_WalkError(t *testing.T) {
	dir := t.TempDir()
	xDir := filepath.Join(dir, "0")
	require.NoError(t, os.MkdirAll(xDir, 0755))
	writeSatTile(t, filepath.Join(xDir, "0.png"), 32, 32)
	// Also have a non-image file — should be skipped by dimension check
	require.NoError(t, os.WriteFile(filepath.Join(xDir, "notes.txt"), []byte("text"), 0644))

	tiles, _, err := ScanGradMehSatTiles(dir)
	require.NoError(t, err)
	assert.Len(t, tiles, 1) // only the PNG counts
}

func TestBuildGradMehVRT_InvalidPath(t *testing.T) {
	tiles := []SatTile{{X: 0, Y: 0, Width: 32, Height: 32, PNGPath: "/tmp/tile.png"}}
	err := BuildGradMehVRT("/nonexistent/dir/out.vrt", tiles, 32, 256)
	require.Error(t, err)
}

func TestBuildGradMehVRT_EmptyTiles(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.vrt")
	err := BuildGradMehVRT(path, nil, 256, 1024)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no tiles")
}

func TestBuildGradMehVRT_Valid(t *testing.T) {
	dir := t.TempDir()
	pngPath := filepath.Join(dir, "tile.png")
	writeSatTile(t, pngPath, 32, 32)

	tiles := []SatTile{{X: 0, Y: 0, Width: 32, Height: 32, PNGPath: pngPath}}
	vrtPath := filepath.Join(dir, "out.vrt")
	err := BuildGradMehVRT(vrtPath, tiles, 32, 256)
	require.NoError(t, err)

	data, err := os.ReadFile(vrtPath)
	require.NoError(t, err)
	content := string(data)
	assert.Contains(t, content, "VRTDataset")
	assert.Contains(t, content, "EPSG:4326")
	assert.Contains(t, content, "rasterXSize=\"256\"")
	assert.Contains(t, content, "rasterYSize=\"256\"")
}

func TestImageDimensions_Valid(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.png")
	writeSatTile(t, path, 128, 64)

	w, h, err := imageDimensions(path)
	require.NoError(t, err)
	assert.Equal(t, 128, w)
	assert.Equal(t, 64, h)
}

func TestImageDimensions_MissingFile(t *testing.T) {
	_, _, err := imageDimensions("/nonexistent/file.png")
	require.Error(t, err)
}

func TestImageDimensions_CorruptFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "corrupt.png")
	require.NoError(t, os.WriteFile(path, []byte("not an image"), 0644))

	_, _, err := imageDimensions(path)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "decode config")
}

// writeSatTile creates a minimal PNG file of the given dimensions.
func writeSatTile(t *testing.T, path string, w, h int) {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	img.Set(0, 0, color.NRGBA{R: 255, A: 255})
	f, err := os.Create(path)
	require.NoError(t, err)
	defer func() { require.NoError(t, f.Close()) }()
	require.NoError(t, png.Encode(f, img))
}
