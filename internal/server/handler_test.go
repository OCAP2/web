package server

import (
	"bytes"
	"compress/gzip"
	"context"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"io/fs"
	"testing/fstest"

	"github.com/OCAP2/web/internal/maptool"
	"github.com/go-fuego/fuego"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// writeGzipped is a helper to write gzipped data for tests
func writeGzipped(path string, data []byte) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()

	gw := gzip.NewWriter(f)
	if _, err := gw.Write(data); err != nil {
		return err
	}
	return gw.Close()
}

func TestGetOperations(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")

	repo, err := NewRepoOperation(pathDB)
	require.NoError(t, err)
	defer func() { assert.NoError(t, repo.db.Close()) }()

	ctx := t.Context()

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
		mockCtx := fuego.NewMockContextNoBody()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/operations", nil)
		mockCtx.SetRequest(req)

		result, err := hdlr.GetOperations(mockCtx)
		assert.NoError(t, err)
		assert.Len(t, result, 2)
	})

	t.Run("filter by name", func(t *testing.T) {
		mockCtx := fuego.NewMockContextNoBody()
		mockCtx.SetQueryParam("name", "Alpha")

		result, err := hdlr.GetOperations(mockCtx)
		assert.NoError(t, err)
		assert.Len(t, result, 1)
		assert.Equal(t, "Mission Alpha", result[0].MissionName)
	})

	t.Run("filter by tag", func(t *testing.T) {
		mockCtx := fuego.NewMockContextNoBody()
		mockCtx.SetQueryParam("tag", "tvt")

		result, err := hdlr.GetOperations(mockCtx)
		assert.NoError(t, err)
		assert.Len(t, result, 1)
		assert.Equal(t, "tvt", result[0].Tag)
	})

	t.Run("filter by date range", func(t *testing.T) {
		mockCtx := fuego.NewMockContextNoBody()
		mockCtx.SetQueryParam("newer", "2026-01-18")
		mockCtx.SetQueryParam("older", "2026-01-25")

		result, err := hdlr.GetOperations(mockCtx)
		assert.NoError(t, err)
		assert.Len(t, result, 1)
		assert.Equal(t, "Mission Beta", result[0].MissionName)
	})
}

func TestGetCustomize(t *testing.T) {
	t.Run("enabled", func(t *testing.T) {
		hdlr := Handler{
			setting: Setting{
				Customize: Customize{
					Enabled:          true,
					WebsiteURL:       "https://example.com",
					WebsiteLogo:      "/logo.png",
					WebsiteLogoSize:  "64px",
					DisableKillCount: true,
				},
			},
		}

		mockCtx := fuego.NewMockContextNoBody()
		result, err := hdlr.GetCustomize(mockCtx)
		assert.NoError(t, err)
		assert.Equal(t, "https://example.com", result.WebsiteURL)
		assert.Equal(t, "/logo.png", result.WebsiteLogo)
		assert.Equal(t, "64px", result.WebsiteLogoSize)
		assert.True(t, result.DisableKillCount)
	})

	t.Run("disabled", func(t *testing.T) {
		hdlr := Handler{
			setting: Setting{
				Customize: Customize{
					Enabled: false,
				},
			},
		}

		mockCtx := fuego.NewMockContextNoBody()
		result, err := hdlr.GetCustomize(mockCtx)
		assert.NoError(t, err)
		assert.Nil(t, result)
	})
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

	mockCtx := fuego.NewMockContextNoBody()
	result, err := hdlr.GetVersion(mockCtx)
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
	defer func() { assert.NoError(t, repo.db.Close()) }()

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

		require.NoError(t, writer.WriteField("secret", "test-secret"))
		require.NoError(t, writer.WriteField("worldName", "altis"))
		require.NoError(t, writer.WriteField("missionName", "Test Mission"))
		require.NoError(t, writer.WriteField("missionDuration", "3600"))
		require.NoError(t, writer.WriteField("filename", "test_upload"))
		require.NoError(t, writer.WriteField("tag", "coop"))

		// Create file part
		fileWriter, err := writer.CreateFormFile("file", "test_upload.json.gz")
		require.NoError(t, err)

		// Write gzipped JSON data
		gw := gzip.NewWriter(fileWriter)
		_, err = gw.Write([]byte(`{"test": "data"}`))
		require.NoError(t, err)
		require.NoError(t, gw.Close())

		require.NoError(t, writer.Close())

		req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/add", body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		rec := httptest.NewRecorder()

		hdlr.StoreOperation(rec, req)
		assert.Equal(t, http.StatusOK, rec.Code)

		// Verify file was created
		_, err = os.Stat(filepath.Join(dataDir, "test_upload.json.gz"))
		assert.NoError(t, err)
	})

	t.Run("wrong secret", func(t *testing.T) {
		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		require.NoError(t, writer.WriteField("secret", "wrong-secret"))
		require.NoError(t, writer.Close())

		req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/add", body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		rec := httptest.NewRecorder()

		hdlr.StoreOperation(rec, req)
		assert.Equal(t, http.StatusForbidden, rec.Code)
	})

	t.Run("invalid duration", func(t *testing.T) {
		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		require.NoError(t, writer.WriteField("secret", "test-secret"))
		require.NoError(t, writer.WriteField("missionDuration", "not-a-number"))
		require.NoError(t, writer.Close())

		req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/add", body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		rec := httptest.NewRecorder()

		hdlr.StoreOperation(rec, req)
		assert.Equal(t, http.StatusBadRequest, rec.Code)
	})
}

func TestGetData(t *testing.T) {
	dir := t.TempDir()
	dataDir := filepath.Join(dir, "data")

	// Create test gzipped JSON file
	err := os.MkdirAll(dataDir, 0755)
	require.NoError(t, err)
	testPath := filepath.Join(dataDir, "test_capture.json.gz")
	err = writeGzipped(testPath, []byte(`{"test": "capture data"}`))
	require.NoError(t, err)

	// Create test protobuf manifest
	missionDir := filepath.Join(dataDir, "test_mission")
	chunksDir := filepath.Join(missionDir, "chunks")
	err = os.MkdirAll(chunksDir, 0755)
	require.NoError(t, err)
	err = os.WriteFile(filepath.Join(missionDir, "manifest.pb"), []byte("fake protobuf"), 0644)
	require.NoError(t, err)
	err = os.WriteFile(filepath.Join(chunksDir, "0000.pb"), []byte("fake chunk"), 0644)
	require.NoError(t, err)

	hdlr := Handler{
		setting: Setting{Data: dataDir},
	}

	t.Run("serve gzipped JSON with correct headers", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/data/test_capture.json.gz", nil)
		req.SetPathValue("path", "test_capture.json.gz")
		rec := httptest.NewRecorder()

		hdlr.GetData(rec, req)
		assert.Equal(t, "gzip", rec.Header().Get("Content-Encoding"))
		assert.Equal(t, "application/json", rec.Header().Get("Content-Type"))
	})

	t.Run("serve protobuf manifest", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/data/test_mission/manifest.pb", nil)
		req.SetPathValue("path", "test_mission/manifest.pb")
		rec := httptest.NewRecorder()

		hdlr.GetData(rec, req)
		assert.Equal(t, http.StatusOK, rec.Code)
		assert.Equal(t, "fake protobuf", rec.Body.String())
	})

	t.Run("serve protobuf chunk", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/data/test_mission/chunks/0000.pb", nil)
		req.SetPathValue("path", "test_mission/chunks/0000.pb")
		rec := httptest.NewRecorder()

		hdlr.GetData(rec, req)
		assert.Equal(t, http.StatusOK, rec.Code)
		assert.Equal(t, "fake chunk", rec.Body.String())
	})

	t.Run("nonexistent file", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/data/nonexistent.json.gz", nil)
		req.SetPathValue("path", "nonexistent.json.gz")
		rec := httptest.NewRecorder()

		hdlr.GetData(rec, req)
		assert.Equal(t, http.StatusNotFound, rec.Code)
	})

	t.Run("path traversal blocked", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/data/../../../etc/passwd", nil)
		req.SetPathValue("path", "../../../etc/passwd")
		rec := httptest.NewRecorder()

		hdlr.GetData(rec, req)
		assert.Equal(t, http.StatusNotFound, rec.Code)
	})

	t.Run("non-gz file has no gzip headers", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/data/test_mission/manifest.pb", nil)
		req.SetPathValue("path", "test_mission/manifest.pb")
		rec := httptest.NewRecorder()

		hdlr.GetData(rec, req)
		assert.Empty(t, rec.Header().Get("Content-Encoding"))
	})
}

