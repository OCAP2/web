package server

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	pbv1 "github.com/OCAP2/web/pkg/schemas/protobuf/v1"
	"github.com/OCAP2/web/internal/storage"
	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/proto"
)

// TestIntegration_ConversionAndPlayback tests the complete flow:
// 1. Store JSON recording
// 2. Convert to protobuf
// 3. Fetch manifest
// 4. Fetch chunks
func TestIntegration_ConversionAndPlayback(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")
	dataDir := filepath.Join(dir, "data")

	err := os.MkdirAll(dataDir, 0755)
	require.NoError(t, err)

	// Create repository
	repo, err := NewRepoOperation(dbPath)
	require.NoError(t, err)
	defer repo.db.Close()

	// Create test JSON recording
	testRecording := map[string]interface{}{
		"worldName":    "altis",
		"missionName":  "Integration Test Mission",
		"captureDelay": 1.0,
		"endFrame":     10,
		"entities": []map[string]interface{}{
			{
				"id":            1,
				"type":          "unit",
				"startFrameNum": 0,
				"name":          "Player1",
				"group":         "Alpha",
				"side":          "WEST",
				"isPlayer":      1,
				"positions": [][]interface{}{
					{[]float64{100, 200}, 45.0, 1.0, 0.0, "Player1", 1.0},
					{[]float64{101, 201}, 46.0, 1.0, 0.0, "Player1", 1.0},
					{[]float64{102, 202}, 47.0, 1.0, 0.0, "Player1", 1.0},
					{[]float64{103, 203}, 48.0, 1.0, 0.0, "Player1", 1.0},
					{[]float64{104, 204}, 49.0, 1.0, 0.0, "Player1", 1.0},
					{[]float64{105, 205}, 50.0, 1.0, 0.0, "Player1", 1.0},
					{[]float64{106, 206}, 51.0, 1.0, 0.0, "Player1", 1.0},
					{[]float64{107, 207}, 52.0, 1.0, 0.0, "Player1", 1.0},
					{[]float64{108, 208}, 53.0, 1.0, 0.0, "Player1", 1.0},
					{[]float64{109, 209}, 54.0, 0.0, 0.0, "Player1", 1.0}, // Dead at frame 9
				},
				"framesFired": []interface{}{},
			},
			{
				"id":            2,
				"type":          "vehicle",
				"startFrameNum": 0,
				"name":          "Hunter",
				"class":         "B_MRAP_01_F",
				"positions": [][]interface{}{
					{[]float64{500, 600}, 0.0, 1.0, []interface{}{1}},
					{[]float64{501, 601}, 1.0, 1.0, []interface{}{1}},
					{[]float64{502, 602}, 2.0, 1.0, []interface{}{}},
					{[]float64{503, 603}, 3.0, 1.0, []interface{}{}},
					{[]float64{504, 604}, 4.0, 1.0, []interface{}{}},
					{[]float64{505, 605}, 5.0, 1.0, []interface{}{}},
					{[]float64{506, 606}, 6.0, 1.0, []interface{}{}},
					{[]float64{507, 607}, 7.0, 1.0, []interface{}{}},
					{[]float64{508, 608}, 8.0, 1.0, []interface{}{}},
					{[]float64{509, 609}, 9.0, 0.0, []interface{}{}}, // Destroyed
				},
			},
		},
		"events": [][]interface{}{
			{9, "killed", 1, []interface{}{0}, 0},
		},
		"times":   []interface{}{},
		"Markers": []interface{}{},
	}

	// Write gzipped JSON file
	jsonPath := filepath.Join(dataDir, "test_integration.gz")
	writeTestGzippedJSON(t, jsonPath, testRecording)

	// Store operation in database
	ctx := context.Background()
	op := &Operation{
		WorldName:        "altis",
		MissionName:      "Integration Test Mission",
		MissionDuration:  10,
		Filename:         "test_integration",
		Date:             "2026-01-30",
		Tag:              "coop",
		StorageFormat:    "json",
		ConversionStatus: "completed",
	}
	err = repo.Store(ctx, op)
	require.NoError(t, err)

	// Register storage engines
	storage.RegisterEngine(storage.NewJSONEngine(dataDir))
	storage.RegisterEngine(storage.NewProtobufEngine(dataDir))

	// Create handler
	hdlr := Handler{
		repoOperation: repo,
		setting:       Setting{Data: dataDir},
	}

	// Test 1: Get format info (JSON)
	t.Run("GetFormatJSON", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/operations/1/format", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetParamNames("id")
		c.SetParamValues("1")

		err := hdlr.GetOperationFormat(c)
		assert.NoError(t, err)
		assert.Equal(t, http.StatusOK, rec.Code)

		var formatInfo FormatInfo
		err = json.Unmarshal(rec.Body.Bytes(), &formatInfo)
		assert.NoError(t, err)
		assert.Equal(t, "json", formatInfo.Format)
		assert.False(t, formatInfo.SupportsStreaming)
	})

	// Test 2: Get manifest (JSON format returns JSON)
	t.Run("GetManifestJSON", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/operations/1/manifest", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetParamNames("id")
		c.SetParamValues("1")

		err := hdlr.GetOperationManifest(c)
		assert.NoError(t, err)
		assert.Equal(t, http.StatusOK, rec.Code)

		var manifest storage.Manifest
		err = json.Unmarshal(rec.Body.Bytes(), &manifest)
		assert.NoError(t, err)
		assert.Equal(t, "altis", manifest.WorldName)
		assert.Equal(t, "Integration Test Mission", manifest.MissionName)
		assert.Len(t, manifest.Entities, 2)
	})

	// Test 3: Convert to protobuf
	t.Run("ConvertToProtobuf", func(t *testing.T) {
		converter := storage.NewConverter(5) // 5 frames per chunk for testing
		outputPath := filepath.Join(dataDir, "test_integration")
		err := converter.Convert(ctx, jsonPath, outputPath, "protobuf")
		require.NoError(t, err)

		// Update database
		err = repo.UpdateStorageFormat(ctx, 1, "protobuf")
		require.NoError(t, err)
		err = repo.UpdateConversionStatus(ctx, 1, "completed")
		require.NoError(t, err)
	})

	// Test 4: Get format info (Protobuf)
	t.Run("GetFormatProtobuf", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/operations/1/format", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetParamNames("id")
		c.SetParamValues("1")

		err := hdlr.GetOperationFormat(c)
		assert.NoError(t, err)
		assert.Equal(t, http.StatusOK, rec.Code)

		var formatInfo FormatInfo
		err = json.Unmarshal(rec.Body.Bytes(), &formatInfo)
		assert.NoError(t, err)
		assert.Equal(t, "protobuf", formatInfo.Format)
		assert.True(t, formatInfo.SupportsStreaming)
		assert.Equal(t, 2, formatInfo.ChunkCount) // 10 frames / 5 per chunk = 2 chunks
	})

	// Test 5: Get manifest (Protobuf)
	t.Run("GetManifestProtobuf", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/operations/1/manifest", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetParamNames("id")
		c.SetParamValues("1")

		err := hdlr.GetOperationManifest(c)
		assert.NoError(t, err)
		assert.Equal(t, http.StatusOK, rec.Code)
		assert.Equal(t, "application/x-protobuf", rec.Header().Get("Content-Type"))

		// Skip 4-byte version prefix
		data := rec.Body.Bytes()
		require.Greater(t, len(data), 4)
		data = data[4:]

		var manifest pbv1.Manifest
		err = proto.Unmarshal(data, &manifest)
		assert.NoError(t, err)
		assert.Equal(t, "altis", manifest.WorldName)
		assert.Equal(t, "Integration Test Mission", manifest.MissionName)
		assert.Len(t, manifest.Entities, 2)
		assert.Equal(t, uint32(5), manifest.ChunkSize)
		assert.Equal(t, uint32(2), manifest.ChunkCount)
	})

	// Test 6: Get chunk 0
	t.Run("GetChunk0", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/operations/1/chunk/0", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetParamNames("id", "index")
		c.SetParamValues("1", "0")

		err := hdlr.GetOperationChunk(c)
		assert.NoError(t, err)
		assert.Equal(t, http.StatusOK, rec.Code)
		assert.Equal(t, "application/x-protobuf", rec.Header().Get("Content-Type"))

		// Skip 4-byte version prefix
		data := rec.Body.Bytes()
		require.Greater(t, len(data), 4)
		data = data[4:]

		var chunk pbv1.Chunk
		err = proto.Unmarshal(data, &chunk)
		assert.NoError(t, err)
		assert.Equal(t, uint32(0), chunk.Index)
		assert.Equal(t, uint32(0), chunk.StartFrame)
		assert.Equal(t, uint32(5), chunk.FrameCount)
		assert.Len(t, chunk.Frames, 5)

		// Verify first frame has both entities
		firstFrame := chunk.Frames[0]
		assert.Len(t, firstFrame.Entities, 2)
	})

	// Test 7: Get chunk 1
	t.Run("GetChunk1", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/operations/1/chunk/1", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetParamNames("id", "index")
		c.SetParamValues("1", "1")

		err := hdlr.GetOperationChunk(c)
		assert.NoError(t, err)
		assert.Equal(t, http.StatusOK, rec.Code)

		// Skip 4-byte version prefix
		data := rec.Body.Bytes()
		require.Greater(t, len(data), 4)
		data = data[4:]

		var chunk pbv1.Chunk
		err = proto.Unmarshal(data, &chunk)
		assert.NoError(t, err)
		assert.Equal(t, uint32(1), chunk.Index)
		assert.Equal(t, uint32(5), chunk.StartFrame)
		assert.Equal(t, uint32(5), chunk.FrameCount) // Remaining 5 frames
	})

	// Test 8: Invalid chunk index
	t.Run("GetChunkInvalid", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/operations/1/chunk/999", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetParamNames("id", "index")
		c.SetParamValues("1", "999")

		err := hdlr.GetOperationChunk(c)
		assert.Error(t, err)
	})
}

