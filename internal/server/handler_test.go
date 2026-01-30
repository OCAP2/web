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

	pb "github.com/OCAP2/web/pkg/schemas/protobuf"
	"github.com/OCAP2/web/internal/storage"
	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/assert"
	"google.golang.org/protobuf/proto"
)

type MockContext struct {
	param string
	echo.Context
}

func (c *MockContext) Param(_ string) string {
	return c.param
}

func Test_cleanPath(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	rec := httptest.NewRecorder()

	tests := []struct {
		path    string
		want    string
		wantErr bool
	}{
		{"", "/", false},
		{"images/favicon.png", "/images/favicon.png", false},
		{"/images/favicon.png", "", true},
		{"//images/favicon.png", "", true},
		{"//../../images/favicon.png", "", true},
	}
	for _, tt := range tests {
		c := &MockContext{
			param:   tt.path,
			Context: e.NewContext(req, rec),
		}
		got, err := paramPath(c, tt.path)
		if (err != nil) != tt.wantErr {
			t.Errorf("cleanPath(%s) error = %v, wantErr %v", tt.path, err, tt.wantErr)
			return
		}
		if got != tt.want {
			t.Errorf("cleanPath(%s) = %v, want %v", tt.path, got, tt.want)
		}
	}
}

func TestGetOperationFormat(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")
	dataDir := filepath.Join(dir, "data")

	// Create repo and store a test operation
	repo, err := NewRepoOperation(pathDB)
	assert.NoError(t, err)
	defer repo.db.Close()

	ctx := context.Background()
	op := &Operation{
		WorldName:        "altis",
		MissionName:      "Test Mission",
		MissionDuration:  3600,
		Filename:         "test_mission",
		Date:             "2026-01-30",
		Tag:              "coop",
		StorageFormat:    "json",
		ConversionStatus: "completed",
	}
	err = repo.Store(ctx, op)
	assert.NoError(t, err)

	// Register storage engines
	storage.RegisterEngine(storage.NewJSONEngine(dataDir))

	// Create handler
	hdlr := Handler{
		repoOperation: repo,
		setting:       Setting{Data: dataDir},
	}

	// Test: Get format for existing operation
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/operations/1/format", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues("1")

	err = hdlr.GetOperationFormat(c)
	assert.NoError(t, err)
	assert.Equal(t, http.StatusOK, rec.Code)

	var formatInfo FormatInfo
	err = json.Unmarshal(rec.Body.Bytes(), &formatInfo)
	assert.NoError(t, err)
	assert.Equal(t, "json", formatInfo.Format)
	assert.Equal(t, 1, formatInfo.ChunkCount)
	assert.False(t, formatInfo.SupportsStreaming)

	// Test: Get format for non-existing operation
	req = httptest.NewRequest(http.MethodGet, "/api/v1/operations/999/format", nil)
	rec = httptest.NewRecorder()
	c = e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues("999")

	err = hdlr.GetOperationFormat(c)
	assert.Error(t, err)
	httpErr, ok := err.(*echo.HTTPError)
	assert.True(t, ok)
	assert.Equal(t, http.StatusNotFound, httpErr.Code)
}

func TestGetOperationFormatProtobuf(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")
	dataDir := filepath.Join(dir, "data")

	// Create repo and store a test operation with protobuf format
	repo, err := NewRepoOperation(pathDB)
	assert.NoError(t, err)
	defer repo.db.Close()

	ctx := context.Background()
	op := &Operation{
		WorldName:        "altis",
		MissionName:      "Test Mission Protobuf",
		MissionDuration:  3600,
		Filename:         "test_mission_pb",
		Date:             "2026-01-30",
		Tag:              "coop",
		StorageFormat:    "protobuf",
		ConversionStatus: "completed",
	}
	err = repo.Store(ctx, op)
	assert.NoError(t, err)

	// Register storage engines
	storage.RegisterEngine(storage.NewProtobufEngine(dataDir))

	// Create handler
	hdlr := Handler{
		repoOperation: repo,
		setting:       Setting{Data: dataDir},
	}

	// Test: Get format for protobuf operation (without actual files, ChunkCount will be 0)
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/operations/1/format", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues("1")

	err = hdlr.GetOperationFormat(c)
	assert.NoError(t, err)
	assert.Equal(t, http.StatusOK, rec.Code)

	var formatInfo FormatInfo
	err = json.Unmarshal(rec.Body.Bytes(), &formatInfo)
	assert.NoError(t, err)
	assert.Equal(t, "protobuf", formatInfo.Format)
	assert.True(t, formatInfo.SupportsStreaming)
}

