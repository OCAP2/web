package maptool

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- Test fixture builders ---

// buildTestGradMehExport creates a complete synthetic grad_meh export directory
// with meta.json, satellite tiles, DEM grid, and GeoJSON vector layers.
// The fixture is a tiny (256m) world suitable for fast pipeline testing.
func buildTestGradMehExport(t *testing.T) string {
	t.Helper()

	const worldSize = 256

	dir := filepath.Join(t.TempDir(), "testworld")
	require.NoError(t, os.MkdirAll(dir, 0755))

	// 1. meta.json
	meta := map[string]any{
		"worldName":   "testworld",
		"worldSize":   worldSize,
		"displayName": "Test World",
		"author":      "integration-test",
		"version":     "1.0",
	}
	metaJSON, err := json.MarshalIndent(meta, "", "  ")
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(dir, "meta.json"), metaJSON, 0644))

	// 2. Satellite tiles: single 256x256 PNG covering the full world
	satDir := filepath.Join(dir, "sat", "0")
	require.NoError(t, os.MkdirAll(satDir, 0755))
	writeTestPNG(t, filepath.Join(satDir, "0.png"), worldSize, worldSize)

	// 3. DEM (dem.asc.gz): 8x8 elevation grid with a centered hill peaking at 60m
	writeTestDEMGz(t, filepath.Join(dir, "dem.asc.gz"), 8, float64(worldSize)/8)

	// 4. Preview image (512x512 to exercise resizing)
	writeTestPNG(t, filepath.Join(dir, "preview.png"), 512, 512)

	// 5. GeoJSON layers
	geojsonDir := filepath.Join(dir, "geojson")
	require.NoError(t, os.MkdirAll(geojsonDir, 0755))
	writeTestGeoJSONGz(t, filepath.Join(geojsonDir, "house.geojson.gz"), testHouseFeatures())
	writeTestGeoJSONGz(t, filepath.Join(geojsonDir, "road.geojson.gz"), testRoadFeatures())

	return dir
}

// writeTestPNG creates a small PNG image with a gradient pattern.
func writeTestPNG(t *testing.T, path string, w, h int) {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			img.SetNRGBA(x, y, color.NRGBA{
				R: uint8((x * 255) / max(w-1, 1)),
				G: uint8((y * 255) / max(h-1, 1)),
				B: 100,
				A: 255,
			})
		}
	}
	f, err := os.Create(path)
	require.NoError(t, err)
	defer func() { require.NoError(t, f.Close()) }()
	require.NoError(t, png.Encode(f, img))
}

// writeTestDEMGz creates a gzipped ESRI ASCII Grid file with a centered hill.
// Grid origin is at (0,0) with the specified cellSize.
func writeTestDEMGz(t *testing.T, path string, gridSize int, cellSize float64) {
	t.Helper()

	// Symmetric hill: 0 at edges, peak at center
	elevation := make([][]float64, gridSize)
	center := float64(gridSize-1) / 2
	for row := range gridSize {
		elevation[row] = make([]float64, gridSize)
		for col := range gridSize {
			dx := float64(col) - center
			dy := float64(row) - center
			dist := (dx*dx + dy*dy) / (center * center)
			if dist < 1 {
				elevation[row][col] = 60 * (1 - dist) // peak 60m at center
			}
		}
	}

	var asc strings.Builder
	fmt.Fprintf(&asc, "ncols %d\n", gridSize)
	fmt.Fprintf(&asc, "nrows %d\n", gridSize)
	fmt.Fprintf(&asc, "xllcorner 0.0\n")
	fmt.Fprintf(&asc, "yllcorner 0.0\n")
	fmt.Fprintf(&asc, "cellsize %f\n", cellSize)
	fmt.Fprintf(&asc, "nodata_value -9999\n")
	// ASC format: row 0 = north (top), last row = south (bottom)
	for row := range gridSize {
		vals := make([]string, gridSize)
		for col := range gridSize {
			vals[col] = fmt.Sprintf("%.1f", elevation[row][col])
		}
		fmt.Fprintln(&asc, strings.Join(vals, " "))
	}

	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	_, err := gz.Write([]byte(asc.String()))
	require.NoError(t, err)
	require.NoError(t, gz.Close())
	require.NoError(t, os.WriteFile(path, buf.Bytes(), 0644))
}

