package server

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	pbv1 "github.com/OCAP2/web/pkg/schemas/protobuf/v1"
	"github.com/OCAP2/web/internal/storage"
	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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
		ChunkCount:       1,
	}
	err = repo.Store(ctx, op)
	assert.NoError(t, err)

	// Create handler
	hdlr := Handler{
		repoOperation: repo,
		setting:       Setting{Data: dataDir},
		jsonEngine: storage.NewJSONEngine(dataDir),
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
	assert.Equal(t, uint32(1), formatInfo.SchemaVersion) // Defaults to 1 when not set

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
		ChunkCount:       5,
	}
	err = repo.Store(ctx, op)
	assert.NoError(t, err)

	// Create handler
	hdlr := Handler{
		repoOperation: repo,
		setting:       Setting{Data: dataDir},
		jsonEngine: storage.NewJSONEngine(dataDir),
	}

	// Test: Get format for protobuf operation (ChunkCount comes from DB now)
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
	assert.Equal(t, 5, formatInfo.ChunkCount)
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
	testDataPath := filepath.Join(dataDir, "test_mission.json.gz")
	err = writeGzipped(testDataPath, []byte(testData))
	assert.NoError(t, err)

	// Create handler
	hdlr := Handler{
		repoOperation: repo,
		setting:       Setting{Data: dataDir},
		jsonEngine: storage.NewJSONEngine(dataDir),
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

	pbManifest := &pbv1.Manifest{
		Version:        1,
		WorldName:      "altis",
		MissionName:    "Test Mission Protobuf",
		FrameCount:     100,
		ChunkSize:      1000,
		CaptureDelayMs: 1000,
		ChunkCount:     1,
		Entities: []*pbv1.EntityDef{
			{
				Id:         1,
				Type:       pbv1.EntityType_ENTITY_TYPE_UNIT,
				Name:       "Player1",
				Side:       pbv1.Side_SIDE_WEST,
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

	// Create handler
	hdlr := Handler{
		repoOperation: repo,
		setting:       Setting{Data: dataDir},
		jsonEngine: storage.NewJSONEngine(dataDir),
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
	var returnedManifest pbv1.Manifest
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

	pbChunk := &pbv1.Chunk{
		Index:      0,
		StartFrame: 0,
		FrameCount: 10,
		Frames: []*pbv1.Frame{
			{
				FrameNum: 0,
				Entities: []*pbv1.EntityState{
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
	pbManifest := &pbv1.Manifest{
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

	// Create handler
	hdlr := Handler{
		repoOperation: repo,
		setting:       Setting{Data: dataDir},
		jsonEngine: storage.NewJSONEngine(dataDir),
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
	var returnedChunk pbv1.Chunk
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

func TestGetOperations(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")

	repo, err := NewRepoOperation(pathDB)
	require.NoError(t, err)
	defer repo.db.Close()

	ctx := context.Background()

	// Store test operations
	ops := []*Operation{
		{
			WorldName:        "altis",
			MissionName:      "Mission Alpha",
			MissionDuration:  3600,
			Filename:         "mission_alpha",
			Date:             "2026-01-15",
			Tag:              "coop",
			StorageFormat:    "json",
			ConversionStatus: "completed",
		},
		{
			WorldName:        "stratis",
			MissionName:      "Mission Beta",
			MissionDuration:  1800,
			Filename:         "mission_beta",
			Date:             "2026-01-20",
			Tag:              "tvt",
			StorageFormat:    "protobuf",
			ConversionStatus: "completed",
		},
	}

	for _, op := range ops {
		err = repo.Store(ctx, op)
		require.NoError(t, err)
	}

	hdlr := Handler{
		repoOperation: repo,
		setting:       Setting{},
	}

	t.Run("get all operations", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/operations", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)

		err := hdlr.GetOperations(c)
		assert.NoError(t, err)
		assert.Equal(t, http.StatusOK, rec.Code)

		var result []Operation
		err = json.Unmarshal(rec.Body.Bytes(), &result)
		assert.NoError(t, err)
		assert.Len(t, result, 2)
	})

	t.Run("filter by name", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/operations?name=Alpha", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)

		err := hdlr.GetOperations(c)
		assert.NoError(t, err)

		var result []Operation
		err = json.Unmarshal(rec.Body.Bytes(), &result)
		assert.NoError(t, err)
		assert.Len(t, result, 1)
		assert.Equal(t, "Mission Alpha", result[0].MissionName)
	})

	t.Run("filter by tag", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/operations?tag=tvt", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)

		err := hdlr.GetOperations(c)
		assert.NoError(t, err)

		var result []Operation
		err = json.Unmarshal(rec.Body.Bytes(), &result)
		assert.NoError(t, err)
		assert.Len(t, result, 1)
		assert.Equal(t, "tvt", result[0].Tag)
	})

	t.Run("filter by date range", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/operations?newer=2026-01-18&older=2026-01-25", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)

		err := hdlr.GetOperations(c)
		assert.NoError(t, err)

		var result []Operation
		err = json.Unmarshal(rec.Body.Bytes(), &result)
		assert.NoError(t, err)
		assert.Len(t, result, 1)
		assert.Equal(t, "Mission Beta", result[0].MissionName)
	})
}

func TestGetCustomize(t *testing.T) {
	hdlr := Handler{
		setting: Setting{
			Customize: Customize{
				WebsiteURL:       "https://example.com",
				WebsiteLogo:      "/logo.png",
				WebsiteLogoSize:  "64px",
				DisableKillCount: true,
			},
		},
	}

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/customize", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := hdlr.GetCustomize(c)
	assert.NoError(t, err)
	assert.Equal(t, http.StatusOK, rec.Code)

	var result Customize
	err = json.Unmarshal(rec.Body.Bytes(), &result)
	assert.NoError(t, err)
	assert.Equal(t, "https://example.com", result.WebsiteURL)
	assert.Equal(t, "/logo.png", result.WebsiteLogo)
	assert.Equal(t, "64px", result.WebsiteLogoSize)
	assert.True(t, result.DisableKillCount)
}

func TestGetVersion(t *testing.T) {
	// Set build variables
	originalVersion := BuildVersion
	originalCommit := BuildCommit
	originalDate := BuildDate
	BuildVersion = "v2.1.0-rc1"
	BuildCommit = "abc123"
	BuildDate = "2026-01-30"
	defer func() {
		BuildVersion = originalVersion
		BuildCommit = originalCommit
		BuildDate = originalDate
	}()

	hdlr := Handler{}

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/version", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := hdlr.GetVersion(c)
	assert.NoError(t, err)
	assert.Equal(t, http.StatusOK, rec.Code)

	var result struct {
		BuildVersion string
		BuildCommit  string
		BuildDate    string
	}
	err = json.Unmarshal(rec.Body.Bytes(), &result)
	assert.NoError(t, err)
	assert.Equal(t, "v2.1.0-rc1", result.BuildVersion)
	assert.Equal(t, "abc123", result.BuildCommit)
	assert.Equal(t, "2026-01-30", result.BuildDate)
}

func TestStoreOperation(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")
	dataDir := filepath.Join(dir, "data")
	err := os.MkdirAll(dataDir, 0755)
	require.NoError(t, err)

	repo, err := NewRepoOperation(pathDB)
	require.NoError(t, err)
	defer repo.db.Close()

	hdlr := Handler{
		repoOperation: repo,
		setting: Setting{
			Secret: "test-secret",
			Data:   dataDir,
		},
	}

	t.Run("successful upload", func(t *testing.T) {
		// Create multipart form
		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)

		writer.WriteField("secret", "test-secret")
		writer.WriteField("worldName", "altis")
		writer.WriteField("missionName", "Test Mission")
		writer.WriteField("missionDuration", "3600")
		writer.WriteField("filename", "test_upload")
		writer.WriteField("tag", "coop")

		// Create file part
		fileWriter, err := writer.CreateFormFile("file", "test_upload.json.gz")
		require.NoError(t, err)

		// Write gzipped JSON data
		gw := gzip.NewWriter(fileWriter)
		gw.Write([]byte(`{"test": "data"}`))
		gw.Close()

		writer.Close()

		e := echo.New()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/add", body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)

		err = hdlr.StoreOperation(c)
		assert.NoError(t, err)
		assert.Equal(t, http.StatusOK, rec.Code)

		// Verify file was created
		_, err = os.Stat(filepath.Join(dataDir, "test_upload.json.gz"))
		assert.NoError(t, err)
	})

	t.Run("wrong secret", func(t *testing.T) {
		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		writer.WriteField("secret", "wrong-secret")
		writer.Close()

		e := echo.New()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/add", body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)

		err := hdlr.StoreOperation(c)
		assert.Equal(t, echo.ErrForbidden, err)
	})

	t.Run("invalid duration", func(t *testing.T) {
		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		writer.WriteField("secret", "test-secret")
		writer.WriteField("missionDuration", "not-a-number")
		writer.Close()

		e := echo.New()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/add", body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)

		err := hdlr.StoreOperation(c)
		assert.Error(t, err)
	})
}

func TestGetCapture(t *testing.T) {
	dir := t.TempDir()
	dataDir := filepath.Join(dir, "data")
	err := os.MkdirAll(dataDir, 0755)
	require.NoError(t, err)

	// Create test gzipped file
	testData := `{"test": "capture data"}`
	testPath := filepath.Join(dataDir, "test_capture.json.gz")
	err = writeGzipped(testPath, []byte(testData))
	require.NoError(t, err)

	hdlr := Handler{
		setting: Setting{Data: dataDir},
	}

	t.Run("get existing capture", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/data/test_capture", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetParamNames("name")
		c.SetParamValues("test_capture")

		err := hdlr.GetCapture(c)
		assert.NoError(t, err)
		assert.Equal(t, "gzip", rec.Header().Get("Content-Encoding"))
		assert.Equal(t, "application/json", rec.Header().Get("Content-Type"))
	})

	t.Run("get nonexistent capture", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/data/nonexistent", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetParamNames("name")
		c.SetParamValues("nonexistent")

		err := hdlr.GetCapture(c)
		// File not found returns error
		assert.Error(t, err)
	})
}

func TestGetCaptureFile(t *testing.T) {
	dir := t.TempDir()
	dataDir := filepath.Join(dir, "data")
	err := os.MkdirAll(dataDir, 0755)
	require.NoError(t, err)

	// Create test gzipped file
	testPath := filepath.Join(dataDir, "download_test.json.gz")
	err = writeGzipped(testPath, []byte(`{"download": "test"}`))
	require.NoError(t, err)

	hdlr := Handler{
		setting: Setting{Data: dataDir},
	}

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/file/download_test", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("name")
	c.SetParamValues("download_test")

	err = hdlr.GetCaptureFile(c)
	assert.NoError(t, err)
	assert.Contains(t, rec.Header().Get("Content-Disposition"), "attachment")
	assert.Contains(t, rec.Header().Get("Content-Disposition"), "download_test.json.gz")
}

func TestGetMapTitle(t *testing.T) {
	dir := t.TempDir()
	mapsDir := filepath.Join(dir, "maps")
	err := os.MkdirAll(filepath.Join(mapsDir, "altis"), 0755)
	require.NoError(t, err)

	// Create test tile
	tilePath := filepath.Join(mapsDir, "altis", "0_0.png")
	err = os.WriteFile(tilePath, []byte("fake png data"), 0644)
	require.NoError(t, err)

	hdlr := Handler{
		setting: Setting{Maps: mapsDir},
	}

	t.Run("get existing tile", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/images/maps/altis/0_0.png", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetParamNames("*")
		c.SetParamValues("altis/0_0.png")

		err := hdlr.GetMapTitle(c)
		assert.NoError(t, err)
	})

	t.Run("path traversal blocked", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/images/maps/../../../etc/passwd", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetParamNames("*")
		c.SetParamValues("../../../etc/passwd")

		err := hdlr.GetMapTitle(c)
		assert.Error(t, err)
	})
}

func TestGetStatic(t *testing.T) {
	dir := t.TempDir()
	staticDir := filepath.Join(dir, "static")
	err := os.MkdirAll(staticDir, 0755)
	require.NoError(t, err)

	// Create test static file
	indexPath := filepath.Join(staticDir, "index.html")
	err = os.WriteFile(indexPath, []byte("<html>test</html>"), 0644)
	require.NoError(t, err)

	// Create nested directory with file
	scriptsDir := filepath.Join(staticDir, "scripts")
	err = os.MkdirAll(scriptsDir, 0755)
	require.NoError(t, err)
	err = os.WriteFile(filepath.Join(scriptsDir, "ocap.js"), []byte("// test"), 0644)
	require.NoError(t, err)

	hdlr := Handler{
		setting: Setting{Static: staticDir},
	}

	t.Run("get static file", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/index.html", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetParamNames("*")
		c.SetParamValues("index.html")

		err := hdlr.GetStatic(c)
		assert.NoError(t, err)
	})

	t.Run("root path serves index.html", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetParamNames("*")
		c.SetParamValues("") // Empty param for root path

		err := hdlr.GetStatic(c)
		assert.NoError(t, err)
		assert.Contains(t, rec.Body.String(), "<html>test</html>")
	})

	t.Run("nested path with forward slashes", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/scripts/ocap.js", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetParamNames("*")
		c.SetParamValues("scripts/ocap.js") // Forward slashes in path

		err := hdlr.GetStatic(c)
		assert.NoError(t, err)
		assert.Contains(t, rec.Body.String(), "// test")
	})

	t.Run("path traversal blocked", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/../../../etc/passwd", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetParamNames("*")
		c.SetParamValues("../../../etc/passwd")

		err := hdlr.GetStatic(c)
		assert.Error(t, err)
	})
}

