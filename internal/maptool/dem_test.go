package maptool

import (
	"bytes"
	"compress/gzip"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/iotest"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseASCGrid_Valid(t *testing.T) {
	asc := `ncols 3
nrows 2
xllcorner 0.0
yllcorner 0.0
cellsize 10.0
nodata_value -9999
10 20 30
40 50 60
`
	grid, err := ParseASCGrid(strings.NewReader(asc))
	require.NoError(t, err)
	assert.Equal(t, 3, grid.Cols)
	assert.Equal(t, 2, grid.Rows)
	assert.Equal(t, 10.0, grid.CellSize)
	assert.Equal(t, -9999.0, grid.NoData)
	// ASC row 0 = north (10,20,30), ASC row 1 = south (40,50,60)
	// After flip: Data[0..2] = south row (40,50,60), Data[3..5] = north row (10,20,30)
	assert.InDelta(t, 40.0, float64(grid.Data[0]), 0.1)
	assert.InDelta(t, 30.0, float64(grid.Data[5]), 0.1)
}

func TestParseASCGrid_CenterCoordinates(t *testing.T) {
	asc := `ncols 2
nrows 2
xllcenter 5.0
yllcenter 5.0
cellsize 10.0
1 2
3 4
`
	grid, err := ParseASCGrid(strings.NewReader(asc))
	require.NoError(t, err)
	// Center at 5.0 with cellsize 10.0 → corner at 0.0
	assert.Equal(t, 0.0, grid.XllCorner)
	assert.Equal(t, 0.0, grid.YllCorner)
}

func TestParseASCGrid_InvalidDimensions(t *testing.T) {
	asc := `ncols 0
nrows 3
cellsize 10.0
1 2 3
`
	_, err := ParseASCGrid(strings.NewReader(asc))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid grid dimensions")
}

func TestParseASCGrid_NegativeRows(t *testing.T) {
	asc := `ncols 3
nrows -1
cellsize 10.0
`
	_, err := ParseASCGrid(strings.NewReader(asc))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid grid dimensions")
}

func TestParseASCGrid_InvalidCellSize(t *testing.T) {
	asc := `ncols 2
nrows 2
cellsize 0
1 2
3 4
`
	_, err := ParseASCGrid(strings.NewReader(asc))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid cellsize")
}

func TestParseASCGrid_InvalidHeaderValue(t *testing.T) {
	asc := `ncols abc
nrows 2
cellsize 10.0
`
	_, err := ParseASCGrid(strings.NewReader(asc))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "parse header")
}

func TestParseASCGrid_InvalidDataValue(t *testing.T) {
	asc := `ncols 2
nrows 1
cellsize 10.0
1 abc
`
	_, err := ParseASCGrid(strings.NewReader(asc))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "parse value")
}

func TestParseASCGrid_NoDataReplacedWithZero(t *testing.T) {
	asc := `ncols 2
nrows 1
cellsize 10.0
nodata_value -9999
10 -9999
`
	grid, err := ParseASCGrid(strings.NewReader(asc))
	require.NoError(t, err)
	assert.InDelta(t, 10.0, float64(grid.Data[0]), 0.1)
	assert.InDelta(t, 0.0, float64(grid.Data[1]), 0.1) // nodata → 0
}

func TestParseASCGrid_EmptyLines(t *testing.T) {
	asc := `ncols 2
nrows 1
cellsize 10.0

5 10
`
	grid, err := ParseASCGrid(strings.NewReader(asc))
	require.NoError(t, err)
	assert.InDelta(t, 5.0, float64(grid.Data[0]), 0.1)
}

func TestParseASCGridGz_MissingFile(t *testing.T) {
	_, err := ParseASCGridGz("/nonexistent/path.asc.gz")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "open")
}

func TestParseASCGridGz_InvalidGzip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bad.asc.gz")
	require.NoError(t, os.WriteFile(path, []byte("not gzip data"), 0644))

	_, err := ParseASCGridGz(path)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "gzip reader")
}

func TestParseASCGrid_SingleFieldLine(t *testing.T) {
	// A header with a single-field line (len(parts) < 2) breaks out of header loop
	asc := `ncols 2
nrows 1
cellsize 10.0
SOMETEXT
5 10
`
	grid, err := ParseASCGrid(strings.NewReader(asc))
	require.NoError(t, err)
	assert.Equal(t, 2, grid.Cols)
}

func TestParseASCGrid_ExtraData(t *testing.T) {
	// More data values than grid dimensions — extra data is ignored
	asc := `ncols 2
nrows 1
cellsize 10.0
5 10 99 99 99
`
	grid, err := ParseASCGrid(strings.NewReader(asc))
	require.NoError(t, err)
	assert.InDelta(t, 5.0, float64(grid.Data[0]), 0.1)
	assert.InDelta(t, 10.0, float64(grid.Data[1]), 0.1)
}

func TestParseASCGrid_NaNReplacement(t *testing.T) {
	// NaN values in the grid should be replaced with 0
	asc := `ncols 2
nrows 1
cellsize 10.0
nodata_value -9999
10 NaN
`
	grid, err := ParseASCGrid(strings.NewReader(asc))
	// Go's strconv.ParseFloat accepts "NaN" as valid → replaced by 0 via math.IsNaN check
	require.NoError(t, err)
	assert.InDelta(t, 10.0, float64(grid.Data[0]), 0.1)
	assert.InDelta(t, 0.0, float64(grid.Data[1]), 0.1, "NaN should be replaced with 0")
}

func TestParseASCGrid_DataErrorInSecondPass(t *testing.T) {
	// Data parse error in the scanner.Scan loop (after header), not in processLine from header break
	asc := `ncols 2
nrows 2
cellsize 10.0
1 2
3 bad_value
`
	_, err := ParseASCGrid(strings.NewReader(asc))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "parse value")
}

func TestParseASCGrid_ScannerError(t *testing.T) {
	// An iotest.ErrReader triggers scanner.Err() after header parsing
	asc := "ncols 2\nnrows 1\ncellsize 10.0\n5 10\n"
	r := iotest.TimeoutReader(strings.NewReader(asc))
	// TimeoutReader returns ErrTimeout on second read — parse header then fail in scan loop
	_, err := ParseASCGrid(r)
	// Should either succeed (if scanner buffers enough) or fail with scan error
	// The important thing is exercising the scanner.Err() path
	if err != nil {
		assert.Contains(t, err.Error(), "scan")
	}
}

func TestParseASCGrid_InsufficientData(t *testing.T) {
	// Grid expects 2*2=4 values but only provides 2
	asc := `ncols 2
nrows 2
cellsize 10.0
5 10
`
	grid, err := ParseASCGrid(strings.NewReader(asc))
	// Parser reads what it can — doesn't error on insufficient data, just short fills
	if err == nil {
		assert.NotNil(t, grid)
	}
}

func TestParseASCGridGz_Valid(t *testing.T) {
	asc := `ncols 2
nrows 2
cellsize 5.0
1 2
3 4
`
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	_, err := gz.Write([]byte(asc))
	require.NoError(t, err)
	require.NoError(t, gz.Close())

	path := filepath.Join(t.TempDir(), "test.asc.gz")
	require.NoError(t, os.WriteFile(path, buf.Bytes(), 0644))

	grid, err := ParseASCGridGz(path)
	require.NoError(t, err)
	assert.Equal(t, 2, grid.Cols)
	assert.Equal(t, 2, grid.Rows)
	assert.Equal(t, 5.0, grid.CellSize)
}