// writeTestGeoJSONGz writes a bare JSON array of GeoJSON features (grad_meh format) as .geojson.gz.
func writeTestGeoJSONGz(t *testing.T, path string, features []any) {
	t.Helper()
	data, err := json.Marshal(features)
	require.NoError(t, err)

	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	_, err = gz.Write(data)
	require.NoError(t, err)
	require.NoError(t, gz.Close())
	require.NoError(t, os.WriteFile(path, buf.Bytes(), 0644))
}

// testHouseFeatures returns a small building polygon in Arma meters.
func testHouseFeatures() []any {
	return []any{
		map[string]any{
			"type": "Feature",
			"geometry": map[string]any{
				"type": "Polygon",
				"coordinates": [][][2]float64{
					{{100, 100}, {110, 100}, {110, 110}, {100, 110}, {100, 100}},
				},
			},
			"properties": map[string]any{
				"color": []float64{0.5, 0.5, 0.5},
			},
		},
	}
}

// testRoadFeatures returns a road linestring crossing the map in Arma meters.
func testRoadFeatures() []any {
	return []any{
		map[string]any{
			"type": "Feature",
			"geometry": map[string]any{
				"type":        "LineString",
				"coordinates": [][2]float64{{10, 128}, {246, 128}},
			},
			"properties": map[string]any{
				"color": []float64{1, 1, 1},
				"width": 6,
			},
		},
	}
}

// requiredToolsAvailable checks whether the minimum tools for the full pipeline
// are present and returns the detected toolset. Returns ("", nil, tools) on success
// or (reason, nil, tools) if tools are missing.
func requiredToolsAvailable() (skipReason string, tools ToolSet) {
	tools = DetectTools()
	if missing := tools.MissingRequired(); len(missing) > 0 {
		var names []string
		for _, m := range missing {
			names = append(names, m.Name)
		}
		return fmt.Sprintf("required tools not found: %s", strings.Join(names, ", ")), tools
	}
	for _, name := range []string{"gdal_translate", "tile-join"} {
		if _, ok := tools.FindTool(name); !ok {
			return fmt.Sprintf("%s not found", name), tools
		}
	}
	return "", tools
}

// --- Integration tests ---

// TestIntegration_FullPipeline runs the complete grad_meh pipeline end-to-end
// against a synthetic test fixture. Requires pmtiles, tippecanoe, tile-join,
// and gdal_translate to be installed. Skipped in short mode or when tools are missing.
func TestIntegration_FullPipeline(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}

	skipReason, tools := requiredToolsAvailable()
	if skipReason != "" {
		t.Skipf("skipping: %s", skipReason)
	}

	inputDir := buildTestGradMehExport(t)
	outputDir := t.TempDir()
	tempDir := t.TempDir()

	job := &Job{
		ID:        "integration-test",
		WorldName: "testworld",
		InputPath: inputDir,
		OutputDir: outputDir,
		TempDir:   tempDir,
		SubDirs:   true,
	}

	pipeline := BuildGradMehPipeline(tools)
	err := pipeline.Run(context.Background(), job)
	require.NoError(t, err)
	assert.Equal(t, StatusDone, job.Status)

	// Verify map.json
	var mapDoc mapJSON
	readJSON(t, filepath.Join(outputDir, "map.json"), &mapDoc)
	assert.Equal(t, "testworld", mapDoc.Name)
	assert.Equal(t, 256, mapDoc.WorldSize)
	assert.True(t, mapDoc.Maplibre)
	assert.Greater(t, mapDoc.MaxZoom, 0)

	// Verify meta.json
	var metaDoc worldMetaJSON
	readJSON(t, filepath.Join(outputDir, "meta.json"), &metaDoc)
	assert.Equal(t, "testworld", metaDoc.WorldName)
	assert.Equal(t, "Test World", metaDoc.DisplayName)
	assert.Equal(t, 256, metaDoc.WorldSize)
	assert.Contains(t, metaDoc.FeatureLayers, "house")
	assert.Contains(t, metaDoc.FeatureLayers, "road")

	// Verify satellite PMTiles
	assertFileExists(t, filepath.Join(outputDir, "tiles", "satellite.pmtiles"))

	// Verify vector PMTiles
	assertFileExists(t, filepath.Join(outputDir, "tiles", "features.pmtiles"))

	// Verify preview thumbnails
	for _, size := range []int{256, 512, 1024} {
		assertFileExists(t, filepath.Join(outputDir, fmt.Sprintf("preview_%d.png", size)))
	}

	// Verify style files
	for _, name := range []string{"topo.json", "topo-dark.json", "topo-relief.json", "color-relief.json"} {
		assertFileExists(t, filepath.Join(outputDir, "styles", name))
	}
}