func TestParamPath(t *testing.T) {
	tests := []struct {
		name      string
		param     string
		wantPath  string
		wantError bool
	}{
		{
			name:      "empty path returns root",
			param:     "",
			wantPath:  "/",
			wantError: false,
		},
		{
			name:      "simple filename",
			param:     "index.html",
			wantPath:  "/index.html",
			wantError: false,
		},
		{
			name:      "nested path with forward slashes",
			param:     "scripts/ocap.js",
			wantPath:  "/scripts/ocap.js",
			wantError: false,
		},
		{
			name:      "deeply nested path",
			param:     "assets/images/logo.png",
			wantPath:  "/assets/images/logo.png",
			wantError: false,
		},
		{
			name:      "path traversal blocked",
			param:     "../../../etc/passwd",
			wantPath:  "",
			wantError: true,
		},
		{
			name:      "double slash blocked",
			param:     "foo//bar",
			wantPath:  "",
			wantError: true,
		},
		{
			name:      "dot segment blocked",
			param:     "foo/../bar",
			wantPath:  "",
			wantError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			e := echo.New()
			req := httptest.NewRequest(http.MethodGet, "/"+tt.param, nil)
			rec := httptest.NewRecorder()
			c := e.NewContext(req, rec)
			c.SetParamNames("*")
			c.SetParamValues(tt.param)

			got, err := paramPath(c, "*")

			if tt.wantError {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
				assert.Equal(t, tt.wantPath, got)
			}
		})
	}
}

