package server

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
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
	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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
	})

	t.Run("disabled", func(t *testing.T) {
		hdlr := Handler{
			setting: Setting{
				Customize: Customize{
					Enabled: false,
				},
			},
		}

		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/customize", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)

		err := hdlr.GetCustomize(c)
		assert.NoError(t, err)
		assert.Equal(t, http.StatusNoContent, rec.Code)
		assert.Empty(t, rec.Body.Bytes())
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
		require.NoError(t, writer.WriteField("secret", "wrong-secret"))
		require.NoError(t, writer.Close())

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
		require.NoError(t, writer.WriteField("secret", "test-secret"))
		require.NoError(t, writer.WriteField("missionDuration", "not-a-number"))
		require.NoError(t, writer.Close())

		e := echo.New()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/add", body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)

		err := hdlr.StoreOperation(c)
		assert.Error(t, err)
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
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/data/test_capture.json.gz", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetParamNames("*")
		c.SetParamValues("test_capture.json.gz")

		err := hdlr.GetData(c)
		assert.NoError(t, err)
		assert.Equal(t, "gzip", rec.Header().Get("Content-Encoding"))
		assert.Equal(t, "application/json", rec.Header().Get("Content-Type"))
	})

	t.Run("serve protobuf manifest", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/data/test_mission/manifest.pb", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetParamNames("*")
		c.SetParamValues("test_mission/manifest.pb")

		err := hdlr.GetData(c)
		assert.NoError(t, err)
		assert.Equal(t, http.StatusOK, rec.Code)
		assert.Equal(t, "fake protobuf", rec.Body.String())
	})

	t.Run("serve protobuf chunk", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/data/test_mission/chunks/0000.pb", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetParamNames("*")
		c.SetParamValues("test_mission/chunks/0000.pb")

		err := hdlr.GetData(c)
		assert.NoError(t, err)
		assert.Equal(t, http.StatusOK, rec.Code)
		assert.Equal(t, "fake chunk", rec.Body.String())
	})

	t.Run("nonexistent file", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/data/nonexistent.json.gz", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetParamNames("*")
		c.SetParamValues("nonexistent.json.gz")

		err := hdlr.GetData(c)
		assert.Equal(t, echo.ErrNotFound, err)
	})

	t.Run("path traversal blocked", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/data/../../../etc/passwd", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetParamNames("*")
		c.SetParamValues("../../../etc/passwd")

		err := hdlr.GetData(c)
		assert.Error(t, err)
	})

	t.Run("non-gz file has no gzip headers", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/data/test_mission/manifest.pb", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetParamNames("*")
		c.SetParamValues("test_mission/manifest.pb")

		err := hdlr.GetData(c)
		assert.NoError(t, err)
		assert.Empty(t, rec.Header().Get("Content-Encoding"))
	})
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

	e := echo.New()
	NewHandler(e, repo, repoMarker, repoAmmo, Setting{}, WithStaticFS(os.DirFS(staticDir)))

	t.Run("get static file", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/assets/app.js", nil)
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusOK, rec.Code)
		assert.Contains(t, rec.Body.String(), "// test")
	})

	t.Run("root path serves index.html", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusOK, rec.Code)
		assert.Contains(t, rec.Body.String(), "<html>test</html>")
	})

	t.Run("SPA fallback serves index.html for unknown paths", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/some/spa/route", nil)
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusOK, rec.Code)
		assert.Contains(t, rec.Body.String(), "<html>test</html>")
	})

	t.Run("path traversal returns SPA fallback", func(t *testing.T) {
		// Go's net/http cleans the path before serving, so traversal attempts
		// are safely normalized. The SPA fallback then serves index.html.
		req := httptest.NewRequest(http.MethodGet, "/../../../etc/passwd", nil)
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)
		// Should get index.html (SPA fallback), not the actual file
		assert.Contains(t, rec.Body.String(), "<html>test</html>")
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

	e := echo.New()
	NewHandler(e, repo, repoMarker, repoAmmo, Setting{PrefixURL: "/sub/"}, WithStaticFS(os.DirFS(staticDir)))

	t.Run("static file under prefix", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/sub/assets/app.js", nil)
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusOK, rec.Code)
		assert.Contains(t, rec.Body.String(), "// prefixed")
	})

	t.Run("SPA fallback under prefix", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/sub/some/spa/route", nil)
		rec := httptest.NewRecorder()
		e.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusOK, rec.Code)
		assert.Contains(t, rec.Body.String(), "<html>prefixed</html>")
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

	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/add", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err = hdlr.StoreOperation(c)
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, rec.Code)

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

	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/add", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err = hdlr.StoreOperation(c)
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, rec.Code)

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

	e := echo.New()

	// Should not panic
	NewHandler(e, repo, repoMarker, repoAmmo, setting, WithStaticFS(os.DirFS(dir)))

	// Verify routes are registered
	routes := e.Routes()
	assert.NotEmpty(t, routes)

	// Check for expected routes
	routePaths := make([]string, len(routes))
	for i, r := range routes {
		routePaths[i] = r.Path
	}
	assert.Contains(t, routePaths, "/sub/api/v1/operations")
	assert.Contains(t, routePaths, "/sub/api/v1/operations/add")
	assert.Contains(t, routePaths, "/sub/api/version")
	assert.Contains(t, routePaths, "/sub/data/*")
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
	e := echo.New()

	// Should apply options
	NewHandler(e, repo, repoMarker, repoAmmo, setting, WithConversionTrigger(trigger), WithStaticFS(os.DirFS(dir)))

	// Routes should still be registered
	assert.NotEmpty(t, e.Routes())
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

	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/add", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err = hdlr.StoreOperation(c)
	assert.Error(t, err)
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

		e := echo.New()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/add", body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)

		err = hdlr.StoreOperation(c)
		assert.NoError(t, err)
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

		e := echo.New()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/add", body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		req.Header.Set("Authorization", "Bearer invalid-token")
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)

		err := hdlr.StoreOperation(c)
		assert.Equal(t, echo.ErrForbidden, err)
	})

	t.Run("no secret and no token fails", func(t *testing.T) {
		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		require.NoError(t, writer.WriteField("worldName", "altis"))
		require.NoError(t, writer.WriteField("missionName", "No Auth Test"))
		require.NoError(t, writer.WriteField("missionDuration", "3600"))
		require.NoError(t, writer.WriteField("filename", "no_auth_test"))
		require.NoError(t, writer.Close())

		e := echo.New()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/add", body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)

		err := hdlr.StoreOperation(c)
		assert.Equal(t, echo.ErrForbidden, err)
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

	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/add", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err = hdlr.StoreOperation(c)
	assert.Equal(t, echo.ErrForbidden, err)
}

func TestGetHealthcheck(t *testing.T) {
	hdlr := Handler{}
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/healthcheck", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := hdlr.GetHealthcheck(c)
	assert.NoError(t, err)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), `"status":"ok"`)
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
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/operations/1", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetParamNames("id")
		c.SetParamValues("1")

		err := hdlr.GetOperation(c)
		assert.NoError(t, err)
		assert.Equal(t, http.StatusOK, rec.Code)

		var result Operation
		err = json.Unmarshal(rec.Body.Bytes(), &result)
		assert.NoError(t, err)
		assert.Equal(t, "Mission Alpha", result.MissionName)
	})

	t.Run("found by filename", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/operations/mission_alpha", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetParamNames("id")
		c.SetParamValues("mission_alpha")

		err := hdlr.GetOperation(c)
		assert.NoError(t, err)
		assert.Equal(t, http.StatusOK, rec.Code)

		var result Operation
		err = json.Unmarshal(rec.Body.Bytes(), &result)
		assert.NoError(t, err)
		assert.Equal(t, "Mission Alpha", result.MissionName)
	})

	t.Run("not found", func(t *testing.T) {
		e := echo.New()
		req := httptest.NewRequest(http.MethodGet, "/api/v1/operations/999", nil)
		rec := httptest.NewRecorder()
		c := e.NewContext(req, rec)
		c.SetParamNames("id")
		c.SetParamValues("999")

		err := hdlr.GetOperation(c)
		assert.Equal(t, echo.ErrNotFound, err)
	})
}