// TestIntegration_CoreStages tests the pipeline stages that require no external
// tools: metadata parsing, satellite scanning, GeoJSON processing, style
// generation, and metadata output. Always runs (no tool dependencies).
func TestIntegration_CoreStages(t *testing.T) {
	inputDir := buildTestGradMehExport(t)
	outputDir := t.TempDir()
	tempDir := t.TempDir()

	job := &Job{
		ID:        "core-stages-test",
		WorldName: "testworld",
		InputPath: inputDir,
		OutputDir: outputDir,
		TempDir:   tempDir,
		SubDirs:   true,
	}

	// Build a pipeline with only Go-native stages (no external tools needed)
	stages := []Stage{
		NewParseGradMehStage(),
		NewGradMehSatelliteStage(),
		NewProcessGeoJSONStage(),
		NewGenerateStylesStage(),
		NewGenerateGradMehMetadataStage(),
	}
	pipeline := NewPipeline(stages)
	err := pipeline.Run(context.Background(), job)
	require.NoError(t, err)
	assert.Equal(t, StatusDone, job.Status)

	// Verify parsing populated job fields
	assert.Equal(t, "testworld", job.WorldName)
	assert.Equal(t, 256, job.WorldSize)
	assert.NotNil(t, job.GradMehMeta)
	assert.Equal(t, "Test World", job.GradMehMeta.DisplayName)

	// Verify satellite scan built a VRT
	assert.NotEmpty(t, job.SatImage)
	assertFileExists(t, job.SatImage)
	assert.Equal(t, 256, job.ImageSize)

	// Verify GeoJSON processing found our test layers
	assert.GreaterOrEqual(t, len(job.LayerFiles), 2, "should have at least house + road layers")
	assert.Contains(t, job.VectorLayers, "house")
	assert.Contains(t, job.VectorLayers, "road")

	// Verify Go contour fallback ran (DEM has elevations above 0)
	assert.True(t, slices.Contains(job.VectorLayers, "contours"),
		"Go contour fallback should have generated contours from DEM")

	// Verify style files were generated
	assert.True(t, job.HasMaplibre)
	for _, name := range []string{"topo.json", "topo-dark.json", "topo-relief.json", "color-relief.json"} {
		assertFileExists(t, filepath.Join(outputDir, "styles", name))
	}

	// Verify map.json
	var mapDoc mapJSON
	readJSON(t, filepath.Join(outputDir, "map.json"), &mapDoc)
	assert.Equal(t, "testworld", mapDoc.Name)
	assert.Equal(t, 256, mapDoc.WorldSize)
	assert.True(t, mapDoc.Maplibre)

	// Verify meta.json
	var metaDoc worldMetaJSON
	readJSON(t, filepath.Join(outputDir, "meta.json"), &metaDoc)
	assert.Equal(t, "testworld", metaDoc.WorldName)
	assert.Equal(t, "Test World", metaDoc.DisplayName)
	assert.Contains(t, metaDoc.FeatureLayers, "house")
	assert.Contains(t, metaDoc.FeatureLayers, "road")
}

