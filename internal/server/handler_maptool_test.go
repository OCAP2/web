package server

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/OCAP2/web/internal/maptool"
	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// noopPipeline returns a Pipeline with a single stage that does nothing.
func noopPipeline() *maptool.Pipeline {
	return maptool.NewPipeline([]maptool.Stage{
		{Name: "noop", Run: func(ctx context.Context, job *maptool.Job) error { return nil }},
	})
}

// setupMaptoolTest creates a Handler with a real JobManager (noop pipeline) and
// a temp maps directory. The JobManager is started in the background and
// cleaned up when the test finishes.
func setupMaptoolTest(t *testing.T) (*Handler, string) {
	t.Helper()
	mapsDir := t.TempDir()

	jm := maptool.NewJobManager(mapsDir, noopPipeline)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	go jm.Start(ctx)

	tools := maptool.ToolSet{
		{Name: "pmtiles", Required: true, Found: true, Path: "/usr/bin/pmtiles"},
		{Name: "tippecanoe", Required: true, Found: false},
	}

	hdlr := &Handler{
		maptoolMgr: jm,
		maptoolCfg: &maptoolConfig{tools: tools, mapsDir: mapsDir},
	}
	return hdlr, mapsDir
}

func TestGetMapToolTools(t *testing.T) {
	hdlr, _ := setupMaptoolTest(t)

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := hdlr.getMapToolTools(c)
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, rec.Code)

	var tools maptool.ToolSet
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &tools))
	assert.Len(t, tools, 2)
	assert.Equal(t, "pmtiles", tools[0].Name)
	assert.True(t, tools[0].Found)
	assert.Equal(t, "tippecanoe", tools[1].Name)
	assert.False(t, tools[1].Found)
}

func TestGetMapToolMaps_Empty(t *testing.T) {
	hdlr, _ := setupMaptoolTest(t)

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := hdlr.getMapToolMaps(c)
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, rec.Code)

	// Empty maps dir returns null JSON (nil slice)
	assert.Equal(t, "null", jsonTrimmed(rec))
}

func TestGetMapToolMaps_WithMaps(t *testing.T) {
	hdlr, mapsDir := setupMaptoolTest(t)

	// Create two map directories
	require.NoError(t, os.Mkdir(filepath.Join(mapsDir, "altis"), 0755))
	require.NoError(t, os.Mkdir(filepath.Join(mapsDir, "tanoa"), 0755))

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := hdlr.getMapToolMaps(c)
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, rec.Code)

	var maps []maptool.MapInfo
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &maps))
	assert.Len(t, maps, 2)

	// Collect names (order may vary by OS)
	names := make(map[string]bool)
	for _, m := range maps {
		names[m.Name] = true
	}
	assert.True(t, names["altis"])
	assert.True(t, names["tanoa"])
}

func TestDeleteMapToolMap(t *testing.T) {
	hdlr, mapsDir := setupMaptoolTest(t)

	// Create a map directory with a file inside
	mapDir := filepath.Join(mapsDir, "altis")
	require.NoError(t, os.MkdirAll(filepath.Join(mapDir, "tiles"), 0755))
	require.NoError(t, os.WriteFile(filepath.Join(mapDir, "map.json"), []byte("{}"), 0644))

	e := echo.New()
	req := httptest.NewRequest(http.MethodDelete, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("name")
	c.SetParamValues("altis")

	err := hdlr.deleteMapToolMap(c)
	require.NoError(t, err)
	assert.Equal(t, http.StatusNoContent, rec.Code)

	// Directory should be gone
	assert.NoDirExists(t, mapDir)
}

func TestDeleteMapToolMap_PathTraversal(t *testing.T) {
	hdlr, _ := setupMaptoolTest(t)

	tests := []struct {
		name  string
		param string
	}{
		{"dot-dot-slash", "../something"},
		{"dot-dot-only", ".."},
		{"nested-traversal", "foo/../../etc"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			e := echo.New()
			req := httptest.NewRequest(http.MethodDelete, "/", nil)
			rec := httptest.NewRecorder()
			c := e.NewContext(req, rec)
			c.SetParamNames("name")
			c.SetParamValues(tt.param)

			err := hdlr.deleteMapToolMap(c)
			require.NoError(t, err) // handler writes JSON error, doesn't return Go error
			assert.Equal(t, http.StatusBadRequest, rec.Code)

			var body map[string]string
			require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
			assert.Contains(t, body["error"], "invalid map name")
		})
	}
}