func TestGetOperationManifest(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")
	dataDir := filepath.Join(dir, "data")

	// Create repo and store a test operation
	repo, err := NewRepoOperation(pathDB)
	assert.NoError(t, err)
	defer repo.db.Close()

	ctx := context.Background()
	op := &Operation{
		WorldName:        "altis",
		MissionName:      "Test Mission",
		MissionDuration:  3600,
		Filename:         "test_mission",
		Date:             "2026-01-30",
		Tag:              "coop",
		StorageFormat:    "json",
		ConversionStatus: "completed",
	}
	err = repo.Store(ctx, op)
	assert.NoError(t, err)

	// Create test JSON data file
	err = os.MkdirAll(dataDir, 0755)
	assert.NoError(t, err)

	testData := `{
		"worldName": "altis",
		"missionName": "Test Mission",
		"captureDelay": 1,
		"endFrame": 100,
		"entities": [
			{
				"id": 1,
				"type": "unit",
				"startFrameNum": 0,
				"positions": [[0, 100, 200, 45, 1]],
				"framesFired": [],
				"name": "Player1",
				"group": "Alpha",
				"side": "WEST",
				"isPlayer": 1
			}
		],
		"events": [],
		"times": [],
		"Ede": []
	}`
	testDataPath := filepath.Join(dataDir, "test_mission.gz")
	err = writeGzipped(testDataPath, []byte(testData))
	assert.NoError(t, err)

	// Register storage engines
	storage.RegisterEngine(storage.NewJSONEngine(dataDir))

	// Create handler
	hdlr := Handler{
		repoOperation: repo,
		setting:       Setting{Data: dataDir},
	}

	// Test: Get manifest for JSON operation
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/operations/1/manifest", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues("1")

	err = hdlr.GetOperationManifest(c)
	assert.NoError(t, err)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "application/json", rec.Header().Get("Content-Type"))

	var manifest storage.Manifest
	err = json.Unmarshal(rec.Body.Bytes(), &manifest)
	assert.NoError(t, err)
	assert.Equal(t, "altis", manifest.WorldName)
	assert.Equal(t, "Test Mission", manifest.MissionName)
	assert.Equal(t, uint32(1000), manifest.CaptureDelayMs)
	assert.Len(t, manifest.Entities, 1)
	assert.Equal(t, "Player1", manifest.Entities[0].Name)

	// Test: Get manifest for non-existing operation
	req = httptest.NewRequest(http.MethodGet, "/api/v1/operations/999/manifest", nil)
	rec = httptest.NewRecorder()
	c = e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues("999")

	err = hdlr.GetOperationManifest(c)
	assert.Error(t, err)
	httpErr, ok := err.(*echo.HTTPError)
	assert.True(t, ok)
	assert.Equal(t, http.StatusNotFound, httpErr.Code)
}

func TestGetOperationManifestProtobuf(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")
	dataDir := filepath.Join(dir, "data")

	// Create repo and store a test operation with protobuf format
	repo, err := NewRepoOperation(pathDB)
	assert.NoError(t, err)
	defer repo.db.Close()

	ctx := context.Background()
	op := &Operation{
		WorldName:        "altis",
		MissionName:      "Test Mission Protobuf",
		MissionDuration:  3600,
		Filename:         "test_mission_pb",
		Date:             "2026-01-30",
		Tag:              "coop",
		StorageFormat:    "protobuf",
		ConversionStatus: "completed",
	}
	err = repo.Store(ctx, op)
	assert.NoError(t, err)

	// Create test protobuf manifest
	missionDir := filepath.Join(dataDir, "test_mission_pb")
	err = os.MkdirAll(missionDir, 0755)
	assert.NoError(t, err)

	pbManifest := &pb.Manifest{
		Version:        1,
		WorldName:      "altis",
		MissionName:    "Test Mission Protobuf",
		FrameCount:     100,
		ChunkSize:      1000,
		CaptureDelayMs: 1000,
		ChunkCount:     1,
		Entities: []*pb.EntityDef{
			{
				Id:         1,
				Type:       pb.EntityType_ENTITY_TYPE_UNIT,
				Name:       "Player1",
				Side:       pb.Side_SIDE_WEST,
				GroupName:  "Alpha",
				StartFrame: 0,
				EndFrame:   100,
				IsPlayer:   true,
			},
		},
	}
	pbData, err := proto.Marshal(pbManifest)
	assert.NoError(t, err)
	err = os.WriteFile(filepath.Join(missionDir, "manifest.pb"), pbData, 0644)
	assert.NoError(t, err)

	// Register storage engines
	storage.RegisterEngine(storage.NewProtobufEngine(dataDir))

	// Create handler
	hdlr := Handler{
		repoOperation: repo,
		setting:       Setting{Data: dataDir},
	}

	// Test: Get manifest for protobuf operation
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/operations/1/manifest", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues("1")

	err = hdlr.GetOperationManifest(c)
	assert.NoError(t, err)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "application/x-protobuf", rec.Header().Get("Content-Type"))

	// Verify we can unmarshal the returned protobuf
	var returnedManifest pb.Manifest
	err = proto.Unmarshal(rec.Body.Bytes(), &returnedManifest)
	assert.NoError(t, err)
	assert.Equal(t, "altis", returnedManifest.WorldName)
	assert.Equal(t, "Test Mission Protobuf", returnedManifest.MissionName)
	assert.Len(t, returnedManifest.Entities, 1)
	assert.Equal(t, "Player1", returnedManifest.Entities[0].Name)
}