func TestGetFont(t *testing.T) {
	dir := t.TempDir()
	fontsDir := filepath.Join(dir, "fonts")
	fontStack := filepath.Join(fontsDir, "Open Sans Regular")
	require.NoError(t, os.MkdirAll(fontStack, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(fontStack, "0-255.pbf"), []byte("fake font"), 0644))

	hdlr := Handler{setting: Setting{Fonts: fontsDir}}

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/images/maps/fonts/Open%20Sans%20Regular/0-255.pbf", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("fontstack", "range")
	c.SetParamValues("Open Sans Regular", "0-255.pbf")

	err := hdlr.GetFont(c)
	assert.NoError(t, err)
	assert.Equal(t, http.StatusOK, rec.Code)
}

func TestGetSprite(t *testing.T) {
	hdlr := Handler{}

	e := echo.New()

	tests := []struct {
		name        string
		wantStatus  int
		wantType    string
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
			rec := httptest.NewRecorder()
			c := e.NewContext(req, rec)
			c.SetParamNames("name")
			c.SetParamValues(tt.name)

			err := hdlr.GetSprite(c)
			if tt.wantStatus == http.StatusNotFound {
				assert.Error(t, err)
			} else {
				assert.NoError(t, err)
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

	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/add", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err = hdlr.StoreOperation(c)
	assert.NoError(t, err)
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

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/data/legacy.json.gz", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("*")
	c.SetParamValues("legacy.json.gz")

	err := hdlr.GetData(c)
	assert.NoError(t, err)
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

	e := echo.New()
	NewHandler(e, repo, repoMarker, repoAmmo, Setting{
		Data: filepath.Join(dir, "data"),
		Maps: filepath.Join(dir, "maps"),
	}, WithMapTool(jm, tools, filepath.Join(dir, "maps")))

	// Verify maptool routes were registered
	routes := e.Routes()
	routePaths := make([]string, len(routes))
	for i, r := range routes {
		routePaths[i] = r.Path
	}
	assert.Contains(t, routePaths, "/api/v1/maptool/tools")
	assert.Contains(t, routePaths, "/api/v1/maptool/maps")
	assert.Contains(t, routePaths, "/api/v1/maptool/jobs")
}

func TestGetData_NonexistentNonGz(t *testing.T) {
	dir := t.TempDir()
	hdlr := Handler{setting: Setting{Data: dir}}

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/data/missing.pb", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("*")
	c.SetParamValues("missing.pb")

	err := hdlr.GetData(c)
	assert.Equal(t, echo.ErrNotFound, err)
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

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/operations?name=Alpha&tag=coop", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err = hdlr.GetOperations(c)
	assert.NoError(t, err)
	assert.Equal(t, http.StatusOK, rec.Code)

	var ops []Operation
	err = json.Unmarshal(rec.Body.Bytes(), &ops)
	require.NoError(t, err)
	assert.Len(t, ops, 1)
	assert.Equal(t, "Mission Alpha", ops[0].MissionName)
	assert.Equal(t, "coop", ops[0].Tag)
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

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/operations?older=2026-01-15&newer=2026-01-01", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err = hdlr.GetOperations(c)
	assert.NoError(t, err)
	assert.Equal(t, http.StatusOK, rec.Code)

	var ops []Operation
	err = json.Unmarshal(rec.Body.Bytes(), &ops)
	require.NoError(t, err)
	assert.Len(t, ops, 1)
	assert.Equal(t, "Mid", ops[0].MissionName)
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

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/customize", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := hdlr.GetCustomize(c)
	assert.NoError(t, err)
	assert.Equal(t, http.StatusOK, rec.Code)

	var result Customize
	err = json.Unmarshal(rec.Body.Bytes(), &result)
	require.NoError(t, err)
	assert.True(t, result.Enabled)
	assert.Equal(t, "https://example.com", result.WebsiteURL)
}

func TestGetCustomize_Disabled(t *testing.T) {
	hdlr := Handler{
		setting: Setting{
			Customize: Customize{Enabled: false},
		},
	}

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/customize", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := hdlr.GetCustomize(c)
	assert.NoError(t, err)
	assert.Equal(t, http.StatusNoContent, rec.Code)
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

	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/add", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err = hdlr.StoreOperation(c)
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, rec.Code)

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

	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/add", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err = hdlr.StoreOperation(c)
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, rec.Code)

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

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/images/markers/%23test/blufor", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("name", "color")
	c.SetParamValues("%23test", "blufor")

	err = hdlr.GetMarker(c)
	assert.NoError(t, err)
	assert.Equal(t, http.StatusOK, rec.Code)
}

