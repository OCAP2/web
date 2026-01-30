package server

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	pb "github.com/OCAP2/web/schemas/protobuf"
	"github.com/OCAP2/web/server/storage"
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
		err := converter.Convert(ctx, jsonPath, outputPath)
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

		var manifest pb.Manifest
		err = proto.Unmarshal(rec.Body.Bytes(), &manifest)
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

		var chunk pb.Chunk
		err = proto.Unmarshal(rec.Body.Bytes(), &chunk)
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

		var chunk pb.Chunk
		err = proto.Unmarshal(rec.Body.Bytes(), &chunk)
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