func TestCacheControl(t *testing.T) {
	hdlr := Handler{}

	t.Run("with duration", func(t *testing.T) {
		mw := hdlr.cacheControl(CacheDuration)

		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)

		handler := mw(func(c echo.Context) error {
			return c.String(http.StatusOK, "test")
		})

		err := handler(c)
		assert.NoError(t, err)
		assert.Equal(t, "max-age=604800", rec.Header().Get("Cache-Control"))
	})

	t.Run("no cache", func(t *testing.T) {
		mw := hdlr.cacheControl(0)

		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)

		handler := mw(func(c echo.Context) error {
			return c.String(http.StatusOK, "test")
		})

		err := handler(c)
		assert.NoError(t, err)
		assert.Equal(t, "no-cache", rec.Header().Get("Cache-Control"))
	})

	t.Run("short duration treated as no cache", func(t *testing.T) {
		mw := hdlr.cacheControl(500 * time.Millisecond)

		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)

		handler := mw(func(c echo.Context) error {
			return c.String(http.StatusOK, "test")
		})

		err := handler(c)
		assert.NoError(t, err)
		assert.Equal(t, "no-cache", rec.Header().Get("Cache-Control"))
	})
}

func TestErrorHandler(t *testing.T) {
	hdlr := Handler{}

	t.Run("handles ErrNotFound", func(t *testing.T) {
		mw := hdlr.errorHandler

		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)

		handler := mw(func(c echo.Context) error {
			return ErrNotFound
		})

		err := handler(c)
		assert.NoError(t, err)
		assert.Equal(t, http.StatusNotFound, rec.Code)
	})

	t.Run("passes through other errors", func(t *testing.T) {
		mw := hdlr.errorHandler

		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)

		expectedErr := echo.NewHTTPError(http.StatusBadRequest, "bad request")
		handler := mw(func(c echo.Context) error {
			return expectedErr
		})

		err := handler(c)
		assert.Equal(t, expectedErr, err)
	})

	t.Run("nil error passes through", func(t *testing.T) {
		mw := hdlr.errorHandler

		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)

		handler := mw(func(c echo.Context) error {
			return c.String(http.StatusOK, "success")
		})

		err := handler(c)
		assert.NoError(t, err)
	})
}