func TestGetMapTile(t *testing.T) {
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
		req := httptest.NewRequest(http.MethodGet, "/images/maps/altis/0_0.png", nil)
		req.SetPathValue("path", "altis/0_0.png")
		rec := httptest.NewRecorder()

		hdlr.GetMapTile(rec, req)
		assert.Equal(t, http.StatusOK, rec.Code)
	})

	t.Run("path traversal blocked", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/images/maps/../../../etc/passwd", nil)
		req.SetPathValue("path", "../../../etc/passwd")
		rec := httptest.NewRecorder()

		hdlr.GetMapTile(rec, req)
		assert.Equal(t, http.StatusNotFound, rec.Code)
	})
}

func TestStaticFileServing(t *testing.T) {
	dir := t.TempDir()
	staticDir := filepath.Join(dir, "static")
	err := os.MkdirAll(staticDir, 0755)
	require.NoError(t, err)

	// Create test static files
	err = os.WriteFile(filepath.Join(staticDir, "index.html"), []byte("<html>test</html>"), 0644)
	require.NoError(t, err)

	scriptsDir := filepath.Join(staticDir, "assets")
	err = os.MkdirAll(scriptsDir, 0755)
	require.NoError(t, err)
	err = os.WriteFile(filepath.Join(scriptsDir, "app.js"), []byte("// test"), 0644)
	require.NoError(t, err)

	pathDB := filepath.Join(dir, "test.db")
	repo, err := NewRepoOperation(pathDB)
	require.NoError(t, err)
	defer func() { assert.NoError(t, repo.db.Close()) }()
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "markers"), 0755))
	repoMarker, err := NewRepoMarker(filepath.Join(dir, "markers"))
	require.NoError(t, err)
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "ammo"), 0755))
	repoAmmo, err := NewRepoAmmo(filepath.Join(dir, "ammo"))
	require.NoError(t, err)

	s := fuego.NewServer(fuego.WithoutStartupMessages(), fuego.WithoutAutoGroupTags(), fuego.WithSecurity(OpenAPISecuritySchemes))
	NewHandler(s, repo, repoMarker, repoAmmo, Setting{}, WithStaticFS(os.DirFS(staticDir)))

	ts := httptest.NewServer(s.Mux)
	defer ts.Close()

	client := &http.Client{}

	t.Run("get static file", func(t *testing.T) {
		resp, err := client.Get(ts.URL + "/assets/app.js")
		require.NoError(t, err)
		defer resp.Body.Close()
		assert.Equal(t, http.StatusOK, resp.StatusCode)
	})

	t.Run("root path serves index.html", func(t *testing.T) {
		resp, err := client.Get(ts.URL + "/")
		require.NoError(t, err)
		defer resp.Body.Close()
		assert.Equal(t, http.StatusOK, resp.StatusCode)
	})

	t.Run("SPA fallback serves index.html for unknown paths", func(t *testing.T) {
		resp, err := client.Get(ts.URL + "/some/spa/route")
		require.NoError(t, err)
		defer resp.Body.Close()
		assert.Equal(t, http.StatusOK, resp.StatusCode)
	})
}

func TestStaticFileServingWithPrefix(t *testing.T) {
	dir := t.TempDir()
	staticDir := filepath.Join(dir, "static")
	err := os.MkdirAll(filepath.Join(staticDir, "assets"), 0755)
	require.NoError(t, err)
	err = os.WriteFile(filepath.Join(staticDir, "index.html"), []byte("<html>prefixed</html>"), 0644)
	require.NoError(t, err)
	err = os.WriteFile(filepath.Join(staticDir, "assets", "app.js"), []byte("// prefixed"), 0644)
	require.NoError(t, err)

	pathDB := filepath.Join(dir, "test.db")
	repo, err := NewRepoOperation(pathDB)
	require.NoError(t, err)
	defer func() { assert.NoError(t, repo.db.Close()) }()
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "markers"), 0755))
	repoMarker, err := NewRepoMarker(filepath.Join(dir, "markers"))
	require.NoError(t, err)
	require.NoError(t, os.MkdirAll(filepath.Join(dir, "ammo"), 0755))
	repoAmmo, err := NewRepoAmmo(filepath.Join(dir, "ammo"))
	require.NoError(t, err)

	s := fuego.NewServer(fuego.WithoutStartupMessages(), fuego.WithoutAutoGroupTags(), fuego.WithSecurity(OpenAPISecuritySchemes))
	NewHandler(s, repo, repoMarker, repoAmmo, Setting{PrefixURL: "/sub/"}, WithStaticFS(os.DirFS(staticDir)))

	ts := httptest.NewServer(s.Mux)
	defer ts.Close()

	client := &http.Client{}

	t.Run("static file under prefix", func(t *testing.T) {
		resp, err := client.Get(ts.URL + "/sub/assets/app.js")
		require.NoError(t, err)
		defer resp.Body.Close()
		assert.Equal(t, http.StatusOK, resp.StatusCode)
	})

	t.Run("SPA fallback under prefix", func(t *testing.T) {
		resp, err := client.Get(ts.URL + "/sub/some/spa/route")
		require.NoError(t, err)
		defer resp.Body.Close()
		assert.Equal(t, http.StatusOK, resp.StatusCode)
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
			req := httptest.NewRequest(http.MethodGet, "/"+tt.param, nil)
			req.SetPathValue("path", tt.param)

			got, err := paramPathFromRequest(req, "path")

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

		req := httptest.NewRequest(http.MethodGet, "/", nil)
		rec := httptest.NewRecorder()

		inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte("test"))
		})
		mw(inner).ServeHTTP(rec, req)
		assert.Equal(t, "max-age=604800", rec.Header().Get("Cache-Control"))
	})

	t.Run("no cache", func(t *testing.T) {
		mw := hdlr.cacheControl(0)

		req := httptest.NewRequest(http.MethodGet, "/", nil)
		rec := httptest.NewRecorder()

		inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte("test"))
		})
		mw(inner).ServeHTTP(rec, req)
		assert.Equal(t, "no-cache", rec.Header().Get("Cache-Control"))
	})

	t.Run("short duration treated as no cache", func(t *testing.T) {
		mw := hdlr.cacheControl(500 * time.Millisecond)

		req := httptest.NewRequest(http.MethodGet, "/", nil)
		rec := httptest.NewRecorder()

		inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte("test"))
		})
		mw(inner).ServeHTTP(rec, req)
		assert.Equal(t, "no-cache", rec.Header().Get("Cache-Control"))
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
	defer func() { assert.NoError(t, repo.db.Close()) }()

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
	require.NoError(t, writer.WriteField("secret", "test-secret"))
	require.NoError(t, writer.WriteField("worldName", "altis"))
	require.NoError(t, writer.WriteField("missionName", "Trigger Test"))
	require.NoError(t, writer.WriteField("missionDuration", "3600"))
	require.NoError(t, writer.WriteField("filename", "trigger_test"))
	require.NoError(t, writer.WriteField("tag", "coop"))

	fileWriter, err := writer.CreateFormFile("file", "trigger_test.json.gz")
	require.NoError(t, err)
	gw := gzip.NewWriter(fileWriter)
	_, err = gw.Write([]byte(`{"test": "trigger"}`))
	require.NoError(t, err)
	require.NoError(t, gw.Close())
	require.NoError(t, writer.Close())

	req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/add", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()

	hdlr.StoreOperation(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code)

	// Verify trigger was called
	assert.True(t, trigger.triggered)
	assert.Equal(t, "trigger_test", trigger.filename)
}

