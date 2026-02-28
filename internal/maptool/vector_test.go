package maptool

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestColorArrayToHex(t *testing.T) {
	tests := []struct {
		name     string
		input    []interface{}
		expected string
	}{
		{"white", []interface{}{1.0, 1.0, 1.0}, "ffffff"},
		{"black", []interface{}{0.0, 0.0, 0.0}, "000000"},
		{"red", []interface{}{1.0, 0.0, 0.0}, "ff0000"},
		{"green", []interface{}{0.0, 1.0, 0.0}, "00ff00"},
		{"blue", []interface{}{0.0, 0.0, 1.0}, "0000ff"},
		{"mid gray", []interface{}{0.5, 0.5, 0.5}, "7f7f7f"},
		// 0-255 integer range (grad_meh exports)
		{"grad_meh gray", []interface{}{128.0, 121.0, 118.0}, "807976"},
		{"grad_meh white", []interface{}{255.0, 255.0, 255.0}, "ffffff"},
		{"grad_meh dark", []interface{}{110.0, 111.0, 111.0}, "6e6f6f"},
		{"too few elements", []interface{}{1.0, 0.5}, "888888"},
		{"empty", []interface{}{}, "888888"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, colorArrayToHex(tt.input))
		})
	}
}

func TestClampInt(t *testing.T) {
	tests := []struct {
		name     string
		input    float64
		expected int
	}{
		{"zero", 0.0, 0},
		{"255", 255.0, 255},
		{"mid", 127.0, 127},
		{"negative", -1.0, 0},
		{"overflow", 300.0, 255},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, clampInt(tt.input))
		})
	}
}

func TestToFloat64(t *testing.T) {
	f, ok := toFloat64(3.14)
	assert.True(t, ok)
	assert.InDelta(t, 3.14, f, 0.001)

	f, ok = toFloat64(42)
	assert.True(t, ok)
	assert.Equal(t, 42.0, f)

	f, ok = toFloat64(json.Number("7.5"))
	assert.True(t, ok)
	assert.Equal(t, 7.5, f)

	_, ok = toFloat64("not a number")
	assert.False(t, ok)

	_, ok = toFloat64(nil)
	assert.False(t, ok)
}

func TestTransformCoords_SinglePoint(t *testing.T) {
	// [x, y] coordinate pair
	coords := []interface{}{111320.0, 222640.0}
	result := transformCoords(coords).([]interface{})

	x, _ := toFloat64(result[0])
	y, _ := toFloat64(result[1])
	assert.InDelta(t, 1.0, x, 0.001)
	assert.InDelta(t, 2.0, y, 0.001)
}

func TestTransformCoords_PointWithAltitude(t *testing.T) {
	// [x, y, alt] — altitude should NOT be divided
	coords := []interface{}{111320.0, 111320.0, 100.0}
	result := transformCoords(coords).([]interface{})

	x, _ := toFloat64(result[0])
	y, _ := toFloat64(result[1])
	alt, _ := toFloat64(result[2])
	assert.InDelta(t, 1.0, x, 0.001)
	assert.InDelta(t, 1.0, y, 0.001)
	assert.Equal(t, 100.0, alt, "altitude should be preserved")
}

func TestTransformCoords_LineString(t *testing.T) {
	// Array of coordinate pairs
	coords := []interface{}{
		[]interface{}{111320.0, 0.0},
		[]interface{}{0.0, 111320.0},
	}
	result := transformCoords(coords).([]interface{})

	p0 := result[0].([]interface{})
	p1 := result[1].([]interface{})

	x0, _ := toFloat64(p0[0])
	y0, _ := toFloat64(p0[1])
	x1, _ := toFloat64(p1[0])
	y1, _ := toFloat64(p1[1])

	assert.InDelta(t, 1.0, x0, 0.001)
	assert.InDelta(t, 0.0, y0, 0.001)
	assert.InDelta(t, 0.0, x1, 0.001)
	assert.InDelta(t, 1.0, y1, 0.001)
}

func TestTransformCoords_Polygon(t *testing.T) {
	// Polygon: array of rings, each ring is array of coordinate pairs
	coords := []interface{}{
		[]interface{}{
			[]interface{}{0.0, 0.0},
			[]interface{}{111320.0, 0.0},
			[]interface{}{111320.0, 111320.0},
			[]interface{}{0.0, 0.0},
		},
	}
	result := transformCoords(coords).([]interface{})
	ring := result[0].([]interface{})

	assert.Len(t, ring, 4)
	p1 := ring[1].([]interface{})
	x, _ := toFloat64(p1[0])
	assert.InDelta(t, 1.0, x, 0.001)
}

func TestTransformCoords_Empty(t *testing.T) {
	coords := []interface{}{}
	result := transformCoords(coords).([]interface{})
	assert.Empty(t, result)
}