// TestIntegration_PendingConversion tests the conversion status workflow
func TestIntegration_PendingConversion(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")

	repo, err := NewRepoOperation(dbPath)
	require.NoError(t, err)
	defer repo.db.Close()

	ctx := context.Background()

	// Store operation as pending
	op := &Operation{
		WorldName:        "altis",
		MissionName:      "Pending Test",
		MissionDuration:  100,
		Filename:         "pending_test",
		Date:             "2026-01-30",
		Tag:              "coop",
		StorageFormat:    "json",
		ConversionStatus: "pending",
	}
	err = repo.Store(ctx, op)
	require.NoError(t, err)

	// Verify pending operations can be selected
	pending, err := repo.SelectPending(ctx, 10)
	require.NoError(t, err)
	assert.Len(t, pending, 1)
	assert.Equal(t, "pending_test", pending[0].Filename)

	// Update status to converting
	err = repo.UpdateConversionStatus(ctx, 1, "converting")
	require.NoError(t, err)

	// Verify no longer in pending list
	pending, err = repo.SelectPending(ctx, 10)
	require.NoError(t, err)
	assert.Len(t, pending, 0)

	// Update to completed with protobuf format
	err = repo.UpdateConversionStatus(ctx, 1, "completed")
	require.NoError(t, err)
	err = repo.UpdateStorageFormat(ctx, 1, "protobuf")
	require.NoError(t, err)

	// Verify final state
	updated, err := repo.GetByID(ctx, "1")
	require.NoError(t, err)
	assert.Equal(t, "protobuf", updated.StorageFormat)
	assert.Equal(t, "completed", updated.ConversionStatus)
}