func TestWithConversionTrigger(t *testing.T) {
	trigger := &mockConversionTrigger{}

	opt := WithConversionTrigger(trigger)

	hdlr := &Handler{}
	opt(hdlr)

	assert.Equal(t, trigger, hdlr.conversionTrigger)
}

// mockConversionTrigger implements ConversionTrigger for testing
type mockConversionTrigger struct {
	triggered bool
	id        int64
	filename  string
}

func (m *mockConversionTrigger) TriggerConversion(id int64, filename string) {
	m.triggered = true
	m.id = id
	m.filename = filename
}

func TestStoreOperationWithConversionTrigger(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")
	dataDir := filepath.Join(dir, "data")
	err := os.MkdirAll(dataDir, 0755)
	require.NoError(t, err)

	repo, err := NewRepoOperation(pathDB)
	require.NoError(t, err)
	defer repo.db.Close()

	trigger := &mockConversionTrigger{}

	hdlr := Handler{
		repoOperation:     repo,
		conversionTrigger: trigger,
		setting: Setting{
			Secret: "test-secret",
			Data:   dataDir,
		},
	}

	// Create multipart form
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	writer.WriteField("secret", "test-secret")
	writer.WriteField("worldName", "altis")
	writer.WriteField("missionName", "Trigger Test")
	writer.WriteField("missionDuration", "3600")
	writer.WriteField("filename", "trigger_test")
	writer.WriteField("tag", "coop")

	fileWriter, _ := writer.CreateFormFile("file", "trigger_test.json.gz")
	gw := gzip.NewWriter(fileWriter)
	gw.Write([]byte(`{"test": "trigger"}`))
	gw.Close()
	writer.Close()

	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/add", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err = hdlr.StoreOperation(c)
	assert.NoError(t, err)

	// Verify trigger was called
	assert.True(t, trigger.triggered)
	assert.Equal(t, "trigger_test", trigger.filename)
}