func TestTransformCoords_NonSlice(t *testing.T) {
	// Non-slice input returned as-is
	assert.Equal(t, "foo", transformCoords("foo"))
	assert.Equal(t, 42, transformCoords(42))
	assert.Nil(t, transformCoords(nil))
}

func TestDiscoverGeoJSONLayers_NoDir(t *testing.T) {
	// Directory with no geojson/ subdirectory
	dir := t.TempDir()
	sources, err := DiscoverGeoJSONLayers(dir)
	assert.NoError(t, err)
	assert.Nil(t, sources)
}

func TestDiscoverGeoJSONLayers_ValidLayers(t *testing.T) {
	dir := t.TempDir()
	geojsonDir := filepath.Join(dir, "geojson")
	require.NoError(t, os.MkdirAll(geojsonDir, 0755))

	// Write a valid .geojson.gz file
	require.NoError(t, os.WriteFile(filepath.Join(geojsonDir, "house.geojson.gz"), []byte("fake"), 0644))
	require.NoError(t, os.WriteFile(filepath.Join(geojsonDir, "road.geojson.gz"), []byte("fake"), 0644))
	// Non-geojson file should be ignored
	require.NoError(t, os.WriteFile(filepath.Join(geojsonDir, "readme.txt"), []byte("hi"), 0644))

	sources, err := DiscoverGeoJSONLayers(dir)
	require.NoError(t, err)
	assert.Len(t, sources, 2)

	names := make(map[string]bool)
	for _, s := range sources {
		names[s.Name] = true
	}
	assert.True(t, names["house"])
	assert.True(t, names["road"])
}

func TestDiscoverGeoJSONLayers_SubDirectories(t *testing.T) {
	dir := t.TempDir()
	locDir := filepath.Join(dir, "geojson", "locations")
	require.NoError(t, os.MkdirAll(locDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(locDir, "namecity.geojson.gz"), []byte("fake"), 0644))

	sources, err := DiscoverGeoJSONLayers(dir)
	require.NoError(t, err)
	assert.Len(t, sources, 1)
	assert.Equal(t, "namecity", sources[0].Name)
}

func TestDiscoverGeoJSONLayers_EmptyFilename(t *testing.T) {
	dir := t.TempDir()
	geojsonDir := filepath.Join(dir, "geojson")
	require.NoError(t, os.MkdirAll(geojsonDir, 0755))
	// File named just ".geojson.gz" — after trim the name is empty
	require.NoError(t, os.WriteFile(filepath.Join(geojsonDir, ".geojson.gz"), []byte("fake"), 0644))

	sources, err := DiscoverGeoJSONLayers(dir)
	require.NoError(t, err)
	assert.Empty(t, sources, "files with empty name should be skipped")
}

func TestProcessGeoJSONGz_MissingFile(t *testing.T) {
	err := ProcessGeoJSONGz("/nonexistent/file.geojson.gz", filepath.Join(t.TempDir(), "out.geojson"))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "open")
}

func TestProcessGeoJSONGz_InvalidGzip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bad.geojson.gz")
	require.NoError(t, os.WriteFile(path, []byte("not gzip"), 0644))

	err := ProcessGeoJSONGz(path, filepath.Join(t.TempDir(), "out.geojson"))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "gzip")
}

func TestProcessGeoJSONGz_InvalidJSON(t *testing.T) {
	dir := t.TempDir()
	inputPath := filepath.Join(dir, "bad.geojson.gz")

	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	gz.Write([]byte("{not json array}"))
	gz.Close()
	require.NoError(t, os.WriteFile(inputPath, buf.Bytes(), 0644))

	err := ProcessGeoJSONGz(inputPath, filepath.Join(dir, "out.geojson"))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "decode features")
}

func TestProcessGeoJSONGz_Valid(t *testing.T) {
	dir := t.TempDir()
	inputPath := filepath.Join(dir, "house.geojson.gz")
	outputPath := filepath.Join(dir, "house.geojson")

	features := []map[string]any{
		{
			"type": "Feature",
			"geometry": map[string]any{
				"type":        "Polygon",
				"coordinates": [][][2]float64{{{100, 200}, {110, 200}, {110, 210}, {100, 210}, {100, 200}}},
			},
			"properties": map[string]any{
				"color": []float64{0.5, 0.5, 0.5},
			},
		},
	}
	data, _ := json.Marshal(features)

	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	gz.Write(data)
	gz.Close()
	require.NoError(t, os.WriteFile(inputPath, buf.Bytes(), 0644))

	err := ProcessGeoJSONGz(inputPath, outputPath)
	require.NoError(t, err)

	// Verify output is a valid FeatureCollection
	outData, err := os.ReadFile(outputPath)
	require.NoError(t, err)
	var fc map[string]any
	require.NoError(t, json.Unmarshal(outData, &fc))
	assert.Equal(t, "FeatureCollection", fc["type"])
	outFeatures := fc["features"].([]any)
	assert.Len(t, outFeatures, 1)
}