func TestStoreOperation_NoConversion_MarksCompleted(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")
	dataDir := filepath.Join(dir, "data")
	err := os.MkdirAll(dataDir, 0755)
	require.NoError(t, err)

	repo, err := NewRepoOperation(pathDB)
	require.NoError(t, err)
	defer func() { require.NoError(t, repo.db.Close()) }()

	// Handler with NO conversion trigger (conversion disabled)
	hdlr := Handler{
		repoOperation: repo,
		setting: Setting{
			Secret: "test-secret",
			Data:   dataDir,
		},
	}

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	require.NoError(t, writer.WriteField("secret", "test-secret"))
	require.NoError(t, writer.WriteField("worldName", "altis"))
	require.NoError(t, writer.WriteField("missionName", "No Conversion Mission"))
	require.NoError(t, writer.WriteField("missionDuration", "3600"))
	require.NoError(t, writer.WriteField("filename", "no_conversion_test"))
	require.NoError(t, writer.WriteField("tag", "coop"))

	fileWriter, err := writer.CreateFormFile("file", "no_conversion_test.json.gz")
	require.NoError(t, err)
	gw := gzip.NewWriter(fileWriter)
	_, err = gw.Write([]byte(`{"test": "data"}`))
	require.NoError(t, err)
	require.NoError(t, gw.Close())
	require.NoError(t, writer.Close())

	req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/add", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()

	hdlr.StoreOperation(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)

	// Verify the operation was marked as "completed" in the database
	ctx := t.Context()
	op, err := repo.GetByID(ctx, "1")
	require.NoError(t, err)
	assert.Equal(t, ConversionStatusCompleted, op.ConversionStatus)
	assert.Equal(t, "json", op.StorageFormat)

	// Verify no pending operations remain
	pending, err := repo.SelectPending(ctx, 10)
	require.NoError(t, err)
	assert.Empty(t, pending)
}

func TestStoreOperation_WithConversion_StaysPending(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")
	dataDir := filepath.Join(dir, "data")
	err := os.MkdirAll(dataDir, 0755)
	require.NoError(t, err)

	repo, err := NewRepoOperation(pathDB)
	require.NoError(t, err)
	defer func() { require.NoError(t, repo.db.Close()) }()

	trigger := &mockConversionTrigger{}

	// Handler WITH conversion trigger (conversion enabled)
	hdlr := Handler{
		repoOperation:     repo,
		conversionTrigger: trigger,
		setting: Setting{
			Secret: "test-secret",
			Data:   dataDir,
		},
	}

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	require.NoError(t, writer.WriteField("secret", "test-secret"))
	require.NoError(t, writer.WriteField("worldName", "altis"))
	require.NoError(t, writer.WriteField("missionName", "With Conversion Mission"))
	require.NoError(t, writer.WriteField("missionDuration", "3600"))
	require.NoError(t, writer.WriteField("filename", "with_conversion_test"))
	require.NoError(t, writer.WriteField("tag", "coop"))

	fileWriter, err := writer.CreateFormFile("file", "with_conversion_test.json.gz")
	require.NoError(t, err)
	gw := gzip.NewWriter(fileWriter)
	_, err = gw.Write([]byte(`{"test": "data"}`))
	require.NoError(t, err)
	require.NoError(t, gw.Close())
	require.NoError(t, writer.Close())

	req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/add", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()

	hdlr.StoreOperation(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)

	// Verify conversion trigger was called
	assert.True(t, trigger.triggered)
	assert.Equal(t, "with_conversion_test", trigger.filename)

	// Verify the operation stays "pending" in the database (conversion worker handles transition)
	ctx := t.Context()
	op, err := repo.GetByID(ctx, "1")
	require.NoError(t, err)
	assert.Equal(t, ConversionStatusPending, op.ConversionStatus)
	assert.Equal(t, "json", op.StorageFormat)

	// Verify it shows up in pending list
	pending, err := repo.SelectPending(ctx, 10)
	require.NoError(t, err)
	assert.Len(t, pending, 1)
	assert.Equal(t, "with_conversion_test", pending[0].Filename)
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
	defer func() { assert.NoError(t, repo.db.Close()) }()

	repoMarker, err := NewRepoMarker(markerDir)
	require.NoError(t, err)

	repoAmmo, err := NewRepoAmmo(ammoDir)
	require.NoError(t, err)

	setting := Setting{
		Listen:    "127.0.0.1:5000",
		PrefixURL: "/sub/",
		Secret:    "test-secret",
		Data:      dataDir,
		Markers:   markerDir,
		Ammo:      ammoDir,
	}

	s := fuego.NewServer(fuego.WithoutStartupMessages(), fuego.WithoutAutoGroupTags(), fuego.WithSecurity(OpenAPISecuritySchemes))

	// Should not panic
	NewHandler(s, repo, repoMarker, repoAmmo, setting, WithStaticFS(os.DirFS(dir)))

	// Verify the server has routes by making test requests
	ts := httptest.NewServer(s.Mux)
	defer ts.Close()

	// Check that operations endpoint exists
	resp, err := http.Get(ts.URL + "/sub/api/v1/operations")
	require.NoError(t, err)
	defer resp.Body.Close()
	assert.Equal(t, http.StatusOK, resp.StatusCode)
}