func TestNewHandler(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")
	dataDir := filepath.Join(dir, "data")
	markerDir := filepath.Join(dir, "markers")
	ammoDir := filepath.Join(dir, "ammo")

	for _, d := range []string{dataDir, markerDir, ammoDir} {
		err := os.MkdirAll(d, 0755)
		require.NoError(t, err)
	}

	repo, err := NewRepoOperation(pathDB)
	require.NoError(t, err)
	defer repo.db.Close()

	repoMarker, err := NewRepoMarker(markerDir)
	require.NoError(t, err)

	repoAmmo, err := NewRepoAmmo(ammoDir)
	require.NoError(t, err)

	setting := Setting{
		Listen:    "127.0.0.1:5000",
		PrefixURL: "/aar/",
		Secret:    "test-secret",
		Data:      dataDir,
		Markers:   markerDir,
		Ammo:      ammoDir,
	}

	e := echo.New()

	// Should not panic
	NewHandler(e, repo, repoMarker, repoAmmo, setting)

	// Verify routes are registered
	routes := e.Routes()
	assert.NotEmpty(t, routes)

	// Check for expected routes
	routePaths := make([]string, len(routes))
	for i, r := range routes {
		routePaths[i] = r.Path
	}
	assert.Contains(t, routePaths, "/aar/api/v1/operations")
	assert.Contains(t, routePaths, "/aar/api/v1/operations/add")
	assert.Contains(t, routePaths, "/aar/api/version")
}

func TestNewHandlerWithOptions(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")
	dataDir := filepath.Join(dir, "data")
	markerDir := filepath.Join(dir, "markers")
	ammoDir := filepath.Join(dir, "ammo")

	for _, d := range []string{dataDir, markerDir, ammoDir} {
		os.MkdirAll(d, 0755)
	}

	repo, _ := NewRepoOperation(pathDB)
	defer repo.db.Close()
	repoMarker, _ := NewRepoMarker(markerDir)
	repoAmmo, _ := NewRepoAmmo(ammoDir)

	setting := Setting{
		Data:    dataDir,
		Markers: markerDir,
		Ammo:    ammoDir,
	}

	trigger := &mockConversionTrigger{}
	e := echo.New()

	// Should apply options
	NewHandler(e, repo, repoMarker, repoAmmo, setting, WithConversionTrigger(trigger))

	// Routes should still be registered
	assert.NotEmpty(t, e.Routes())
}

func TestGetOperationFormat_EmptyStorageFormat(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")
	dataDir := filepath.Join(dir, "data")
	err := os.MkdirAll(dataDir, 0755)
	require.NoError(t, err)

	repo, err := NewRepoOperation(pathDB)
	require.NoError(t, err)
	defer repo.db.Close()

	ctx := context.Background()

	// Store operation with empty StorageFormat (should default to "json")
	op := &Operation{
		WorldName:        "altis",
		MissionName:      "Empty Format Test",
		MissionDuration:  3600,
		Filename:         "empty_format_test",
		Date:             "2026-01-30",
		Tag:              "coop",
		StorageFormat:    "", // Empty - should trigger default to json
		ConversionStatus: "pending",
	}
	err = repo.Store(ctx, op)
	require.NoError(t, err)

	hdlr := Handler{
		repoOperation: repo,
		setting:       Setting{Data: dataDir},
		jsonEngine: storage.NewJSONEngine(dataDir),
	}

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/operations/1/format", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues("1")

	err = hdlr.GetOperationFormat(c)
	assert.NoError(t, err)

	var result FormatInfo
	err = json.Unmarshal(rec.Body.Bytes(), &result)
	assert.NoError(t, err)
	assert.Equal(t, "json", result.Format)
}

func TestGetOperationFormat_UnknownFormat(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")
	dataDir := filepath.Join(dir, "data")
	err := os.MkdirAll(dataDir, 0755)
	require.NoError(t, err)

	repo, err := NewRepoOperation(pathDB)
	require.NoError(t, err)
	defer repo.db.Close()

	ctx := context.Background()

	// Store operation with unknown storage format
	op := &Operation{
		WorldName:        "altis",
		MissionName:      "Unknown Format Test",
		MissionDuration:  3600,
		Filename:         "unknown_format_test",
		Date:             "2026-01-30",
		Tag:              "coop",
		StorageFormat:    "unknown_format", // Unknown - should fallback to json
		ConversionStatus: "completed",
	}
	err = repo.Store(ctx, op)
	require.NoError(t, err)

	hdlr := Handler{
		repoOperation: repo,
		setting:       Setting{Data: dataDir},
		jsonEngine: storage.NewJSONEngine(dataDir),
	}

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/operations/1/format", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues("1")

	err = hdlr.GetOperationFormat(c)
	assert.NoError(t, err)

	var result FormatInfo
	err = json.Unmarshal(rec.Body.Bytes(), &result)
	assert.NoError(t, err)
	assert.Equal(t, "json", result.Format) // Should fallback to json
}