func TestDeleteMapToolMap_EmptyName(t *testing.T) {
	hdlr, _ := setupMaptoolTest(t)

	e := echo.New()
	req := httptest.NewRequest(http.MethodDelete, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("name")
	c.SetParamValues("")

	err := hdlr.deleteMapToolMap(c)
	require.NoError(t, err)
	assert.Equal(t, http.StatusBadRequest, rec.Code)

	var body map[string]string
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Contains(t, body["error"], "invalid map name")
}

func TestGetMapToolJobs_Empty(t *testing.T) {
	hdlr, _ := setupMaptoolTest(t)

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := hdlr.getMapToolJobs(c)
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, rec.Code)

	var jobs []maptool.JobInfo
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &jobs))
	assert.Empty(t, jobs)
}

func TestGetMapToolJobs_WithJobs(t *testing.T) {
	hdlr, _ := setupMaptoolTest(t)

	// Submit a job so there's something to list
	_, err := hdlr.maptoolMgr.Submit("/tmp/test", "testworld")
	require.NoError(t, err)

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err = hdlr.getMapToolJobs(c)
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, rec.Code)

	var jobs []maptool.JobInfo
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &jobs))
	assert.NotEmpty(t, jobs)
	assert.Equal(t, "testworld", jobs[0].WorldName)
}

func TestCancelMapToolJob_NotFound(t *testing.T) {
	hdlr, _ := setupMaptoolTest(t)

	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues("nonexistent-job-id")

	err := hdlr.cancelMapToolJob(c)
	require.NoError(t, err) // handler writes JSON error, doesn't return Go error
	assert.Equal(t, http.StatusBadRequest, rec.Code)

	var body map[string]string
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Contains(t, body["error"], "not found")
}

func TestImportMapToolZip_NotZip(t *testing.T) {
	hdlr, _ := setupMaptoolTest(t)

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("file", "test.txt")
	require.NoError(t, err)
	_, err = part.Write([]byte("not a zip"))
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err = hdlr.importMapToolZip(c)
	require.NoError(t, err)
	assert.Equal(t, http.StatusBadRequest, rec.Code)

	var respBody map[string]string
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &respBody))
	assert.Contains(t, respBody["error"], ".zip")
}

func TestImportMapToolZip_MissingFile(t *testing.T) {
	hdlr, _ := setupMaptoolTest(t)

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	// Write some other field, not "file"
	require.NoError(t, writer.WriteField("other", "value"))
	require.NoError(t, writer.Close())

	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := hdlr.importMapToolZip(c)
	require.NoError(t, err)
	assert.Equal(t, http.StatusBadRequest, rec.Code)

	var respBody map[string]string
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &respBody))
	assert.Contains(t, respBody["error"], "file field is required")
}

func TestRestyleMapToolAll_NoMaps(t *testing.T) {
	hdlr, _ := setupMaptoolTest(t)

	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := hdlr.restyleMapToolAll(c)
	require.NoError(t, err)
	assert.Equal(t, http.StatusBadRequest, rec.Code)

	var respBody map[string]string
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &respBody))
	assert.Contains(t, respBody["error"], "no maps found")
}

func TestRestyleMapToolAll_WithMaps(t *testing.T) {
	hdlr, mapsDir := setupMaptoolTest(t)

	// Create map directories with minimal files so ScanMaps finds them
	altisDir := filepath.Join(mapsDir, "altis")
	require.NoError(t, os.MkdirAll(altisDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(altisDir, "map.json"), []byte("{}"), 0644))

	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := hdlr.restyleMapToolAll(c)
	require.NoError(t, err)
	assert.Equal(t, http.StatusAccepted, rec.Code)

	var snap maptool.JobInfo
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &snap))
	assert.Equal(t, "restyle-all", snap.WorldName)
	assert.Equal(t, "pending", snap.Status)
}

func TestCancelMapToolJob_RunningJob(t *testing.T) {
	hdlr, _ := setupMaptoolTest(t)

	// Submit a long-running job via SubmitFunc
	started := make(chan struct{})
	snap, err := hdlr.maptoolMgr.SubmitFunc("cancel-test", "testworld", func(ctx context.Context, job *maptool.Job) error {
		close(started)
		<-ctx.Done()
		return ctx.Err()
	})
	require.NoError(t, err)

	// Wait for the job to actually start running
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for job to start")
	}

	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("id")
	c.SetParamValues(snap.ID)

	err = hdlr.cancelMapToolJob(c)
	require.NoError(t, err)
	assert.Equal(t, http.StatusNoContent, rec.Code)
}

// jsonTrimmed returns the recorder body with trailing whitespace removed.
func jsonTrimmed(rec *httptest.ResponseRecorder) string {
	s := rec.Body.String()
	// Echo's JSON encoder appends a trailing newline
	if len(s) > 0 && s[len(s)-1] == '\n' {
		s = s[:len(s)-1]
	}
	return s
}