func TestNewHandlerWithOptions(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")
	dataDir := filepath.Join(dir, "data")
	markerDir := filepath.Join(dir, "markers")
	ammoDir := filepath.Join(dir, "ammo")

	for _, d := range []string{dataDir, markerDir, ammoDir} {
		require.NoError(t, os.MkdirAll(d, 0755))
	}

	repo, err := NewRepoOperation(pathDB)
	require.NoError(t, err)
	defer func() { assert.NoError(t, repo.db.Close()) }()
	repoMarker, err := NewRepoMarker(markerDir)
	require.NoError(t, err)
	repoAmmo, err := NewRepoAmmo(ammoDir)
	require.NoError(t, err)

	setting := Setting{
		Data:    dataDir,
		Markers: markerDir,
		Ammo:    ammoDir,
	}

	trigger := &mockConversionTrigger{}
	s := fuego.NewServer(fuego.WithoutStartupMessages(), fuego.WithoutAutoGroupTags(), fuego.WithSecurity(OpenAPISecuritySchemes))

	// Should apply options
	NewHandler(s, repo, repoMarker, repoAmmo, setting, WithConversionTrigger(trigger), WithStaticFS(os.DirFS(dir)))

	// Verify server has routes
	ts := httptest.NewServer(s.Mux)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/api/healthcheck")
	require.NoError(t, err)
	defer resp.Body.Close()
	assert.Equal(t, http.StatusOK, resp.StatusCode)
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
	req := httptest.NewRequest(http.MethodGet, "/images/markers/test_marker/blufor.png", nil)
	req.SetPathValue("name", "test_marker")
	req.SetPathValue("color", "blufor.png")
	rec := httptest.NewRecorder()

	hdlr.GetMarker(rec, req)
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
	req := httptest.NewRequest(http.MethodGet, "/images/ammo/grenade_x_ca.paa.png", nil)
	req.SetPathValue("name", "grenade_x_ca.paa.png")
	rec := httptest.NewRecorder()

	hdlr.GetAmmo(rec, req)
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
	defer func() { assert.NoError(t, repo.db.Close()) }()

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
	require.NoError(t, writer.WriteField("secret", "test-secret"))
	require.NoError(t, writer.WriteField("worldName", "altis"))
	require.NoError(t, writer.WriteField("missionName", "No File Test"))
	require.NoError(t, writer.WriteField("missionDuration", "3600"))
	require.NoError(t, writer.WriteField("filename", "no_file_test"))
	require.NoError(t, writer.WriteField("tag", "coop"))
	// No file field added
	require.NoError(t, writer.Close())

	req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/add", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()

	hdlr.StoreOperation(rec, req)
	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestStoreOperation_InvalidMissionDuration(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")
	dataDir := filepath.Join(dir, "data")
	err := os.MkdirAll(dataDir, 0755)
	require.NoError(t, err)

	repo, err := NewRepoOperation(pathDB)
	require.NoError(t, err)
	defer func() { assert.NoError(t, repo.db.Close()) }()

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
	require.NoError(t, writer.WriteField("secret", "test-secret"))
	require.NoError(t, writer.WriteField("worldName", "altis"))
	require.NoError(t, writer.WriteField("missionName", "Invalid Duration Test"))
	require.NoError(t, writer.WriteField("missionDuration", "not-a-number")) // Invalid
	require.NoError(t, writer.WriteField("filename", "invalid_duration_test"))
	require.NoError(t, writer.WriteField("tag", "coop"))

	fileWriter, err := writer.CreateFormFile("file", "test.json.gz")
	require.NoError(t, err)
	gw := gzip.NewWriter(fileWriter)
	_, err = gw.Write([]byte(`{"test": "data"}`))
	require.NoError(t, err)
	require.NoError(t, gw.Close())
	require.NoError(t, writer.Close())

	req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/add", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()

	hdlr.StoreOperation(rec, req)
	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestStoreOperation_CookieAuth(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")
	dataDir := filepath.Join(dir, "data")
	err := os.MkdirAll(dataDir, 0755)
	require.NoError(t, err)

	repo, err := NewRepoOperation(pathDB)
	require.NoError(t, err)
	defer func() { assert.NoError(t, repo.db.Close()) }()

	jwtMgr := NewJWTManager("test-secret", time.Hour)

	hdlr := Handler{
		repoOperation: repo,
		jwt:           jwtMgr,
		setting: Setting{
			Secret: "test-secret",
			Data:   dataDir,
		},
	}

	t.Run("valid JWT token without secret succeeds", func(t *testing.T) {
		token, err := jwtMgr.Create("")
		require.NoError(t, err)

		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		// Deliberately omit the secret field
		require.NoError(t, writer.WriteField("worldName", "altis"))
		require.NoError(t, writer.WriteField("missionName", "Cookie Upload Test"))
		require.NoError(t, writer.WriteField("missionDuration", "3600"))
		require.NoError(t, writer.WriteField("filename", "cookie_upload_test"))

		fileWriter, err := writer.CreateFormFile("file", "cookie_upload_test.json.gz")
		require.NoError(t, err)
		gw := gzip.NewWriter(fileWriter)
		_, err = gw.Write([]byte(`{"test": "cookie auth"}`))
		require.NoError(t, err)
		require.NoError(t, gw.Close())
		require.NoError(t, writer.Close())

		req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/add", body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()

		hdlr.StoreOperation(rec, req)
		assert.Equal(t, http.StatusOK, rec.Code)

		// Verify file was created
		_, err = os.Stat(filepath.Join(dataDir, "cookie_upload_test.json.gz"))
		assert.NoError(t, err)
	})

	t.Run("invalid JWT token without secret fails", func(t *testing.T) {
		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		require.NoError(t, writer.WriteField("worldName", "altis"))
		require.NoError(t, writer.WriteField("missionName", "Bad Cookie Test"))
		require.NoError(t, writer.WriteField("missionDuration", "3600"))
		require.NoError(t, writer.WriteField("filename", "bad_cookie_test"))
		require.NoError(t, writer.Close())

		req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/add", body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		req.Header.Set("Authorization", "Bearer invalid-token")
		rec := httptest.NewRecorder()

		hdlr.StoreOperation(rec, req)
		assert.Equal(t, http.StatusForbidden, rec.Code)
	})

	t.Run("no secret and no token fails", func(t *testing.T) {
		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		require.NoError(t, writer.WriteField("worldName", "altis"))
		require.NoError(t, writer.WriteField("missionName", "No Auth Test"))
		require.NoError(t, writer.WriteField("missionDuration", "3600"))
		require.NoError(t, writer.WriteField("filename", "no_auth_test"))
		require.NoError(t, writer.Close())

		req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/add", body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		rec := httptest.NewRecorder()

		hdlr.StoreOperation(rec, req)
		assert.Equal(t, http.StatusForbidden, rec.Code)
	})
}

func TestStoreOperation_WrongSecret(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")
	dataDir := filepath.Join(dir, "data")
	err := os.MkdirAll(dataDir, 0755)
	require.NoError(t, err)

	repo, err := NewRepoOperation(pathDB)
	require.NoError(t, err)
	defer func() { assert.NoError(t, repo.db.Close()) }()

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
	require.NoError(t, writer.WriteField("secret", "wrong-secret"))
	require.NoError(t, writer.WriteField("worldName", "altis"))
	require.NoError(t, writer.WriteField("missionName", "Wrong Secret Test"))
	require.NoError(t, writer.WriteField("missionDuration", "3600"))
	require.NoError(t, writer.WriteField("filename", "wrong_secret_test"))
	require.NoError(t, writer.WriteField("tag", "coop"))

	fileWriter, err := writer.CreateFormFile("file", "test.json.gz")
	require.NoError(t, err)
	gw := gzip.NewWriter(fileWriter)
	_, err = gw.Write([]byte(`{"test": "data"}`))
	require.NoError(t, err)
	require.NoError(t, gw.Close())
	require.NoError(t, writer.Close())

	req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/add", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()

	hdlr.StoreOperation(rec, req)
	assert.Equal(t, http.StatusForbidden, rec.Code)
}

func TestGetHealthcheck(t *testing.T) {
	hdlr := Handler{}

	mockCtx := fuego.NewMockContextNoBody()
	result, err := hdlr.GetHealthcheck(mockCtx)
	assert.NoError(t, err)
	assert.Equal(t, "ok", result.Status)
}

func TestGetOperation(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")

	repo, err := NewRepoOperation(pathDB)
	require.NoError(t, err)
	defer repo.db.Close()

	ctx := t.Context()

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

	t.Run("found by ID", func(t *testing.T) {
		mockCtx := fuego.NewMockContextNoBody()
		mockCtx.PathParams = map[string]string{"id": "1"}

		result, err := hdlr.GetOperation(mockCtx)
		assert.NoError(t, err)
		assert.Equal(t, "Mission Alpha", result.MissionName)
	})

	t.Run("found by filename", func(t *testing.T) {
		mockCtx := fuego.NewMockContextNoBody()
		mockCtx.PathParams = map[string]string{"id": "mission_alpha"}

		result, err := hdlr.GetOperation(mockCtx)
		assert.NoError(t, err)
		assert.Equal(t, "Mission Alpha", result.MissionName)
	})

	t.Run("not found", func(t *testing.T) {
		mockCtx := fuego.NewMockContextNoBody()
		mockCtx.PathParams = map[string]string{"id": "999"}

		_, err := hdlr.GetOperation(mockCtx)
		assert.IsType(t, fuego.NotFoundError{}, err)
	})
}

func TestGetFont(t *testing.T) {
	dir := t.TempDir()
	fontsDir := filepath.Join(dir, "fonts")
	fontStack := filepath.Join(fontsDir, "Open Sans Regular")
	require.NoError(t, os.MkdirAll(fontStack, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(fontStack, "0-255.pbf"), []byte("fake font"), 0644))

	hdlr := Handler{setting: Setting{Fonts: fontsDir}}

	req := httptest.NewRequest(http.MethodGet, "/images/maps/fonts/Open%20Sans%20Regular/0-255.pbf", nil)
	req.SetPathValue("fontstack", "Open Sans Regular")
	req.SetPathValue("range", "0-255.pbf")
	rec := httptest.NewRecorder()

	hdlr.GetFont(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code)
}

func TestGetSprite(t *testing.T) {
	hdlr := Handler{}

	tests := []struct {
		name       string
		wantStatus int
		wantType   string
	}{
		{"sprite.json", http.StatusOK, "application/json"},
		{"sprite.png", http.StatusOK, "image/png"},
		{"sprite-dark.json", http.StatusOK, "application/json"},
		{"sprite-dark.png", http.StatusOK, "image/png"},
		{"nonexistent.json", http.StatusNotFound, ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/images/maps/sprites/"+tt.name, nil)
			req.SetPathValue("name", tt.name)
			rec := httptest.NewRecorder()

			hdlr.GetSprite(rec, req)
			if tt.wantStatus == http.StatusNotFound {
				assert.Equal(t, http.StatusNotFound, rec.Code)
			} else {
				assert.Equal(t, tt.wantStatus, rec.Code)
				assert.Contains(t, rec.Header().Get("Content-Type"), tt.wantType)
				assert.Greater(t, rec.Body.Len(), 0)
			}
		})
	}
}

func TestWithMapTool(t *testing.T) {
	jm := maptool.NewJobManager(t.TempDir(), func() *maptool.Pipeline {
		return maptool.NewPipeline(nil)
	})
	tools := maptool.ToolSet{{Name: "test", Found: true}}

	opt := WithMapTool(jm, tools, "/maps")
	hdlr := &Handler{}
	opt(hdlr)

	assert.NotNil(t, hdlr.maptoolMgr)
	assert.NotNil(t, hdlr.maptoolCfg)
	assert.Equal(t, "/maps", hdlr.maptoolCfg.mapsDir)
}

func TestStoreOperation_RawJSON(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")
	dataDir := filepath.Join(dir, "data")
	require.NoError(t, os.MkdirAll(dataDir, 0755))

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

	// Create multipart form with RAW (non-gzipped) JSON data
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	writer.WriteField("secret", "test-secret")
	writer.WriteField("worldName", "altis")
	writer.WriteField("missionName", "Raw JSON Test")
	writer.WriteField("missionDuration", "3600")
	writer.WriteField("filename", "raw_json_test")
	writer.WriteField("tag", "coop")

	fileWriter, err := writer.CreateFormFile("file", "raw_json_test.json")
	require.NoError(t, err)
	// Write raw JSON (NOT gzipped) — triggers the else branch
	fileWriter.Write([]byte(`{"entities":[],"events":[]}`))
	writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/add", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()

	hdlr.StoreOperation(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code)

	// Verify file was created and is gzipped
	outPath := filepath.Join(dataDir, "raw_json_test.json.gz")
	f, err := os.Open(outPath)
	require.NoError(t, err)
	defer func() { assert.NoError(t, f.Close()) }()
	var magic [2]byte
	_, err = f.Read(magic[:])
	require.NoError(t, err)
	assert.Equal(t, byte(0x1f), magic[0], "should be gzip magic")
	assert.Equal(t, byte(0x8b), magic[1], "should be gzip magic")
}

func TestGetData_RawJSONLegacy(t *testing.T) {
	dir := t.TempDir()
	dataDir := filepath.Join(dir, "data")
	require.NoError(t, os.MkdirAll(dataDir, 0755))

	// Create a .json.gz file that's actually raw JSON (legacy upload behavior)
	testPath := filepath.Join(dataDir, "legacy.json.gz")
	require.NoError(t, os.WriteFile(testPath, []byte(`{"test": "raw"}`), 0644))

	hdlr := Handler{setting: Setting{Data: dataDir}}

	req := httptest.NewRequest(http.MethodGet, "/data/legacy.json.gz", nil)
	req.SetPathValue("path", "legacy.json.gz")
	rec := httptest.NewRecorder()

	hdlr.GetData(rec, req)
	// Raw JSON should have Content-Type but no Content-Encoding
	assert.Equal(t, "application/json", rec.Header().Get("Content-Type"))
	assert.Empty(t, rec.Header().Get("Content-Encoding"))
}

func TestNewHandler_WithMapTool(t *testing.T) {
	dir := t.TempDir()
	for _, d := range []string{"data", "markers", "ammo", "maps"} {
		require.NoError(t, os.MkdirAll(filepath.Join(dir, d), 0755))
	}

	repo, err := NewRepoOperation(filepath.Join(dir, "test.db"))
	require.NoError(t, err)
	defer repo.db.Close()
	repoMarker, _ := NewRepoMarker(filepath.Join(dir, "markers"))
	repoAmmo, _ := NewRepoAmmo(filepath.Join(dir, "ammo"))

	jm := maptool.NewJobManager(filepath.Join(dir, "maps"), func() *maptool.Pipeline {
		return maptool.NewPipeline(nil)
	})
	tools := maptool.ToolSet{{Name: "pmtiles", Found: true}}

	s := fuego.NewServer(fuego.WithoutStartupMessages(), fuego.WithoutAutoGroupTags(), fuego.WithSecurity(OpenAPISecuritySchemes))
	NewHandler(s, repo, repoMarker, repoAmmo, Setting{
		Data: filepath.Join(dir, "data"),
		Maps: filepath.Join(dir, "maps"),
	}, WithMapTool(jm, tools, filepath.Join(dir, "maps")))

	// Verify maptool routes were registered by making a test request
	ts := httptest.NewServer(s.Mux)
	defer ts.Close()

	// The maptool endpoints are behind admin auth, so we get 401
	// but the fact that it's NOT 404 proves the route exists
	resp, err := http.Get(ts.URL + "/api/v1/maptool/tools")
	require.NoError(t, err)
	defer resp.Body.Close()
	assert.NotEqual(t, http.StatusNotFound, resp.StatusCode)
}

func TestGetData_NonexistentNonGz(t *testing.T) {
	dir := t.TempDir()
	hdlr := Handler{setting: Setting{Data: dir}}

	req := httptest.NewRequest(http.MethodGet, "/data/missing.pb", nil)
	req.SetPathValue("path", "missing.pb")
	rec := httptest.NewRecorder()

	hdlr.GetData(rec, req)
	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestGetOperations_Success(t *testing.T) {
	dir := t.TempDir()
	repo, err := NewRepoOperation(filepath.Join(dir, "test.db"))
	require.NoError(t, err)
	defer repo.db.Close()

	ctx := t.Context()
	for _, op := range []*Operation{
		{WorldName: "altis", MissionName: "Mission Alpha", MissionDuration: 3600, Filename: "alpha", Date: "2026-01-15", Tag: "coop"},
		{WorldName: "stratis", MissionName: "Mission Beta", MissionDuration: 1800, Filename: "beta", Date: "2026-01-20", Tag: "tvt"},
	} {
		require.NoError(t, repo.Store(ctx, op))
	}

	hdlr := Handler{repoOperation: repo}

	mockCtx := fuego.NewMockContextNoBody()
	mockCtx.SetQueryParam("name", "Alpha")
	mockCtx.SetQueryParam("tag", "coop")

	result, err := hdlr.GetOperations(mockCtx)
	assert.NoError(t, err)
	assert.Len(t, result, 1)
	assert.Equal(t, "Mission Alpha", result[0].MissionName)
	assert.Equal(t, "coop", result[0].Tag)
}

func TestGetOperations_WithFilters(t *testing.T) {
	dir := t.TempDir()
	repo, err := NewRepoOperation(filepath.Join(dir, "test.db"))
	require.NoError(t, err)
	defer repo.db.Close()

	ctx := t.Context()
	for _, op := range []*Operation{
		{WorldName: "altis", MissionName: "Early", MissionDuration: 100, Filename: "early", Date: "2025-12-01", Tag: "coop"},
		{WorldName: "altis", MissionName: "Mid", MissionDuration: 200, Filename: "mid", Date: "2026-01-10", Tag: "coop"},
		{WorldName: "altis", MissionName: "Late", MissionDuration: 300, Filename: "late", Date: "2026-02-01", Tag: "coop"},
	} {
		require.NoError(t, repo.Store(ctx, op))
	}

	hdlr := Handler{repoOperation: repo}

	mockCtx := fuego.NewMockContextNoBody()
	mockCtx.SetQueryParam("older", "2026-01-15")
	mockCtx.SetQueryParam("newer", "2026-01-01")

	result, err := hdlr.GetOperations(mockCtx)
	assert.NoError(t, err)
	assert.Len(t, result, 1)
	assert.Equal(t, "Mid", result[0].MissionName)
}

func TestGetCustomize_Enabled(t *testing.T) {
	hdlr := Handler{
		setting: Setting{
			Customize: Customize{
				Enabled:    true,
				WebsiteURL: "https://example.com",
			},
		},
	}

	mockCtx := fuego.NewMockContextNoBody()
	result, err := hdlr.GetCustomize(mockCtx)
	assert.NoError(t, err)
	assert.True(t, result.Enabled)
	assert.Equal(t, "https://example.com", result.WebsiteURL)
}

func TestGetCustomize_Disabled(t *testing.T) {
	hdlr := Handler{
		setting: Setting{
			Customize: Customize{Enabled: false},
		},
	}

	mockCtx := fuego.NewMockContextNoBody()
	result, err := hdlr.GetCustomize(mockCtx)
	assert.NoError(t, err)
	assert.Nil(t, result)
}

func TestStoreOperation_FilenameStripping(t *testing.T) {
	dir := t.TempDir()
	dataDir := filepath.Join(dir, "data")
	require.NoError(t, os.MkdirAll(dataDir, 0755))

	repo, err := NewRepoOperation(filepath.Join(dir, "test.db"))
	require.NoError(t, err)
	defer repo.db.Close()

	hdlr := Handler{
		repoOperation: repo,
		setting: Setting{
			Secret: "test-secret",
			Data:   dataDir,
		},
	}

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	writer.WriteField("secret", "test-secret")
	writer.WriteField("worldName", "altis")
	writer.WriteField("missionName", "Strip Test")
	writer.WriteField("missionDuration", "3600")
	writer.WriteField("filename", "test_strip.json.gz")
	writer.WriteField("tag", "coop")

	fileWriter, err := writer.CreateFormFile("file", "test_strip.json.gz")
	require.NoError(t, err)
	gw := gzip.NewWriter(fileWriter)
	gw.Write([]byte(`{"test":"strip"}`))
	gw.Close()
	writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/add", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()

	hdlr.StoreOperation(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)

	// Verify the stored operation has the stripped filename
	op, err := repo.GetByID(t.Context(), "1")
	require.NoError(t, err)
	assert.Equal(t, "test_strip", op.Filename)
}

func TestStoreOperation_TagFromType(t *testing.T) {
	dir := t.TempDir()
	dataDir := filepath.Join(dir, "data")
	require.NoError(t, os.MkdirAll(dataDir, 0755))

	repo, err := NewRepoOperation(filepath.Join(dir, "test.db"))
	require.NoError(t, err)
	defer repo.db.Close()

	hdlr := Handler{
		repoOperation: repo,
		setting: Setting{
			Secret: "test-secret",
			Data:   dataDir,
		},
	}

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	writer.WriteField("secret", "test-secret")
	writer.WriteField("worldName", "altis")
	writer.WriteField("missionName", "Tag Type Test")
	writer.WriteField("missionDuration", "3600")
	writer.WriteField("filename", "tag_type_test")
	writer.WriteField("tag", "Co")
	writer.WriteField("type", "op")

	fileWriter, err := writer.CreateFormFile("file", "tag_type_test.json.gz")
	require.NoError(t, err)
	gw := gzip.NewWriter(fileWriter)
	gw.Write([]byte(`{"test":"tagtype"}`))
	gw.Close()
	writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/add", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()

	hdlr.StoreOperation(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)

	op, err := repo.GetByID(t.Context(), "1")
	require.NoError(t, err)
	assert.Equal(t, "Coop", op.Tag)
}

func TestGetMarker_UnescapedName(t *testing.T) {
	dir := t.TempDir()
	markerDir := filepath.Join(dir, "markers")
	require.NoError(t, os.MkdirAll(markerDir, 0755))

	// Create a marker file named "#test.svg"
	svgContent := `<svg xmlns="http://www.w3.org/2000/svg"><circle fill="{{.}}" r="10"/></svg>`
	require.NoError(t, os.WriteFile(filepath.Join(markerDir, "#test.svg"), []byte(svgContent), 0644))

	repoMarker, err := NewRepoMarker(markerDir)
	require.NoError(t, err)

	hdlr := Handler{repoMarker: repoMarker}

	req := httptest.NewRequest(http.MethodGet, "/images/markers/%23test/blufor", nil)
	req.SetPathValue("name", "%23test")
	req.SetPathValue("color", "blufor")
	rec := httptest.NewRecorder()

	hdlr.GetMarker(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code)
}

func TestGetAmmo_NotFound(t *testing.T) {
	dir := t.TempDir()
	ammoDir := filepath.Join(dir, "ammo")
	require.NoError(t, os.MkdirAll(ammoDir, 0755))

	repoAmmo, err := NewRepoAmmo(ammoDir)
	require.NoError(t, err)

	hdlr := Handler{repoAmmo: repoAmmo}

	req := httptest.NewRequest(http.MethodGet, "/images/markers/magicons/nonexistent", nil)
	req.SetPathValue("name", "nonexistent")
	rec := httptest.NewRecorder()

	hdlr.GetAmmo(rec, req)
	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestStoreOperation_JWTAuth(t *testing.T) {
	dir := t.TempDir()
	dataDir := filepath.Join(dir, "data")
	os.MkdirAll(dataDir, 0755)
	pathDB := filepath.Join(dir, "test.db")
	repo, err := NewRepoOperation(pathDB)
	require.NoError(t, err)

	jwt := NewJWTManager("test-secret", time.Hour)
	token, _ := jwt.Create("")
	h := &Handler{
		repoOperation: repo,
		setting:       Setting{Secret: "actual-secret", Data: dataDir},
		jwt:           jwt,
	}

	// Create multipart body with wrong secret but valid JWT
	body := new(bytes.Buffer)
	writer := multipart.NewWriter(body)
	writer.WriteField("secret", "wrong-secret") // Wrong secret, should fallback to JWT
	writer.WriteField("filename", "test_jwt.json")
	writer.WriteField("worldName", "altis")
	writer.WriteField("missionName", "JWT Auth Test")
	writer.WriteField("missionDuration", "100")
	part, _ := writer.CreateFormFile("file", "test_jwt.json")
	part.Write([]byte(`{"test": true}`))
	writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()

	h.StoreOperation(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code)
}

func TestGetOperations_BindError(t *testing.T) {
	dir := t.TempDir()
	repo, err := NewRepoOperation(filepath.Join(dir, "test.db"))
	require.NoError(t, err)

	h := &Handler{repoOperation: repo}

	// Test the Select error path using closed DB
	repo.db.Close()

	mockCtx := fuego.NewMockContextNoBody()
	_, err = h.GetOperations(mockCtx)
	assert.Error(t, err) // Should return the DB error
}

func TestEditOperation_DBUpdateError(t *testing.T) {
	dir := t.TempDir()
	repo, err := NewRepoOperation(filepath.Join(dir, "test.db"))
	require.NoError(t, err)

	tctx := context.Background()
	op := &Operation{
		WorldName: "altis", MissionName: "Test",
		MissionDuration: 300, Filename: "test_edit",
		Date: "2026-01-01", Tag: "coop",
	}
	require.NoError(t, repo.Store(tctx, op))

	jwt := NewJWTManager("secret", time.Hour)
	h := &Handler{repoOperation: repo, jwt: jwt}

	// Close DB after storing the operation - GetByID will fail
	repo.db.Close()

	body := `{"missionName":"Updated"}`
	req := httptest.NewRequest(http.MethodPut, "/", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	mockCtx := fuego.NewMockContextNoBody()
	mockCtx.PathParams = map[string]string{"id": fmt.Sprintf("%d", op.ID)}
	mockCtx.SetRequest(req)

	_, err = h.EditOperation(mockCtx)
	// Should be NotFoundError since GetByID fails
	assert.Error(t, err)
}

func TestRetryConversion_DBError(t *testing.T) {
	dir := t.TempDir()
	repo, err := NewRepoOperation(filepath.Join(dir, "test.db"))
	require.NoError(t, err)

	tctx := context.Background()
	op := &Operation{
		WorldName: "altis", MissionName: "Test",
		MissionDuration: 300, Filename: "test_retry",
		Date: "2026-01-01", Tag: "coop",
	}
	require.NoError(t, repo.Store(tctx, op))
	// Set to failed so we can retry
	require.NoError(t, repo.UpdateConversionStatus(tctx, op.ID, ConversionStatusFailed))

	jwt := NewJWTManager("secret", time.Hour)
	h := &Handler{repoOperation: repo, setting: Setting{Data: dir}, jwt: jwt}

	// Close DB - GetByID in RetryConversion will fail
	repo.db.Close()

	mockCtx := fuego.NewMockContextNoBody()
	mockCtx.PathParams = map[string]string{"id": fmt.Sprintf("%d", op.ID)}

	_, err = h.RetryConversion(mockCtx)
	assert.Error(t, err)
}

func TestDeleteOperation_DBError(t *testing.T) {
	dir := t.TempDir()
	repo, err := NewRepoOperation(filepath.Join(dir, "test.db"))
	require.NoError(t, err)

	tctx := context.Background()
	op := &Operation{
		WorldName: "altis", MissionName: "Test",
		MissionDuration: 300, Filename: "test_delete",
		Date: "2026-01-01", Tag: "coop",
	}
	require.NoError(t, repo.Store(tctx, op))
	repo.db.Close()

	jwt := NewJWTManager("secret", time.Hour)
	h := &Handler{repoOperation: repo, jwt: jwt}

	mockCtx := fuego.NewMockContextNoBody()
	mockCtx.PathParams = map[string]string{"id": fmt.Sprintf("%d", op.ID)}

	_, err = h.DeleteOperation(mockCtx)
	assert.Error(t, err)
}

func TestSpaFileServer_NoIndex(t *testing.T) {
	// Create an FS with no index.html — covers the indexContent == nil path
	emptyFS := fstest.MapFS{
		"style.css": &fstest.MapFile{Data: []byte("body{}")},
	}

	handler := spaFileServer(emptyFS, "")

	// Request a non-existent path — should fall through to the index fallback,
	// which returns 404 because there is no index.html
	req := httptest.NewRequest(http.MethodGet, "/some/route", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestSpaFileServer_ServesExistingFile(t *testing.T) {
	testFS := fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("<html><head></head></html>")},
		"style.css":  &fstest.MapFile{Data: []byte("body{}")},
	}

	handler := spaFileServer(testFS, "")

	// Request existing file — should serve directly
	req := httptest.NewRequest(http.MethodGet, "/style.css", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), "body{}")
}

func TestSpaFileServer_FallsBackToIndex(t *testing.T) {
	testFS := fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("<html><head></head></html>")},
	}

	handler := spaFileServer(testFS, "")

	// Request non-existent path — should serve index.html with injected base
	req := httptest.NewRequest(http.MethodGet, "/app/route", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), "__BASE_PATH__")
}