func TestGetOperationManifest_JSONFormat(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")
	dataDir := filepath.Join(dir, "data")
	err := os.MkdirAll(dataDir, 0755)
	require.NoError(t, err)

	repo, err := NewRepoOperation(pathDB)
	require.NoError(t, err)
	defer repo.db.Close()

	ctx := context.Background()

	// Store operation with json format
	op := &Operation{
		WorldName:        "altis",
		MissionName:      "JSON Manifest Test",
		MissionDuration:  3600,
		Filename:         "json_manifest_test",
		Date:             "2026-01-30",
		Tag:              "coop",
		StorageFormat:    "json",
		ConversionStatus: "completed",
	}
	err = repo.Store(ctx, op)
	require.NoError(t, err)

	// Create JSON recording file
	testJSON := `{
		"worldName": "altis",
		"missionName": "JSON Manifest Test",
		"endFrame": 100,
		"captureDelay": 1,
		"entities": [],
		"events": []
	}`
	err = writeGzipped(filepath.Join(dataDir, "json_manifest_test.json.gz"), []byte(testJSON))
	require.NoError(t, err)

	hdlr := Handler{
		repoOperation: repo,
		setting:       Setting{Data: dataDir},
		jsonEngine: storage.NewJSONEngine(dataDir),
	}

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/operations/1/manifest", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues("1")

	err = hdlr.GetOperationManifest(c)
	assert.NoError(t, err)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Header().Get("Content-Type"), "application/json")

	// Verify it returns manifest data
	var manifest storage.Manifest
	err = json.Unmarshal(rec.Body.Bytes(), &manifest)
	assert.NoError(t, err)
	assert.Equal(t, "altis", manifest.WorldName)
}

func TestGetOperationChunk_EmptyStorageFormat(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")
	dataDir := filepath.Join(dir, "data")

	repo, err := NewRepoOperation(pathDB)
	require.NoError(t, err)
	defer repo.db.Close()

	ctx := context.Background()

	// Store operation with empty storage format
	op := &Operation{
		WorldName:        "altis",
		MissionName:      "Empty Format Chunk Test",
		MissionDuration:  3600,
		Filename:         "empty_format_chunk",
		Date:             "2026-01-30",
		Tag:              "coop",
		StorageFormat:    "", // Empty - should default to json
		ConversionStatus: "pending",
	}
	err = repo.Store(ctx, op)
	require.NoError(t, err)

	hdlr := Handler{
		repoOperation: repo,
		setting:       Setting{Data: dataDir},
		jsonEngine: storage.NewJSONEngine(dataDir),
	}

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/operations/1/chunk/0", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id", "index")
	c.SetParamValues("1", "0")

	// JSON engine doesn't support chunks, should return error
	err = hdlr.GetOperationChunk(c)
	assert.Error(t, err)
}

func TestGetMarker_WithExtension(t *testing.T) {
	dir := t.TempDir()
	markerDir := filepath.Join(dir, "markers")
	err := os.MkdirAll(markerDir, 0755)
	require.NoError(t, err)

	// Create test SVG marker
	svgContent := `<svg xmlns="http://www.w3.org/2000/svg"><circle fill="{{.}}" r="10"/></svg>`
	err = os.WriteFile(filepath.Join(markerDir, "test_marker.svg"), []byte(svgContent), 0644)
	require.NoError(t, err)

	repoMarker, err := NewRepoMarker(markerDir)
	require.NoError(t, err)

	hdlr := Handler{
		repoMarker: repoMarker,
	}

	// Test with .png extension in color parameter (deprecated format)
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/images/markers/test_marker/blufor.png", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("name", "color")
	c.SetParamValues("test_marker", "blufor.png")

	err = hdlr.GetMarker(c)
	assert.NoError(t, err)
	assert.Equal(t, http.StatusOK, rec.Code)
}

func TestGetAmmo_WithPaaExtension(t *testing.T) {
	dir := t.TempDir()
	ammoDir := filepath.Join(dir, "ammo")
	subDir := filepath.Join(ammoDir, "test")
	err := os.MkdirAll(subDir, 0755)
	require.NoError(t, err)

	// Create test ammo icon
	err = os.WriteFile(filepath.Join(subDir, "grenade_x_ca.png"), []byte("fake png"), 0644)
	require.NoError(t, err)

	repoAmmo, err := NewRepoAmmo(ammoDir)
	require.NoError(t, err)

	hdlr := Handler{
		repoAmmo: repoAmmo,
	}

	// Test with .paa extension (should be stripped)
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/images/ammo/grenade_x_ca.paa.png", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("name")
	c.SetParamValues("grenade_x_ca.paa.png")

	err = hdlr.GetAmmo(c)
	assert.NoError(t, err)
	assert.Equal(t, http.StatusOK, rec.Code)
}