// writeGzipped is a helper to write gzipped data for tests
func writeGzipped(path string, data []byte) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()

	gw := gzip.NewWriter(f)
	defer gw.Close()

	_, err = gw.Write(data)
	return err
}

func TestGetOperationChunk(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")
	dataDir := filepath.Join(dir, "data")

	// Create repo and store a test operation with protobuf format
	repo, err := NewRepoOperation(pathDB)
	assert.NoError(t, err)
	defer repo.db.Close()

	ctx := context.Background()
	op := &Operation{
		WorldName:        "altis",
		MissionName:      "Test Mission Protobuf",
		MissionDuration:  3600,
		Filename:         "test_mission_chunk",
		Date:             "2026-01-30",
		Tag:              "coop",
		StorageFormat:    "protobuf",
		ConversionStatus: "completed",
	}
	err = repo.Store(ctx, op)
	assert.NoError(t, err)

	// Create test protobuf chunk file (chunks are in chunks/ subdirectory with format %04d.pb)
	missionDir := filepath.Join(dataDir, "test_mission_chunk")
	chunksDir := filepath.Join(missionDir, "chunks")
	err = os.MkdirAll(chunksDir, 0755)
	assert.NoError(t, err)

	pbChunk := &pb.Chunk{
		Index:      0,
		StartFrame: 0,
		FrameCount: 10,
		Frames: []*pb.Frame{
			{
				FrameNum: 0,
				Entities: []*pb.EntityState{
					{
						EntityId:  1,
						PosX:      100.0,
						PosY:      200.0,
						Direction: 45,
						Alive:     1,
					},
				},
			},
		},
	}
	pbData, err := proto.Marshal(pbChunk)
	assert.NoError(t, err)
	err = os.WriteFile(filepath.Join(chunksDir, "0000.pb"), pbData, 0644)
	assert.NoError(t, err)

	// Also create manifest for ChunkCount
	pbManifest := &pb.Manifest{
		Version:        1,
		WorldName:      "altis",
		MissionName:    "Test Mission Protobuf",
		FrameCount:     10,
		ChunkSize:      1000,
		CaptureDelayMs: 1000,
		ChunkCount:     1,
	}
	manifestData, err := proto.Marshal(pbManifest)
	assert.NoError(t, err)
	err = os.WriteFile(filepath.Join(missionDir, "manifest.pb"), manifestData, 0644)
	assert.NoError(t, err)

	// Register storage engines
	storage.RegisterEngine(storage.NewProtobufEngine(dataDir))

	// Create handler
	hdlr := Handler{
		repoOperation: repo,
		setting:       Setting{Data: dataDir},
	}

	// Test: Get chunk 0 for protobuf operation
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/operations/1/chunk/0", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id", "index")
	c.SetParamValues("1", "0")

	err = hdlr.GetOperationChunk(c)
	assert.NoError(t, err)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "application/x-protobuf", rec.Header().Get("Content-Type"))

	// Verify we can unmarshal the returned protobuf
	var returnedChunk pb.Chunk
	err = proto.Unmarshal(rec.Body.Bytes(), &returnedChunk)
	assert.NoError(t, err)
	assert.Equal(t, uint32(0), returnedChunk.Index)
	assert.Equal(t, uint32(10), returnedChunk.FrameCount)
	assert.Len(t, returnedChunk.Frames, 1)
	assert.Equal(t, uint32(1), returnedChunk.Frames[0].Entities[0].EntityId)

	// Test: Get chunk for non-existing operation
	req = httptest.NewRequest(http.MethodGet, "/api/v1/operations/999/chunk/0", nil)
	rec = httptest.NewRecorder()
	c = e.NewContext(req, rec)
	c.SetParamNames("id", "index")
	c.SetParamValues("999", "0")

	err = hdlr.GetOperationChunk(c)
	assert.Error(t, err)
	httpErr, ok := err.(*echo.HTTPError)
	assert.True(t, ok)
	assert.Equal(t, http.StatusNotFound, httpErr.Code)

	// Test: Get chunk with invalid index
	req = httptest.NewRequest(http.MethodGet, "/api/v1/operations/1/chunk/invalid", nil)
	rec = httptest.NewRecorder()
	c = e.NewContext(req, rec)
	c.SetParamNames("id", "index")
	c.SetParamValues("1", "invalid")

	err = hdlr.GetOperationChunk(c)
	assert.Error(t, err)
	httpErr, ok = err.(*echo.HTTPError)
	assert.True(t, ok)
	assert.Equal(t, http.StatusBadRequest, httpErr.Code)

	// Test: Get chunk with out of range index
	req = httptest.NewRequest(http.MethodGet, "/api/v1/operations/1/chunk/999", nil)
	rec = httptest.NewRecorder()
	c = e.NewContext(req, rec)
	c.SetParamNames("id", "index")
	c.SetParamValues("1", "999")

	err = hdlr.GetOperationChunk(c)
	assert.Error(t, err)
	httpErr, ok = err.(*echo.HTTPError)
	assert.True(t, ok)
	assert.Equal(t, http.StatusNotFound, httpErr.Code)
}
