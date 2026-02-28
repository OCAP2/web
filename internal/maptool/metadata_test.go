package maptool

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAssetPath(t *testing.T) {
	assert.Equal(t, "images/maps/altis/satellite.pmtiles", assetPath("images/maps/altis", "satellite.pmtiles"))
	assert.Equal(t, "satellite.pmtiles", assetPath("", "satellite.pmtiles"))
}

func TestComputeElevationStats_Normal(t *testing.T) {
	grid := &DEMGrid{
		Data: []float32{10, 20, 30, 40, 50},
	}
	stats := computeElevationStats(grid)
	require.NotNil(t, stats)
	assert.Equal(t, 10.0, stats.Min)
	assert.Equal(t, 50.0, stats.Max)
	assert.Equal(t, 30.0, stats.Avg)
	assert.Greater(t, stats.StdDev, 0.0)
}

func TestComputeElevationStats_SingleValue(t *testing.T) {
	grid := &DEMGrid{
		Data: []float32{42},
	}
	stats := computeElevationStats(grid)
	require.NotNil(t, stats)
	assert.Equal(t, 42.0, stats.Min)
	assert.Equal(t, 42.0, stats.Max)
	assert.Equal(t, 42.0, stats.Avg)
	assert.Equal(t, 0.0, stats.StdDev)
}

func TestComputeElevationStats_AllSame(t *testing.T) {
	grid := &DEMGrid{
		Data: []float32{5, 5, 5, 5},
	}
	stats := computeElevationStats(grid)
	require.NotNil(t, stats)
	assert.Equal(t, 5.0, stats.Min)
	assert.Equal(t, 5.0, stats.Max)
	assert.Equal(t, 5.0, stats.Avg)
	assert.Equal(t, 0.0, stats.StdDev)
}

func TestComputeElevationStats_MinNotFirst(t *testing.T) {
	// First element is NOT the minimum — exercises the fv < min branch
	grid := &DEMGrid{Data: []float32{50, 10, 30}}
	stats := computeElevationStats(grid)
	require.NotNil(t, stats)
	assert.Equal(t, 10.0, stats.Min)
	assert.Equal(t, 50.0, stats.Max)
}

func TestWriteJSON_MarshalError(t *testing.T) {
	// Channels cannot be marshaled to JSON — triggers marshal error
	err := writeJSON(filepath.Join(t.TempDir(), "test.json"), make(chan int))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "marshal")
}

func TestComputeElevationStats_NegativeElevation(t *testing.T) {
	grid := &DEMGrid{
		Data: []float32{-10, -5, 0, 5, 10},
	}
	stats := computeElevationStats(grid)
	require.NotNil(t, stats)
	assert.Equal(t, -10.0, stats.Min)
	assert.Equal(t, 10.0, stats.Max)
	assert.Equal(t, 0.0, stats.Avg)
}

func TestComputeElevationStats_Nil(t *testing.T) {
	assert.Nil(t, computeElevationStats(nil))
}

func TestComputeElevationStats_EmptyData(t *testing.T) {
	grid := &DEMGrid{Data: []float32{}}
	assert.Nil(t, computeElevationStats(grid))
}

func TestComputeElevationStats_RoundsToTwoDecimals(t *testing.T) {
	grid := &DEMGrid{
		Data: []float32{1.111, 2.222, 3.333},
	}
	stats := computeElevationStats(grid)
	require.NotNil(t, stats)
	assert.Equal(t, 1.11, stats.Min)
	assert.Equal(t, 3.33, stats.Max)
	assert.Equal(t, 2.22, stats.Avg)
}

func TestWriteJSON_Valid(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.json")
	data := map[string]string{"key": "value"}
	err := writeJSON(path, data)
	require.NoError(t, err)

	content, err := os.ReadFile(path)
	require.NoError(t, err)
	assert.Contains(t, string(content), `"key"`)
	assert.Contains(t, string(content), `"value"`)
}

func TestWriteJSON_InvalidPath(t *testing.T) {
	err := writeJSON("/nonexistent/dir/test.json", map[string]string{"a": "b"})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "write")
}

func TestNewGenerateStylesStage(t *testing.T) {
	dir := t.TempDir()
	stage := NewGenerateStylesStage()
	job := &Job{
		WorldName:    "testworld",
		OutputDir:    dir,
		VectorLayers: []string{"sea", "road"},
	}

	err := stage.Run(context.Background(), job)
	require.NoError(t, err)
	assert.True(t, job.HasMaplibre)

	// Verify style files exist
	for _, name := range []string{"topo.json", "topo-dark.json", "topo-relief.json", "color-relief.json"} {
		_, err := os.Stat(filepath.Join(dir, name))
		assert.NoError(t, err, "expected %s to exist", name)
	}
	// Verify sprites exist
	_, err = os.Stat(filepath.Join(dir, "sprite.json"))
	assert.NoError(t, err)
}