func TestStoreOperation_MissingFile(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")
	dataDir := filepath.Join(dir, "data")
	err := os.MkdirAll(dataDir, 0755)
	require.NoError(t, err)

	repo, err := NewRepoOperation(pathDB)
	require.NoError(t, err)
	defer repo.db.Close()

	hdlr := Handler{
		repoOperation: repo,
		setting: Setting{
			Secret: "test-secret",
			Data:   dataDir,
		},
	}

	// Create multipart form without file
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	writer.WriteField("secret", "test-secret")
	writer.WriteField("worldName", "altis")
	writer.WriteField("missionName", "No File Test")
	writer.WriteField("missionDuration", "3600")
	writer.WriteField("filename", "no_file_test")
	writer.WriteField("tag", "coop")
	// No file field added
	writer.Close()

	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/add", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err = hdlr.StoreOperation(c)
	assert.Error(t, err)
	assert.Equal(t, echo.ErrBadRequest, err)
}

func TestStoreOperation_InvalidMissionDuration(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")
	dataDir := filepath.Join(dir, "data")
	err := os.MkdirAll(dataDir, 0755)
	require.NoError(t, err)

	repo, err := NewRepoOperation(pathDB)
	require.NoError(t, err)
	defer repo.db.Close()

	hdlr := Handler{
		repoOperation: repo,
		setting: Setting{
			Secret: "test-secret",
			Data:   dataDir,
		},
	}

	// Create multipart form with invalid missionDuration
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	writer.WriteField("secret", "test-secret")
	writer.WriteField("worldName", "altis")
	writer.WriteField("missionName", "Invalid Duration Test")
	writer.WriteField("missionDuration", "not-a-number") // Invalid
	writer.WriteField("filename", "invalid_duration_test")
	writer.WriteField("tag", "coop")

	fileWriter, _ := writer.CreateFormFile("file", "test.json.gz")
	gw := gzip.NewWriter(fileWriter)
	gw.Write([]byte(`{"test": "data"}`))
	gw.Close()
	writer.Close()

	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/add", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err = hdlr.StoreOperation(c)
	assert.Error(t, err)
}

func TestStoreOperation_WrongSecret(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")
	dataDir := filepath.Join(dir, "data")
	err := os.MkdirAll(dataDir, 0755)
	require.NoError(t, err)

	repo, err := NewRepoOperation(pathDB)
	require.NoError(t, err)
	defer repo.db.Close()

	hdlr := Handler{
		repoOperation: repo,
		setting: Setting{
			Secret: "correct-secret",
			Data:   dataDir,
		},
	}

	// Create multipart form with wrong secret
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	writer.WriteField("secret", "wrong-secret")
	writer.WriteField("worldName", "altis")
	writer.WriteField("missionName", "Wrong Secret Test")
	writer.WriteField("missionDuration", "3600")
	writer.WriteField("filename", "wrong_secret_test")
	writer.WriteField("tag", "coop")

	fileWriter, _ := writer.CreateFormFile("file", "test.json.gz")
	gw := gzip.NewWriter(fileWriter)
	gw.Write([]byte(`{"test": "data"}`))
	gw.Close()
	writer.Close()

	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/add", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err = hdlr.StoreOperation(c)
	assert.Equal(t, echo.ErrForbidden, err)
}

func TestGetOperationManifest_JSONError(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")
	dataDir := filepath.Join(dir, "data")
	err := os.MkdirAll(dataDir, 0755)
	require.NoError(t, err)

	repo, err := NewRepoOperation(pathDB)
	require.NoError(t, err)
	defer repo.db.Close()

	ctx := context.Background()

	// Store operation with json format
	op := &Operation{
		WorldName:        "altis",
		MissionName:      "JSON Error Test",
		MissionDuration:  3600,
		Filename:         "missing_json_file",
		Date:             "2026-01-30",
		Tag:              "coop",
		StorageFormat:    "json",
		ConversionStatus: "completed",
	}
	err = repo.Store(ctx, op)
	require.NoError(t, err)

	hdlr := Handler{
		repoOperation: repo,
		setting:       Setting{Data: dataDir},
		jsonEngine: storage.NewJSONEngine(dataDir),
	}

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/operations/1/manifest", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues("1")

	err = hdlr.GetOperationManifest(c)
	assert.Error(t, err)
	httpErr, ok := err.(*echo.HTTPError)
	assert.True(t, ok)
	assert.Equal(t, http.StatusInternalServerError, httpErr.Code)
}