func TestStoreOperation_ReadOnlyDataDir(t *testing.T) {
	dir := t.TempDir()
	dataDir := filepath.Join(dir, "data")
	os.MkdirAll(dataDir, 0555) // Read-only
	defer os.Chmod(dataDir, 0755)

	pathDB := filepath.Join(dir, "test.db")
	repo, err := NewRepoOperation(pathDB)
	require.NoError(t, err)

	h := &Handler{
		repoOperation: repo,
		setting:       Setting{Secret: "test", Data: dataDir},
	}

	body := new(bytes.Buffer)
	writer := multipart.NewWriter(body)
	writer.WriteField("secret", "test")
	writer.WriteField("filename", "test_readonly.json")
	writer.WriteField("worldName", "altis")
	writer.WriteField("missionName", "Readonly Test")
	writer.WriteField("missionDuration", "100")
	part, _ := writer.CreateFormFile("file", "test_readonly.json")
	part.Write([]byte(`{"test": true}`))
	writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()

	h.StoreOperation(rec, req)
	assert.Equal(t, http.StatusInternalServerError, rec.Code)
}

func TestStoreOperation_DBStoreError(t *testing.T) {
	dir := t.TempDir()
	dataDir := filepath.Join(dir, "data")
	os.MkdirAll(dataDir, 0755)

	pathDB := filepath.Join(dir, "test.db")
	repo, err := NewRepoOperation(pathDB)
	require.NoError(t, err)
	repo.db.Close() // Close DB so Store fails

	h := &Handler{
		repoOperation: repo,
		setting:       Setting{Secret: "test", Data: dataDir},
	}

	body := new(bytes.Buffer)
	writer := multipart.NewWriter(body)
	writer.WriteField("secret", "test")
	writer.WriteField("filename", "test_dberr.json")
	writer.WriteField("worldName", "altis")
	writer.WriteField("missionName", "DB Error Test")
	writer.WriteField("missionDuration", "100")
	part, _ := writer.CreateFormFile("file", "test_dberr.json")
	part.Write([]byte(`{"test": true}`))
	writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()

	h.StoreOperation(rec, req)
	assert.Equal(t, http.StatusInternalServerError, rec.Code)
}

