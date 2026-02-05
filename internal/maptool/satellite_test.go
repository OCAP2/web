package maptool

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFindDataLayerPBOs(t *testing.T) {
	dir := t.TempDir()

	// Create fake PBO files
	for _, name := range []string{
		"map_altis.pbo",
		"map_altis_data_layers.pbo",         // base data_layers (no grid suffix)
		"map_altis_data_layers_00_00.pbo",
		"map_altis_data_layers_00_01.pbo",
		"map_altis_data_layers_01_00.pbo",
		"map_altis_data_layers_01_01.pbo",
		"map_altis_data.pbo",                // NOT a data_layers PBO
		"map_stratis_data_layers_00_00.pbo", // Different map
	} {
		os.WriteFile(filepath.Join(dir, name), []byte("fake"), 0644)
	}

	pbos, err := FindDataLayerPBOs(filepath.Join(dir, "map_altis.pbo"))
	require.NoError(t, err)
	assert.Len(t, pbos, 5)

	// Verify all are altis data_layers
	for _, p := range pbos {
		assert.True(t, strings.Contains(filepath.Base(p), "map_altis_data_layers"))
	}
}

func TestFindDataLayerPBOs_SingleFile(t *testing.T) {
	dir := t.TempDir()

	// Small maps like Stratis have a single data_layers PBO without grid suffix
	for _, name := range []string{
		"map_stratis.pbo",
		"map_stratis_data.pbo",
		"map_stratis_data_layers.pbo",
	} {
		os.WriteFile(filepath.Join(dir, name), []byte("fake"), 0644)
	}

	pbos, err := FindDataLayerPBOs(filepath.Join(dir, "map_stratis.pbo"))
	require.NoError(t, err)
	assert.Len(t, pbos, 1)
	assert.Contains(t, filepath.Base(pbos[0]), "map_stratis_data_layers")
}

func TestFindDataLayerPBOs_NoMatches(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "map_altis.pbo"), []byte("fake"), 0644)

	pbos, err := FindDataLayerPBOs(filepath.Join(dir, "map_altis.pbo"))
	require.NoError(t, err)
	assert.Len(t, pbos, 0)
}

func TestParseSatTileCoords(t *testing.T) {
	tests := []struct {
		filename string
		x, y     int
		wantErr  bool
	}{
		{"s_020_024_lco.paa", 20, 24, false},
		{"s_000_000_lco.paa", 0, 0, false},
		{"s_059_059_lco.paa", 59, 59, false},
		{"/some/path/s_010_005_lco.paa", 10, 5, false},
		{"m_020_024_lca.paa", 0, 0, true},  // mask tile, not sat
		{"n_020_024_no.paa", 0, 0, true},    // normal tile
		{"random.paa", 0, 0, true},
		{"s_abc_024_lco.paa", 0, 0, true},   // non-numeric
	}

	for _, tt := range tests {
		t.Run(filepath.Base(tt.filename), func(t *testing.T) {
			x, y, err := ParseSatTileCoords(tt.filename)
			if tt.wantErr {
				assert.Error(t, err)
			} else {
				require.NoError(t, err)
				assert.Equal(t, tt.x, x)
				assert.Equal(t, tt.y, y)
			}
		})
	}
}

func TestBuildVRT(t *testing.T) {
	dir := t.TempDir()

	tiles := []SatTile{
		{X: 0, Y: 0, PNGPath: filepath.Join(dir, "s_000_000_lco.png")},
		{X: 1, Y: 0, PNGPath: filepath.Join(dir, "s_001_000_lco.png")},
		{X: 0, Y: 1, PNGPath: filepath.Join(dir, "s_000_001_lco.png")},
		{X: 1, Y: 1, PNGPath: filepath.Join(dir, "s_001_001_lco.png")},
	}

	vrtPath := filepath.Join(dir, "test.vrt")
	err := BuildVRT(vrtPath, tiles, 1024, 1024, 30720)
	require.NoError(t, err)

	data, err := os.ReadFile(vrtPath)
	require.NoError(t, err)
	content := string(data)

	// Check XML structure
	assert.Contains(t, content, `rasterXSize="1024"`)
	assert.Contains(t, content, `rasterYSize="1024"`)
	assert.Contains(t, content, `<ColorInterp>Red</ColorInterp>`)
	assert.Contains(t, content, `<ColorInterp>Green</ColorInterp>`)
	assert.Contains(t, content, `<ColorInterp>Blue</ColorInterp>`)

	// Check georeferencing
	assert.Contains(t, content, `<SRS>EPSG:4326</SRS>`)
	assert.Contains(t, content, `<GeoTransform>`)

	// No Y-flip: tile Y maps directly to image row. Y=0 → yOff=0 (top), Y=1 → yOff=512.
	// GeoTransform maps top→lat=0, bottom→lat=worldSizeDeg (south-up raster).
	assert.Contains(t, content, `s_000_001_lco.png`)
	assert.Contains(t, content, `s_000_000_lco.png`)
}

func TestBuildVRT_NoTiles(t *testing.T) {
	dir := t.TempDir()
	err := BuildVRT(filepath.Join(dir, "empty.vrt"), nil, 512, 512, 8192)
	assert.Error(t, err)
}

func TestBuildVRT_YDirect(t *testing.T) {
	dir := t.TempDir()

	// Single tile at (0,2) — yOff = 2*512 = 1024
	tiles := []SatTile{
		{X: 0, Y: 2, PNGPath: filepath.Join(dir, "s_000_002_lco.png")},
	}

	vrtPath := filepath.Join(dir, "direct.vrt")
	err := BuildVRT(vrtPath, tiles, 512, 1536, 8192)
	require.NoError(t, err)

	data, _ := os.ReadFile(vrtPath)
	content := string(data)

	// Y=2 → yOff = 2*512 = 1024
	assert.Contains(t, content, `yOff="1024"`)
	assert.Contains(t, content, `xOff="0"`)
}