func writeTestGzippedJSON(t *testing.T, path string, data interface{}) {
	t.Helper()

	f, err := os.Create(path)
	require.NoError(t, err)
	defer f.Close()

	gw := gzip.NewWriter(f)
	defer gw.Close()

	err = json.NewEncoder(gw).Encode(data)
	require.NoError(t, err)
}

// TestIntegration_MarkerServing tests full HTTP flow for marker requests
func TestIntegration_MarkerServing(t *testing.T) {
	dir := t.TempDir()
	markerDir := filepath.Join(dir, "markers")
	err := os.MkdirAll(markerDir, 0755)
	require.NoError(t, err)

	// Create SVG marker
	svgContent := `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="40" fill="#{{.}}"/>
</svg>`
	err = os.WriteFile(filepath.Join(markerDir, "man.svg"), []byte(svgContent), 0644)
	require.NoError(t, err)

	// Create PNG marker as fallback "unknown"
	unknownPath := filepath.Join(markerDir, "unknown.png")
	createIntegrationTestPNG(t, unknownPath)

	// Create marker repository
	repoMarker, err := NewRepoMarker(markerDir)
	require.NoError(t, err)

	// Create handler
	hdlr := Handler{
		repoMarker: repoMarker,
		setting:    Setting{Markers: markerDir},
	}

	t.Run("GET SVG marker with named color", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/images/markers/man/blufor", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetParamNames("name", "color")
		c.SetParamValues("man", "blufor")

		err := hdlr.GetMarker(c)
		assert.NoError(t, err)
		assert.Equal(t, http.StatusOK, rec.Code)
		assert.Equal(t, "image/svg+xml", rec.Header().Get("Content-Type"))

		// Verify color substitution (blufor = 004c99)
		body := rec.Body.String()
		assert.Contains(t, body, "004c99ff")
	})

	t.Run("GET SVG marker with hex color", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/images/markers/man/ff0000", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetParamNames("name", "color")
		c.SetParamValues("man", "ff0000")

		err := hdlr.GetMarker(c)
		assert.NoError(t, err)
		assert.Equal(t, http.StatusOK, rec.Code)

		body := rec.Body.String()
		assert.Contains(t, body, "ff0000ff")
	})

	t.Run("GET PNG marker (unknown fallback)", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/images/markers/unknown/dead", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetParamNames("name", "color")
		c.SetParamValues("unknown", "dead")

		err := hdlr.GetMarker(c)
		assert.NoError(t, err)
		assert.Equal(t, http.StatusOK, rec.Code)
		assert.Equal(t, "image/png", rec.Header().Get("Content-Type"))

		// Verify it's valid PNG data
		img, err := png.Decode(rec.Body)
		assert.NoError(t, err)
		assert.NotNil(t, img)
	})

	t.Run("GET nonexistent marker falls back to unknown", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/images/markers/nonexistent/blufor", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetParamNames("name", "color")
		c.SetParamValues("nonexistent", "blufor")

		err := hdlr.GetMarker(c)
		assert.NoError(t, err)
		assert.Equal(t, http.StatusOK, rec.Code)
		// Falls back to unknown.png
		assert.Equal(t, "image/png", rec.Header().Get("Content-Type"))
	})

	t.Run("GET marker with invalid color", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/images/markers/man/invalidcolor", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetParamNames("name", "color")
		c.SetParamValues("man", "invalidcolor")

		err := hdlr.GetMarker(c)
		assert.Error(t, err)
		assert.ErrorIs(t, err, ErrNotFound)
	})

	t.Run("GET marker with color extension stripped", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/images/markers/man/blufor.png", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetParamNames("name", "color")
		c.SetParamValues("man", "blufor.png")

		err := hdlr.GetMarker(c)
		assert.NoError(t, err)
		assert.Equal(t, http.StatusOK, rec.Code)
		// Should work after stripping .png
	})

	t.Run("GET marker case insensitive", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/images/markers/MAN/BLUFOR", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetParamNames("name", "color")
		c.SetParamValues("MAN", "BLUFOR")

		err := hdlr.GetMarker(c)
		assert.NoError(t, err)
		assert.Equal(t, http.StatusOK, rec.Code)
	})
}

