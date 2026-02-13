package server

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

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
	defer gw.Close()

	_, err = gw.Write(data)
	return err
}

func TestGetOperations(t *testing.T) {
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
	defer repo.db.Close()
	repoMarker, _ := NewRepoMarker(filepath.Join(dir, "markers"))
	repoAmmo, _ := NewRepoAmmo(filepath.Join(dir, "ammo"))

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
	defer repo.db.Close()
	repoMarker, _ := NewRepoMarker(filepath.Join(dir, "markers"))
	repoAmmo, _ := NewRepoAmmo(filepath.Join(dir, "ammo"))

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