func TestNewProcessGeoJSONStage_NoFeatures(t *testing.T) {
	// Empty geojson dir — no layers
	dir := t.TempDir()
	geojsonDir := filepath.Join(dir, "geojson")
	require.NoError(t, os.MkdirAll(geojsonDir, 0755))

	stage := NewProcessGeoJSONStage()
	job := &Job{InputPath: dir, TempDir: t.TempDir()}
	err := stage.Run(context.Background(), job)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no vector features found")
}

func TestNewProcessGeoJSONStage_BushSkipped(t *testing.T) {
	dir := t.TempDir()
	geojsonDir := filepath.Join(dir, "geojson")
	require.NoError(t, os.MkdirAll(geojsonDir, 0755))

	// Write both bush (should be skipped) and a valid house layer
	writeBareGeoJSONGz(t, filepath.Join(geojsonDir, "bush.geojson.gz"))
	writeBareGeoJSONGz(t, filepath.Join(geojsonDir, "house.geojson.gz"))

	stage := NewProcessGeoJSONStage()
	job := &Job{InputPath: dir, TempDir: t.TempDir()}
	err := stage.Run(context.Background(), job)
	require.NoError(t, err)

	assert.Contains(t, job.VectorLayers, "house")
	assert.NotContains(t, job.VectorLayers, "bush")
}

func TestNewProcessGeoJSONStage_AliasRenaming(t *testing.T) {
	dir := t.TempDir()
	geojsonDir := filepath.Join(dir, "geojson")
	require.NoError(t, os.MkdirAll(geojsonDir, 0755))

	// "mounts" should be renamed to "mount"
	writeBareGeoJSONGz(t, filepath.Join(geojsonDir, "mounts.geojson.gz"))

	stage := NewProcessGeoJSONStage()
	job := &Job{InputPath: dir, TempDir: t.TempDir()}
	err := stage.Run(context.Background(), job)
	require.NoError(t, err)

	assert.Contains(t, job.VectorLayers, "mount")
	assert.NotContains(t, job.VectorLayers, "mounts")
}

func TestNewProcessGeoJSONStage_SeaFile(t *testing.T) {
	dir := t.TempDir()
	// No geojson dir, but set SeaFile on job
	seaPath := filepath.Join(t.TempDir(), "sea.geojson")
	require.NoError(t, os.WriteFile(seaPath, []byte(`{"type":"FeatureCollection","features":[]}`), 0644))

	stage := NewProcessGeoJSONStage()
	job := &Job{InputPath: dir, TempDir: t.TempDir(), SeaFile: seaPath}
	err := stage.Run(context.Background(), job)
	require.NoError(t, err)
	assert.Contains(t, job.VectorLayers, "sea")
}

// writeBareGeoJSONGz writes a minimal valid GeoJSON bare array with a single point feature.
func writeBareGeoJSONGz(t *testing.T, path string) {
	t.Helper()
	features := []map[string]any{
		{
			"type": "Feature",
			"geometry": map[string]any{
				"type":        "Point",
				"coordinates": []float64{100, 200},
			},
			"properties": map[string]any{},
		},
	}
	data, _ := json.Marshal(features)
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	gz.Write(data)
	gz.Close()
	require.NoError(t, os.WriteFile(path, buf.Bytes(), 0644))
}

func TestNewProcessGeoJSONStage_TmpDirError(t *testing.T) {
	// TempDir is a file, so MkdirAll for vector/ subdir fails
	dir := t.TempDir()
	geojsonDir := filepath.Join(dir, "geojson")
	require.NoError(t, os.MkdirAll(geojsonDir, 0755))
	writeBareGeoJSONGz(t, filepath.Join(geojsonDir, "house.geojson.gz"))

	tmpFile := filepath.Join(t.TempDir(), "blocker")
	require.NoError(t, os.WriteFile(tmpFile, []byte("x"), 0644))

	stage := NewProcessGeoJSONStage()
	job := &Job{InputPath: dir, TempDir: tmpFile}
	err := stage.Run(context.Background(), job)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "create vector temp dir")
}