func TestGetAmmo_NotFound(t *testing.T) {
	dir := t.TempDir()
	ammoDir := filepath.Join(dir, "ammo")
	require.NoError(t, os.MkdirAll(ammoDir, 0755))

	repoAmmo, err := NewRepoAmmo(ammoDir)
	require.NoError(t, err)

	hdlr := Handler{repoAmmo: repoAmmo}

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/images/markers/magicons/nonexistent", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("name")
	c.SetParamValues("nonexistent")

	err = hdlr.GetAmmo(c)
	assert.ErrorIs(t, err, ErrNotFound)
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

	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err = h.StoreOperation(c)
	assert.NoError(t, err)
	assert.Equal(t, http.StatusOK, rec.Code)
}

func TestGetOperations_BindError(t *testing.T) {
	dir := t.TempDir()
	repo, err := NewRepoOperation(filepath.Join(dir, "test.db"))
	require.NoError(t, err)

	h := &Handler{repoOperation: repo}

	// Test the Select error path using closed DB
	repo.db.Close()
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err = h.GetOperations(c)
	assert.Error(t, err) // Should return the DB error
}

func TestEditOperation_DBUpdateError(t *testing.T) {
	dir := t.TempDir()
	repo, err := NewRepoOperation(filepath.Join(dir, "test.db"))
	require.NoError(t, err)

	ctx := context.Background()
	op := &Operation{
		WorldName: "altis", MissionName: "Test",
		MissionDuration: 300, Filename: "test_edit",
		Date: "2026-01-01", Tag: "coop",
	}
	require.NoError(t, repo.Store(ctx, op))

	jwt := NewJWTManager("secret", time.Hour)
	token, _ := jwt.Create("")
	h := &Handler{repoOperation: repo, jwt: jwt}

	// Close DB after storing the operation - GetByID will fail
	repo.db.Close()

	e := echo.New()
	body := `{"missionName":"Updated"}`
	req := httptest.NewRequest(http.MethodPut, "/", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(fmt.Sprintf("%d", op.ID))

	err = h.EditOperation(c)
	// Should be echo.ErrNotFound since GetByID fails
	assert.Error(t, err)
}

func TestRetryConversion_DBError(t *testing.T) {
	dir := t.TempDir()
	repo, err := NewRepoOperation(filepath.Join(dir, "test.db"))
	require.NoError(t, err)

	ctx := context.Background()
	op := &Operation{
		WorldName: "altis", MissionName: "Test",
		MissionDuration: 300, Filename: "test_retry",
		Date: "2026-01-01", Tag: "coop",
	}
	require.NoError(t, repo.Store(ctx, op))
	// Set to failed so we can retry
	require.NoError(t, repo.UpdateConversionStatus(ctx, op.ID, ConversionStatusFailed))

	jwt := NewJWTManager("secret", time.Hour)
	token, _ := jwt.Create("")
	h := &Handler{repoOperation: repo, setting: Setting{Data: dir}, jwt: jwt}

	// Close DB - GetByID in RetryConversion will fail
	repo.db.Close()

	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(fmt.Sprintf("%d", op.ID))

	err = h.RetryConversion(c)
	assert.Error(t, err)
}

func TestDeleteOperation_DBError(t *testing.T) {
	dir := t.TempDir()
	repo, err := NewRepoOperation(filepath.Join(dir, "test.db"))
	require.NoError(t, err)

	ctx := context.Background()
	op := &Operation{
		WorldName: "altis", MissionName: "Test",
		MissionDuration: 300, Filename: "test_delete",
		Date: "2026-01-01", Tag: "coop",
	}
	require.NoError(t, repo.Store(ctx, op))
	repo.db.Close()

	jwt := NewJWTManager("secret", time.Hour)
	token, _ := jwt.Create("")
	h := &Handler{repoOperation: repo, jwt: jwt}

	e := echo.New()
	req := httptest.NewRequest(http.MethodDelete, "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(fmt.Sprintf("%d", op.ID))

	err = h.DeleteOperation(c)
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

	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err = h.StoreOperation(c)
	assert.Error(t, err) // os.Create should fail on read-only dir
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

	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err = h.StoreOperation(c)
	assert.Error(t, err) // repo.Store should fail
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

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/data/short.json.gz", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("*")
	c.SetParamValues("short.json.gz")

	err := h.GetData(c)
	assert.Error(t, err) // io.ReadFull fails with only 1 byte
}

func TestGetMarker_PathUnescape(t *testing.T) {
	dir := t.TempDir()
	markerDir := filepath.Join(dir, "markers")
	os.MkdirAll(markerDir, 0755)

	repoMarker, _ := NewRepoMarker(markerDir)
	h := &Handler{repoMarker: repoMarker}

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("name", "color")
	// Use invalid percent-encoding to trigger PathUnescape error
	c.SetParamValues("%ZZinvalid", "blufor")

	err := h.GetMarker(c)
	assert.Error(t, err)
}

func TestGetAmmo_PathUnescape(t *testing.T) {
	dir := t.TempDir()
	ammoDir := filepath.Join(dir, "ammo")
	os.MkdirAll(ammoDir, 0755)

	repoAmmo, _ := NewRepoAmmo(ammoDir)
	h := &Handler{repoAmmo: repoAmmo}

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("name")
	c.SetParamValues("%ZZinvalid")

	err := h.GetAmmo(c)
	assert.Error(t, err)
}

func TestParamPath_UnescapeError(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("*")
	c.SetParamValues("%ZZbad")

	_, err := paramPath(c, "*")
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

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := h.GetCustomize(c)
	assert.NoError(t, err)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), "example.com")
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

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/data/somefile.pb", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("*")
	c.SetParamValues("somefile.pb")

	err := hdlr.GetData(c)
	assert.NoError(t, err)
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

	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/add", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err = hdlr.StoreOperation(c)
	assert.NoError(t, err)
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

	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/add", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err = hdlr.StoreOperation(c)
	assert.NoError(t, err)
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

func TestStoreOperation_ReadOnlyOutputDir(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")
	dataDir := filepath.Join(dir, "data")
	require.NoError(t, os.MkdirAll(dataDir, 0755))

	repo, err := NewRepoOperation(pathDB)
	require.NoError(t, err)
	defer repo.db.Close()

	// Make data dir read-only so os.Create fails
	require.NoError(t, os.Chmod(dataDir, 0555))
	defer os.Chmod(dataDir, 0755)

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
	writer.WriteField("missionName", "ReadOnly Dir Test")
	writer.WriteField("missionDuration", "1800")
	writer.WriteField("filename", "readonly_test")
	writer.WriteField("tag", "coop")

	fileWriter, err := writer.CreateFormFile("file", "readonly_test.json")
	require.NoError(t, err)
	fileWriter.Write([]byte(`{"test":"data"}`))
	writer.Close()

	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/operations/add", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err = hdlr.StoreOperation(c)
	assert.Error(t, err) // os.Create should fail on read-only dir
}