func TestGetData_ReadError(t *testing.T) {
	dir := t.TempDir()
	dataDir := filepath.Join(dir, "data")
	os.MkdirAll(dataDir, 0755)

	// Create a very short file that will fail io.ReadFull
	shortFile := filepath.Join(dataDir, "short.json.gz")
	os.WriteFile(shortFile, []byte{0x00}, 0644) // Only 1 byte, ReadFull needs 2

	h := &Handler{
		setting: Setting{Data: dataDir},
	}

	req := httptest.NewRequest(http.MethodGet, "/data/short.json.gz", nil)
	req.SetPathValue("path", "short.json.gz")
	rec := httptest.NewRecorder()

	h.GetData(rec, req)
	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestGetMarker_PathUnescape(t *testing.T) {
	dir := t.TempDir()
	markerDir := filepath.Join(dir, "markers")
	os.MkdirAll(markerDir, 0755)

	repoMarker, _ := NewRepoMarker(markerDir)
	h := &Handler{repoMarker: repoMarker}

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.SetPathValue("name", "%ZZinvalid")
	req.SetPathValue("color", "blufor")
	rec := httptest.NewRecorder()

	h.GetMarker(rec, req)
	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestGetAmmo_PathUnescape(t *testing.T) {
	dir := t.TempDir()
	ammoDir := filepath.Join(dir, "ammo")
	os.MkdirAll(ammoDir, 0755)

	repoAmmo, _ := NewRepoAmmo(ammoDir)
	h := &Handler{repoAmmo: repoAmmo}

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.SetPathValue("name", "%ZZinvalid")
	rec := httptest.NewRecorder()

	h.GetAmmo(rec, req)
	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestParamPath_UnescapeError(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.SetPathValue("path", "%ZZbad")

	_, err := paramPathFromRequest(req, "path")
	assert.Error(t, err)
}

func TestSpaFileServer_WithPrefix(t *testing.T) {
	testFS := fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("<html><head></head></html>")},
	}

	handler := spaFileServer(testFS, "/prefix")

	// Request with prefix — should inject prefix into base path
	req := httptest.NewRequest(http.MethodGet, "/prefix/some/route", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), `"/prefix"`)
}