// TestIntegration_AmmoServing tests full HTTP flow for ammo icon requests
func TestIntegration_AmmoServing(t *testing.T) {
	dir := t.TempDir()
	ammoDir := filepath.Join(dir, "ammo")
	err := os.MkdirAll(ammoDir, 0755)
	require.NoError(t, err)

	// Create subdirectory for mod-specific ammo
	aceDir := filepath.Join(ammoDir, "ace")
	err = os.MkdirAll(aceDir, 0755)
	require.NoError(t, err)

	// Create test ammo icons
	createIntegrationTestPNG(t, filepath.Join(ammoDir, "grenade.png"))
	createIntegrationTestPNG(t, filepath.Join(aceDir, "ace_m84_x_ca.png"))

	// Create ammo repository
	repoAmmo, err := NewRepoAmmo(ammoDir)
	require.NoError(t, err)

	// Create handler
	hdlr := Handler{
		repoAmmo: repoAmmo,
		setting:  Setting{Ammo: ammoDir},
	}

	t.Run("GET ammo icon", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/images/markers/magicons/grenade", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetParamNames("name")
		c.SetParamValues("grenade")

		err := hdlr.GetAmmo(c)
		assert.NoError(t, err)
		assert.Equal(t, http.StatusOK, rec.Code)
	})

	t.Run("GET ammo from subdirectory", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/images/markers/magicons/ace_m84_x_ca", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetParamNames("name")
		c.SetParamValues("ace_m84_x_ca")

		err := hdlr.GetAmmo(c)
		assert.NoError(t, err)
		assert.Equal(t, http.StatusOK, rec.Code)
	})

	t.Run("GET ammo case insensitive", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/images/markers/magicons/GRENADE", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetParamNames("name")
		c.SetParamValues("GRENADE")

		err := hdlr.GetAmmo(c)
		assert.NoError(t, err)
		assert.Equal(t, http.StatusOK, rec.Code)
	})

	t.Run("GET ammo with extension stripped", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/images/markers/magicons/grenade.png", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetParamNames("name")
		c.SetParamValues("grenade.png")

		err := hdlr.GetAmmo(c)
		assert.NoError(t, err)
		assert.Equal(t, http.StatusOK, rec.Code)
	})

	t.Run("GET ammo with .paa.png format", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/images/markers/magicons/grenade.paa.png", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetParamNames("name")
		c.SetParamValues("grenade.paa.png")

		err := hdlr.GetAmmo(c)
		assert.NoError(t, err)
		assert.Equal(t, http.StatusOK, rec.Code)
	})

	t.Run("GET nonexistent ammo", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/images/markers/magicons/nonexistent", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetParamNames("name")
		c.SetParamValues("nonexistent")

		err := hdlr.GetAmmo(c)
		assert.Error(t, err)
		assert.ErrorIs(t, err, ErrNotFound)
	})
}