func TestNewGenerateStylesStage_SubDirs(t *testing.T) {
	dir := t.TempDir()
	stage := NewGenerateStylesStage()
	job := &Job{
		WorldName:    "testworld",
		OutputDir:    dir,
		SubDirs:      true,
		VectorLayers: []string{"sea"},
	}

	err := stage.Run(context.Background(), job)
	require.NoError(t, err)

	stylesDir := filepath.Join(dir, "styles")
	_, err = os.Stat(filepath.Join(stylesDir, "topo.json"))
	assert.NoError(t, err, "styles should be in styles/ subdir")
}

func TestNewGenerateGradMehMetadataStage(t *testing.T) {
	dir := t.TempDir()
	stage := NewGenerateGradMehMetadataStage()
	job := &Job{
		WorldName:    "testworld",
		WorldSize:    10240,
		OutputDir:    dir,
		VectorLayers: []string{"sea", "house"},
		HasMaplibre:  true,
		GradMehMeta:  &GradMehMeta{DisplayName: "Test World", Author: "Tester"},
	}

	err := stage.Run(context.Background(), job)
	require.NoError(t, err)

	// Verify map.json
	mapData, err := os.ReadFile(filepath.Join(dir, "map.json"))
	require.NoError(t, err)
	var mj mapJSON
	require.NoError(t, json.Unmarshal(mapData, &mj))
	assert.Equal(t, "testworld", mj.Name)
	assert.Equal(t, 10240, mj.WorldSize)
	assert.True(t, mj.Maplibre)

	// Verify meta.json
	metaData, err := os.ReadFile(filepath.Join(dir, "meta.json"))
	require.NoError(t, err)
	var meta worldMetaJSON
	require.NoError(t, json.Unmarshal(metaData, &meta))
	assert.Equal(t, "testworld", meta.WorldName)
	assert.Equal(t, "Test World", meta.DisplayName)
	assert.Equal(t, "Tester", meta.Author)
	assert.Equal(t, 10240, meta.WorldSize)
	assert.Equal(t, []string{"sea", "house"}, meta.FeatureLayers)
}

func TestNewGenerateStylesStage_SubDirsMkdirError(t *testing.T) {
	// OutputDir is a file, so MkdirAll for styles/ subdir fails
	dir := t.TempDir()
	blocker := filepath.Join(dir, "styles")
	require.NoError(t, os.WriteFile(blocker, []byte("blocker"), 0644))

	stage := NewGenerateStylesStage()
	job := &Job{
		WorldName:    "testworld",
		OutputDir:    dir,
		SubDirs:      true,
		VectorLayers: []string{"sea"},
	}

	err := stage.Run(context.Background(), job)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "create styles dir")
}

func TestNewGenerateGradMehMetadataStage_WriteError(t *testing.T) {
	// OutputDir is read-only so writeJSON fails
	dir := t.TempDir()
	require.NoError(t, os.Chmod(dir, 0555))
	t.Cleanup(func() { os.Chmod(dir, 0755) })

	stage := NewGenerateGradMehMetadataStage()
	job := &Job{
		WorldName:    "testworld",
		WorldSize:    256,
		OutputDir:    dir,
		VectorLayers: []string{"sea"},
	}

	err := stage.Run(context.Background(), job)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "write map.json")
}

func TestNewGenerateGradMehMetadataStage_WithDEM(t *testing.T) {
	dir := t.TempDir()
	stage := NewGenerateGradMehMetadataStage()
	job := &Job{
		WorldName:    "testworld",
		WorldSize:    256,
		OutputDir:    dir,
		VectorLayers: []string{"sea"},
		DEMGrid:      &DEMGrid{Data: []float32{0, 50, 100}},
	}

	err := stage.Run(context.Background(), job)
	require.NoError(t, err)

	metaData, err := os.ReadFile(filepath.Join(dir, "meta.json"))
	require.NoError(t, err)
	var meta worldMetaJSON
	require.NoError(t, json.Unmarshal(metaData, &meta))
	require.NotNil(t, meta.Elevation)
	assert.Equal(t, 0.0, meta.Elevation.Min)
	assert.Equal(t, 100.0, meta.Elevation.Max)
}