func TestGetCustomize_Fields(t *testing.T) {
	h := &Handler{
		setting: Setting{
			Customize: Customize{
				Enabled:    true,
				WebsiteURL: "https://example.com",
			},
		},
	}

	mockCtx := fuego.NewMockContextNoBody()
	result, err := h.GetCustomize(mockCtx)
	assert.NoError(t, err)
	assert.Equal(t, "https://example.com", result.WebsiteURL)
}

// emptyFS is an fs.FS that always returns file not found
type emptyFS struct{}

func (emptyFS) Open(name string) (fs.File, error) {
	return nil, &fs.PathError{Op: "open", Path: name, Err: fs.ErrNotExist}
}

func TestGetData_NonGzipFile(t *testing.T) {
	dir := t.TempDir()
	dataDir := filepath.Join(dir, "data")
	require.NoError(t, os.MkdirAll(dataDir, 0755))

	// Create a regular (non-.json.gz) file in the data directory
	require.NoError(t, os.WriteFile(filepath.Join(dataDir, "somefile.pb"), []byte("protobuf data"), 0644))

	hdlr := Handler{setting: Setting{Data: dataDir}}

	req := httptest.NewRequest(http.MethodGet, "/data/somefile.pb", nil)
	req.SetPathValue("path", "somefile.pb")
	rec := httptest.NewRecorder()

	hdlr.GetData(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code)
	// Non-.json.gz files should NOT have Content-Encoding set
	assert.Empty(t, rec.Header().Get("Content-Encoding"))
}

func TestStoreOperation_PlainJSONUpload(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")
	dataDir := filepath.Join(dir, "data")
	require.NoError(t, os.MkdirAll(dataDir, 0755))

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

	// Create multipart form with PLAIN (non-gzipped) JSON data
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	writer.WriteField("secret", "test-secret")
	writer.WriteField("worldName", "altis")
	writer.WriteField("missionName", "Plain JSON Upload")
	writer.WriteField("missionDuration", "1800")
	writer.WriteField("filename", "plain_json_upload")
	writer.WriteField("tag", "coop")

	fileWriter, err := writer.CreateFormFile("file", "plain_json_upload.json")
	require.NoError(t, err)
	// Write raw JSON — first bytes are '{' (0x7b), not gzip magic (0x1f 0x8b)
	fileWriter.Write([]byte(`{"entities":[],"events":[]}`))
	writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/add", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()

	hdlr.StoreOperation(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code)

	// Verify the output file was created and is actually gzipped
	outPath := filepath.Join(dataDir, "plain_json_upload.json.gz")
	f, err := os.Open(outPath)
	require.NoError(t, err)
	defer f.Close()

	var magic [2]byte
	_, err = f.Read(magic[:])
	require.NoError(t, err)
	assert.Equal(t, byte(0x1f), magic[0], "output should start with gzip magic byte 1")
	assert.Equal(t, byte(0x8b), magic[1], "output should start with gzip magic byte 2")

	// Verify the gzipped content can be decompressed to the original JSON
	f.Seek(0, 0)
	gr, err := gzip.NewReader(f)
	require.NoError(t, err)
	defer gr.Close()
	var decompressed bytes.Buffer
	_, err = decompressed.ReadFrom(gr)
	require.NoError(t, err)
	assert.JSONEq(t, `{"entities":[],"events":[]}`, decompressed.String())
}