// TestIntegration_MarkerColorVariants tests all named color variants
func TestIntegration_MarkerColorVariants(t *testing.T) {
	dir := t.TempDir()
	markerDir := filepath.Join(dir, "markers")
	err := os.MkdirAll(markerDir, 0755)
	require.NoError(t, err)

	// Create SVG marker
	svgContent := `<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#{{.}}"/></svg>`
	err = os.WriteFile(filepath.Join(markerDir, "test.svg"), []byte(svgContent), 0644)
	require.NoError(t, err)

	repoMarker, err := NewRepoMarker(markerDir)
	require.NoError(t, err)

	hdlr := Handler{
		repoMarker: repoMarker,
		setting:    Setting{Markers: markerDir},
	}

	// All named colors that should work
	colors := []string{
		"follow", "hit", "dead", "default", "black", "grey", "red", "brown",
		"orange", "yellow", "khaki", "green", "blue", "pink", "white", "unknown",
		"blufor", "west", "opfor", "east", "ind", "independent", "guer",
		"civ", "civilian", "unconscious",
	}

	for _, colorName := range colors {
		t.Run("color_"+colorName, func(t *testing.T) {
			e := echo.New()
			req := httptest.NewRequest(http.MethodGet, "/images/markers/test/"+colorName, nil)
			rec := httptest.NewRecorder()
			c := e.NewContext(req, rec)
			c.SetParamNames("name", "color")
			c.SetParamValues("test", colorName)

			err := hdlr.GetMarker(c)
			assert.NoError(t, err, "color %s should be valid", colorName)
			assert.Equal(t, http.StatusOK, rec.Code)
		})
	}
}