func TestGetOperationManifest_ProtobufReadError(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")
	dataDir := filepath.Join(dir, "data")
	err := os.MkdirAll(dataDir, 0755)
	require.NoError(t, err)

	repo, err := NewRepoOperation(pathDB)
	require.NoError(t, err)
	defer repo.db.Close()

	ctx := context.Background()

	// Store operation with protobuf format
	op := &Operation{
		WorldName:        "altis",
		MissionName:      "Protobuf Error Test",
		MissionDuration:  3600,
		Filename:         "missing_protobuf",
		Date:             "2026-01-30",
		Tag:              "coop",
		StorageFormat:    "protobuf",
		ConversionStatus: "completed",
	}
	err = repo.Store(ctx, op)
	require.NoError(t, err)

	hdlr := Handler{
		repoOperation: repo,
		setting:       Setting{Data: dataDir},
		jsonEngine: storage.NewJSONEngine(dataDir),
	}

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/operations/1/manifest", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues("1")

	err = hdlr.GetOperationManifest(c)
	assert.Error(t, err)
	httpErr, ok := err.(*echo.HTTPError)
	assert.True(t, ok)
	assert.Equal(t, http.StatusInternalServerError, httpErr.Code)
}

func TestGetOperationChunk_JSONNotSupported(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")
	dataDir := filepath.Join(dir, "data")
	err := os.MkdirAll(dataDir, 0755)
	require.NoError(t, err)

	repo, err := NewRepoOperation(pathDB)
	require.NoError(t, err)
	defer repo.db.Close()

	ctx := context.Background()

	// Store operation with json format
	op := &Operation{
		WorldName:        "altis",
		MissionName:      "JSON Chunk Test",
		MissionDuration:  3600,
		Filename:         "json_chunk_test",
		Date:             "2026-01-30",
		Tag:              "coop",
		StorageFormat:    "json",
		ConversionStatus: "completed",
	}
	err = repo.Store(ctx, op)
	require.NoError(t, err)

	hdlr := Handler{
		repoOperation: repo,
		setting:       Setting{Data: dataDir},
		jsonEngine: storage.NewJSONEngine(dataDir),
	}

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/operations/1/chunks/0", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id", "index")
	c.SetParamValues("1", "0")

	err = hdlr.GetOperationChunk(c)
	assert.Error(t, err)
	httpErr, ok := err.(*echo.HTTPError)
	assert.True(t, ok)
	// JSON engine returns error for chunked loading, handler returns 404
	assert.Equal(t, http.StatusNotFound, httpErr.Code)
}

func TestGetCapture_MissingFile(t *testing.T) {
	dir := t.TempDir()
	dataDir := filepath.Join(dir, "data")
	err := os.MkdirAll(dataDir, 0755)
	require.NoError(t, err)

	hdlr := Handler{
		setting: Setting{Data: dataDir},
	}

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/data/nonexistent", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("name")
	c.SetParamValues("nonexistent")

	err = hdlr.GetCapture(c)
	assert.Error(t, err)
}

func TestGetCaptureFile_MissingFile(t *testing.T) {
	dir := t.TempDir()
	dataDir := filepath.Join(dir, "data")
	err := os.MkdirAll(dataDir, 0755)
	require.NoError(t, err)

	hdlr := Handler{
		setting: Setting{Data: dataDir},
	}

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/file/nonexistent", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("name")
	c.SetParamValues("nonexistent")

	err = hdlr.GetCaptureFile(c)
	assert.Error(t, err)
}

func TestGetOperationFormat_WithSchemaVersion(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")
	dataDir := filepath.Join(dir, "data")
	err := os.MkdirAll(dataDir, 0755)
	require.NoError(t, err)

	repo, err := NewRepoOperation(pathDB)
	require.NoError(t, err)
	defer repo.db.Close()

	ctx := context.Background()

	// Store operation with explicit schema version
	op := &Operation{
		WorldName:        "altis",
		MissionName:      "Schema Version Test",
		MissionDuration:  3600,
		Filename:         "schema_version_test",
		Date:             "2026-01-30",
		StorageFormat:    "json",
		ConversionStatus: "completed",
		SchemaVersion:    2,
	}
	err = repo.Store(ctx, op)
	require.NoError(t, err)

	hdlr := Handler{
		repoOperation: repo,
		setting:       Setting{Data: dataDir},
		jsonEngine: storage.NewJSONEngine(dataDir),
	}

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/operations/1/format", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues("1")

	err = hdlr.GetOperationFormat(c)
	assert.NoError(t, err)

	var result FormatInfo
	err = json.Unmarshal(rec.Body.Bytes(), &result)
	assert.NoError(t, err)
	assert.Equal(t, uint32(2), result.SchemaVersion)
}