func TestGetWorlds(t *testing.T) {
	t.Run("returns worlds from maps directory", func(t *testing.T) {
		dir := t.TempDir()
		mapsDir := filepath.Join(dir, "maps")
		require.NoError(t, os.MkdirAll(filepath.Join(mapsDir, "altis"), 0755))
		require.NoError(t, os.MkdirAll(filepath.Join(mapsDir, "stratis"), 0755))
		require.NoError(t, os.WriteFile(
			filepath.Join(mapsDir, "altis", "meta.json"),
			[]byte(`{"displayName":"Altis"}`), 0644))

		hdlr := Handler{setting: Setting{Maps: mapsDir}}

		mockCtx := fuego.NewMockContextNoBody()
		result, err := hdlr.GetWorlds(mockCtx)
		assert.NoError(t, err)
		assert.Len(t, result, 2)

		lookup := make(map[string]string)
		for _, w := range result {
			lookup[w.Name] = w.DisplayName
		}
		assert.Equal(t, "Altis", lookup["altis"])
		assert.Equal(t, "stratis", lookup["stratis"])
	})

	t.Run("non-existent maps dir returns empty", func(t *testing.T) {
		hdlr := Handler{setting: Setting{Maps: "/tmp/nonexistent-maps-dir-99999"}}

		mockCtx := fuego.NewMockContextNoBody()
		result, err := hdlr.GetWorlds(mockCtx)
		assert.NoError(t, err)
		assert.Empty(t, result)
	})

	t.Run("error when maps path is a file", func(t *testing.T) {
		f, err := os.CreateTemp(t.TempDir(), "not-a-dir")
		require.NoError(t, err)
		f.Close()

		hdlr := Handler{setting: Setting{Maps: f.Name()}}

		mockCtx := fuego.NewMockContextNoBody()
		_, err = hdlr.GetWorlds(mockCtx)
		assert.Error(t, err)
	})
}

func TestStoreOperation_FocusFields(t *testing.T) {
	// storeHelper builds a multipart form with the given focus fields and
	// returns the HTTP response recorder.
	storeHelper := func(t *testing.T, focusStart, focusEnd string, setStart, setEnd bool) *httptest.ResponseRecorder {
		t.Helper()
		dir := t.TempDir()
		dataDir := filepath.Join(dir, "data")
		require.NoError(t, os.MkdirAll(dataDir, 0755))

		repo, err := NewRepoOperation(filepath.Join(dir, "test.db"))
		require.NoError(t, err)
		defer repo.db.Close()

		hdlr := Handler{
			repoOperation: repo,
			setting: Setting{
				Secret: "test-secret",
				Data:   dataDir,
			},
		}

		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		writer.WriteField("secret", "test-secret")
		writer.WriteField("worldName", "altis")
		writer.WriteField("missionName", "Focus Test")
		writer.WriteField("missionDuration", "3600")
		writer.WriteField("filename", "focus_test")
		writer.WriteField("tag", "coop")
		if setStart {
			writer.WriteField("focusStart", focusStart)
		}
		if setEnd {
			writer.WriteField("focusEnd", focusEnd)
		}

		fileWriter, err := writer.CreateFormFile("file", "focus_test.json.gz")
		require.NoError(t, err)
		gw := gzip.NewWriter(fileWriter)
		gw.Write([]byte(`{"test":"focus"}`))
		gw.Close()
		writer.Close()

		req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/add", body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		rec := httptest.NewRecorder()

		hdlr.StoreOperation(rec, req)
		return rec
	}

	t.Run("invalid focusStart non-numeric", func(t *testing.T) {
		rec := storeHelper(t, "abc", "100", true, true)
		assert.Equal(t, http.StatusBadRequest, rec.Code)
	})

	t.Run("invalid focusEnd non-numeric", func(t *testing.T) {
		rec := storeHelper(t, "10", "xyz", true, true)
		assert.Equal(t, http.StatusBadRequest, rec.Code)
	})

	t.Run("focusStart present but focusEnd absent", func(t *testing.T) {
		rec := storeHelper(t, "10", "", true, false)
		assert.Equal(t, http.StatusBadRequest, rec.Code)
	})

	t.Run("focusStart >= focusEnd", func(t *testing.T) {
		rec := storeHelper(t, "100", "100", true, true)
		assert.Equal(t, http.StatusBadRequest, rec.Code)
	})

	t.Run("focusStart > focusEnd", func(t *testing.T) {
		rec := storeHelper(t, "200", "100", true, true)
		assert.Equal(t, http.StatusBadRequest, rec.Code)
	})

	t.Run("valid focus range", func(t *testing.T) {
		rec := storeHelper(t, "10", "100", true, true)
		assert.Equal(t, http.StatusOK, rec.Code)
	})
}

func TestGetSprite_InitError(t *testing.T) {
	h := &Handler{spriteInitErr: fmt.Errorf("test sprite error")}
	h.spriteOnce.Do(func() {}) // mark Once as done so it won't re-run

	req := httptest.NewRequest(http.MethodGet, "/images/maps/sprites/sprite.json", nil)
	req.SetPathValue("name", "sprite.json")
	rec := httptest.NewRecorder()

	h.GetSprite(rec, req)
	assert.Equal(t, http.StatusInternalServerError, rec.Code)
	assert.Contains(t, rec.Body.String(), "generate sprites")
}

func TestStoreOperation_GzippedCopyError(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")
	dataDir := filepath.Join(dir, "data")
	require.NoError(t, os.MkdirAll(dataDir, 0755))

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

	// Create multipart form with already-gzipped data
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	writer.WriteField("secret", "test-secret")
	writer.WriteField("worldName", "altis")
	writer.WriteField("missionName", "Gzipped Upload")
	writer.WriteField("missionDuration", "1800")
	writer.WriteField("filename", "gzipped_test")
	writer.WriteField("tag", "coop")

	fileWriter, err := writer.CreateFormFile("file", "gzipped_test.json.gz")
	require.NoError(t, err)
	gw := gzip.NewWriter(fileWriter)
	gw.Write([]byte(`{"entities":[]}`))
	gw.Close()
	writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/add", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()

	hdlr.StoreOperation(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code)

	// Verify the file was written as-is (already gzipped)
	outPath := filepath.Join(dataDir, "gzipped_test.json.gz")
	f, err := os.Open(outPath)
	require.NoError(t, err)
	defer f.Close()

	var magic [2]byte
	_, err = f.Read(magic[:])
	require.NoError(t, err)
	assert.Equal(t, byte(0x1f), magic[0])
	assert.Equal(t, byte(0x8b), magic[1])
}

func TestStoreOperation_EmptyFile(t *testing.T) {
	// Covers L350-352: br.Peek(2) fails on empty file
	dir := t.TempDir()
	dataDir := filepath.Join(dir, "data")
	require.NoError(t, os.MkdirAll(dataDir, 0755))
	repo, err := NewRepoOperation(filepath.Join(dir, "test.db"))
	require.NoError(t, err)
	defer repo.db.Close()

	h := &Handler{
		repoOperation: repo,
		setting:       Setting{Secret: "s", Data: dataDir},
	}

	body := new(bytes.Buffer)
	w := multipart.NewWriter(body)
	w.WriteField("secret", "s")
	w.WriteField("worldName", "altis")
	w.WriteField("missionName", "Empty")
	w.WriteField("missionDuration", "100")
	w.WriteField("filename", "empty_test")
	part, _ := w.CreateFormFile("file", "empty.json")
	_ = part // write nothing
	w.Close()

	req := httptest.NewRequest(http.MethodPost, "/", body)
	req.Header.Set("Content-Type", w.FormDataContentType())
	rec := httptest.NewRecorder()
	h.StoreOperation(rec, req)
	assert.Equal(t, http.StatusInternalServerError, rec.Code)
}