// TestIntegration_JobManager tests the full pipeline via the JobManager,
// verifying the job lifecycle (pending → running → done) and cleanup.
func TestIntegration_JobManager(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}

	skipReason, tools := requiredToolsAvailable()
	if skipReason != "" {
		t.Skipf("skipping: %s", skipReason)
	}

	inputDir := buildTestGradMehExport(t)
	mapsDir := t.TempDir()

	mgr := NewJobManager(mapsDir, func() *Pipeline {
		return BuildGradMehPipeline(tools)
	})

	go mgr.Start(t.Context())

	snap, err := mgr.Submit(inputDir, "testworld")
	require.NoError(t, err)
	assert.Equal(t, "testworld", snap.WorldName)

	// Wait for job completion by polling
	var finalSnap *JobInfo
	require.Eventually(t, func() bool {
		finalSnap = mgr.GetJob(snap.ID)
		return finalSnap != nil && (finalSnap.Status == StatusDone || finalSnap.Status == StatusFailed)
	}, 60*time.Second, 100*time.Millisecond, "job should complete within 60s")

	require.Equal(t, StatusDone, finalSnap.Status, "job failed: %s", finalSnap.Error)

	// Verify outputs in maps directory
	assertFileExists(t, filepath.Join(mapsDir, "testworld", "map.json"))
	assertFileExists(t, filepath.Join(mapsDir, "testworld", "meta.json"))
	assertFileExists(t, filepath.Join(mapsDir, "testworld", "tiles", "satellite.pmtiles"))
}

// TestIntegration_RestyleWorld verifies that RestyleWorld regenerates styles
// from existing pipeline output (meta.json + tiles/). No external tools needed.
func TestIntegration_RestyleWorld(t *testing.T) {
	// Set up a fake maps/testworld directory with meta.json and tiles/
	mapsDir := t.TempDir()
	worldDir := filepath.Join(mapsDir, "testworld")
	tilesDir := filepath.Join(worldDir, "tiles")
	require.NoError(t, os.MkdirAll(tilesDir, 0755))

	meta := worldMetaJSON{
		WorldName:     "testworld",
		DisplayName:   "Test World",
		WorldSize:     256,
		FeatureLayers: []string{"house", "road"},
	}
	data, err := json.MarshalIndent(meta, "", "  ")
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(worldDir, "meta.json"), data, 0644))

	// Create dummy pmtiles so the style config detects them
	for _, name := range []string{"satellite.pmtiles", "features.pmtiles"} {
		require.NoError(t, os.WriteFile(filepath.Join(tilesDir, name), []byte("dummy"), 0644))
	}

	err = RestyleWorld(mapsDir, "testworld")
	require.NoError(t, err)

	for _, name := range []string{"topo.json", "topo-dark.json", "topo-relief.json", "color-relief.json"} {
		assertFileExists(t, filepath.Join(worldDir, "styles", name))
	}
}

// --- Helpers ---

func readJSON(t *testing.T, path string, v any) {
	t.Helper()
	data, err := os.ReadFile(path)
	require.NoError(t, err, "read %s", filepath.Base(path))
	require.NoError(t, json.Unmarshal(data, v), "parse %s", filepath.Base(path))
}

func assertFileExists(t *testing.T, path string) {
	t.Helper()
	info, err := os.Stat(path)
	assert.NoError(t, err, "expected file to exist: %s", filepath.Base(path))
	if err == nil {
		assert.Greater(t, info.Size(), int64(0), "file should not be empty: %s", filepath.Base(path))
	}
}