// TestIntegration_FullMarkerFlow tests complete marker workflow with real assets structure
func TestIntegration_FullMarkerFlow(t *testing.T) {
	dir := t.TempDir()

	// Create directory structure similar to production
	markerDir := filepath.Join(dir, "assets", "markers")
	a3Dir := filepath.Join(markerDir, "a3")
	modDir := filepath.Join(markerDir, "custom_mod")

	for _, d := range []string{a3Dir, modDir} {
		err := os.MkdirAll(d, 0755)
		require.NoError(t, err)
	}

	// Create markers in different directories
	svgContent := `<svg><circle fill="#{{.}}"/></svg>`
	err := os.WriteFile(filepath.Join(a3Dir, "infantry.svg"), []byte(svgContent), 0644)
	require.NoError(t, err)

	createIntegrationTestPNG(t, filepath.Join(modDir, "special_unit.png"))
	createIntegrationTestPNG(t, filepath.Join(markerDir, "unknown.png"))

	repoMarker, err := NewRepoMarker(markerDir)
	require.NoError(t, err)

	hdlr := Handler{
		repoMarker: repoMarker,
		setting:    Setting{Markers: markerDir},
	}

	t.Run("access marker from subdirectory", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/images/markers/infantry/blufor", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetParamNames("name", "color")
		c.SetParamValues("infantry", "blufor")

		err := hdlr.GetMarker(c)
		assert.NoError(t, err)
		assert.Equal(t, http.StatusOK, rec.Code)
		assert.Equal(t, "image/svg+xml", rec.Header().Get("Content-Type"))
	})

	t.Run("access mod marker", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/images/markers/special_unit/opfor", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetParamNames("name", "color")
		c.SetParamValues("special_unit", "opfor")

		err := hdlr.GetMarker(c)
		assert.NoError(t, err)
		assert.Equal(t, http.StatusOK, rec.Code)
		assert.Equal(t, "image/png", rec.Header().Get("Content-Type"))
	})

	t.Run("fallback to unknown for missing marker", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/images/markers/does_not_exist/blufor", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetParamNames("name", "color")
		c.SetParamValues("does_not_exist", "blufor")

		err := hdlr.GetMarker(c)
		assert.NoError(t, err)
		assert.Equal(t, http.StatusOK, rec.Code)
		// Falls back to unknown.png at root level
		assert.Equal(t, "image/png", rec.Header().Get("Content-Type"))
	})
}

// createIntegrationTestPNG creates a valid 4x4 PNG file for integration tests
func createIntegrationTestPNG(t *testing.T, path string) {
	t.Helper()

	// Ensure parent directory exists
	dir := filepath.Dir(path)
	if !strings.HasSuffix(dir, string(filepath.Separator)) {
		err := os.MkdirAll(dir, 0755)
		require.NoError(t, err)
	}

	img := image.NewNRGBA(image.Rect(0, 0, 4, 4))
	for x := 0; x < 4; x++ {
		for y := 0; y < 4; y++ {
			img.Set(x, y, color.NRGBA{255, 255, 255, 128})
		}
	}

	f, err := os.Create(path)
	require.NoError(t, err)
	defer f.Close()

	err = png.Encode(f, img)
	require.NoError(t, err)
}