func TestNewProcessGeoJSONStage_FailedLayerSkipped(t *testing.T) {
	dir := t.TempDir()
	geojsonDir := filepath.Join(dir, "geojson")
	require.NoError(t, os.MkdirAll(geojsonDir, 0755))

	// Write a corrupt .geojson.gz (invalid gzip) — will fail ProcessGeoJSONGz
	require.NoError(t, os.WriteFile(filepath.Join(geojsonDir, "corrupt.geojson.gz"), []byte("not gzip"), 0644))
	// Write a valid one
	writeBareGeoJSONGz(t, filepath.Join(geojsonDir, "house.geojson.gz"))

	stage := NewProcessGeoJSONStage()
	job := &Job{InputPath: dir, TempDir: t.TempDir()}
	err := stage.Run(context.Background(), job)
	require.NoError(t, err)

	// Only the valid layer should be present
	assert.Contains(t, job.VectorLayers, "house")
	assert.NotContains(t, job.VectorLayers, "corrupt")
}

func TestDiscoverGeoJSONLayers_UnreadableSubdir(t *testing.T) {
	dir := t.TempDir()
	geojsonDir := filepath.Join(dir, "geojson")
	require.NoError(t, os.MkdirAll(geojsonDir, 0755))

	// Create an unreadable subdirectory — Walk will report an error for it
	badSubDir := filepath.Join(geojsonDir, "locked")
	require.NoError(t, os.MkdirAll(badSubDir, 0000))
	t.Cleanup(func() { os.Chmod(badSubDir, 0755) })

	_, err := DiscoverGeoJSONLayers(dir)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "walk geojson dir")
}

func TestProcessGeoJSONGz_OutputCreateError(t *testing.T) {
	dir := t.TempDir()
	inputPath := filepath.Join(dir, "test.geojson.gz")

	features := []map[string]any{
		{"type": "Feature", "geometry": map[string]any{"type": "Point", "coordinates": []float64{100, 200}}, "properties": map[string]any{}},
	}
	data, _ := json.Marshal(features)
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	gz.Write(data)
	gz.Close()
	require.NoError(t, os.WriteFile(inputPath, buf.Bytes(), 0644))

	err := ProcessGeoJSONGz(inputPath, "/nonexistent/dir/out.geojson")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "create output")
}

func TestProcessGeoJSONGz_BadFeatureSkipped(t *testing.T) {
	dir := t.TempDir()
	inputPath := filepath.Join(dir, "test.geojson.gz")
	outputPath := filepath.Join(dir, "out.geojson")

	// Mix valid and invalid JSON features in the raw array
	raw := `[{"type":"Feature","geometry":{"type":"Point","coordinates":[100,200]},"properties":{}}, "not a valid feature object"]`
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	gz.Write([]byte(raw))
	gz.Close()
	require.NoError(t, os.WriteFile(inputPath, buf.Bytes(), 0644))

	err := ProcessGeoJSONGz(inputPath, outputPath)
	require.NoError(t, err)

	// Should have 1 valid feature (the second is skipped)
	outData, err := os.ReadFile(outputPath)
	require.NoError(t, err)
	var fc map[string]any
	require.NoError(t, json.Unmarshal(outData, &fc))
	outFeatures := fc["features"].([]any)
	assert.Len(t, outFeatures, 1)
}

func TestProcessGeoJSONGz_WalkError(t *testing.T) {
	// DiscoverGeoJSONLayers with an unreadable directory
	dir := t.TempDir()
	geojsonDir := filepath.Join(dir, "geojson")
	require.NoError(t, os.MkdirAll(geojsonDir, 0755))

	// Create a valid geojson file
	writeBareGeoJSONGz(t, filepath.Join(geojsonDir, "test.geojson.gz"))

	// Verify layers are found
	sources, err := DiscoverGeoJSONLayers(dir)
	require.NoError(t, err)
	assert.Len(t, sources, 1)
}

func TestProcessGeoJSONGz_PositionZPos(t *testing.T) {
	dir := t.TempDir()
	inputPath := filepath.Join(dir, "obj.geojson.gz")
	outputPath := filepath.Join(dir, "obj.geojson")

	features := []map[string]any{
		{
			"type": "Feature",
			"geometry": map[string]any{
				"type":        "Point",
				"coordinates": []float64{100, 200},
			},
			"properties": map[string]any{
				"position": []float64{100, 200, 42.5},
			},
		},
	}
	data, _ := json.Marshal(features)

	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	gz.Write(data)
	gz.Close()
	require.NoError(t, os.WriteFile(inputPath, buf.Bytes(), 0644))

	err := ProcessGeoJSONGz(inputPath, outputPath)
	require.NoError(t, err)

	outData, err := os.ReadFile(outputPath)
	require.NoError(t, err)
	var fc map[string]any
	require.NoError(t, json.Unmarshal(outData, &fc))
	outFeatures := fc["features"].([]any)
	props := outFeatures[0].(map[string]any)["properties"].(map[string]any)
	assert.Equal(t, 42.5, props["zpos"])
}
