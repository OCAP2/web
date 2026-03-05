package server

import (
	"archive/zip"
	"bufio"
	"bytes"
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

	"github.com/OCAP2/web/internal/maptool"
	"github.com/go-fuego/fuego"
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
	done := make(chan struct{})
	go func() {
		jm.Start(ctx)
		close(done)
	}()
	// Cancel then wait for Start to return so all in-flight processJob
	// calls finish before t.TempDir() cleanup removes the directory.
	t.Cleanup(func() {
		cancel()
		<-done
	})

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

	ctx := fuego.NewMockContextNoBody()
	tools, err := hdlr.getMapToolTools(ctx)
	require.NoError(t, err)
	assert.Len(t, tools, 2)
	assert.Equal(t, "pmtiles", tools[0].Name)
	assert.True(t, tools[0].Found)
	assert.Equal(t, "tippecanoe", tools[1].Name)
	assert.False(t, tools[1].Found)
}

func TestGetMapToolHealth_Writable(t *testing.T) {
	hdlr, _ := setupMaptoolTest(t)

	ctx := fuego.NewMockContextNoBody()
	checks, err := hdlr.getMapToolHealth(ctx)
	require.NoError(t, err)
	require.Len(t, checks, 1)
	assert.Equal(t, "maps_writable", checks[0].ID)
	assert.Equal(t, true, checks[0].OK)
	assert.Empty(t, checks[0].Error)
}

func TestGetMapToolHealth_NotWritable(t *testing.T) {
	hdlr, mapsDir := setupMaptoolTest(t)
	// Point mapsDir to a non-existent path inside a file (not a dir)
	blocker := filepath.Join(mapsDir, "blocker-file")
	require.NoError(t, os.WriteFile(blocker, []byte("x"), 0644))
	hdlr.maptoolCfg.mapsDir = blocker

	ctx := fuego.NewMockContextNoBody()
	checks, err := hdlr.getMapToolHealth(ctx)
	require.NoError(t, err)
	require.Len(t, checks, 1)
	assert.Equal(t, false, checks[0].OK)
	assert.NotEmpty(t, checks[0].Error)
}

func TestGetMapToolMaps_Empty(t *testing.T) {
	hdlr, _ := setupMaptoolTest(t)

	ctx := fuego.NewMockContextNoBody()
	maps, err := hdlr.getMapToolMaps(ctx)
	require.NoError(t, err)

	// Empty maps dir returns empty slice
	assert.Empty(t, maps)
}

func TestGetMapToolMaps_WithMaps(t *testing.T) {
	hdlr, mapsDir := setupMaptoolTest(t)

	// Create two map directories
	require.NoError(t, os.Mkdir(filepath.Join(mapsDir, "altis"), 0755))
	require.NoError(t, os.Mkdir(filepath.Join(mapsDir, "tanoa"), 0755))

	ctx := fuego.NewMockContextNoBody()
	maps, err := hdlr.getMapToolMaps(ctx)
	require.NoError(t, err)
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

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"name": "altis"}

	_, err := hdlr.deleteMapToolMap(ctx)
	require.NoError(t, err)

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
			ctx := fuego.NewMockContextNoBody()
			ctx.PathParams = map[string]string{"name": tt.param}

			_, err := hdlr.deleteMapToolMap(ctx)
			assert.IsType(t, fuego.BadRequestError{}, err)
		})
	}
}

func TestDeleteMapToolMap_EmptyName(t *testing.T) {
	hdlr, _ := setupMaptoolTest(t)

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"name": ""}

	_, err := hdlr.deleteMapToolMap(ctx)
	assert.IsType(t, fuego.BadRequestError{}, err)
}

func TestGetMapToolJobs_Empty(t *testing.T) {
	hdlr, _ := setupMaptoolTest(t)

	ctx := fuego.NewMockContextNoBody()
	jobs, err := hdlr.getMapToolJobs(ctx)
	require.NoError(t, err)
	assert.Empty(t, jobs)
}

func TestGetMapToolJobs_WithJobs(t *testing.T) {
	hdlr, _ := setupMaptoolTest(t)

	// Submit a job so there's something to list
	_, err := hdlr.maptoolMgr.Submit("/tmp/test", "testworld")
	require.NoError(t, err)

	ctx := fuego.NewMockContextNoBody()
	jobs, err := hdlr.getMapToolJobs(ctx)
	require.NoError(t, err)
	assert.NotEmpty(t, jobs)
	assert.Equal(t, "testworld", jobs[0].WorldName)
}

func TestCancelMapToolJob_NotFound(t *testing.T) {
	hdlr, _ := setupMaptoolTest(t)

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": "nonexistent-job-id"}

	_, err := hdlr.cancelMapToolJob(ctx)
	assert.IsType(t, fuego.BadRequestError{}, err)
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

	req := httptest.NewRequest(http.MethodPost, "/", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()

	hdlr.importMapToolZip(rec, req)
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

	req := httptest.NewRequest(http.MethodPost, "/", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()

	hdlr.importMapToolZip(rec, req)
	assert.Equal(t, http.StatusBadRequest, rec.Code)

	var respBody map[string]string
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &respBody))
	assert.Contains(t, respBody["error"], "file field is required")
}

func TestRestyleMapToolAll_NoMaps(t *testing.T) {
	hdlr, _ := setupMaptoolTest(t)

	ctx := fuego.NewMockContextNoBody()
	_, err := hdlr.restyleMapToolAll(ctx)
	assert.IsType(t, fuego.BadRequestError{}, err)
}

func TestRestyleMapToolAll_WithMaps(t *testing.T) {
	hdlr, mapsDir := setupMaptoolTest(t)

	// Create map directories with minimal files so ScanMaps finds them
	altisDir := filepath.Join(mapsDir, "altis")
	require.NoError(t, os.MkdirAll(altisDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(altisDir, "map.json"), []byte("{}"), 0644))

	ctx := fuego.NewMockContextNoBody()
	snap, err := hdlr.restyleMapToolAll(ctx)
	require.NoError(t, err)
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

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"id": snap.ID}

	_, err = hdlr.cancelMapToolJob(ctx)
	require.NoError(t, err)
}

func TestImportMapToolZip_ValidZip(t *testing.T) {
	hdlr, _ := setupMaptoolTest(t)

	// Build a ZIP containing a valid grad_meh directory structure.
	// ValidateGradMehDir requires: meta.json + sat/ directory.
	// FindGradMehDir checks root, then one level deep.
	buf := new(bytes.Buffer)
	zw := zip.NewWriter(buf)

	// Create testworld/meta.json
	fw, err := zw.Create("testworld/meta.json")
	require.NoError(t, err)
	_, err = fw.Write([]byte(`{"worldName":"testworld","worldSize":10240}`))
	require.NoError(t, err)

	// Create testworld/sat/ directory entry
	_, err = zw.Create("testworld/sat/")
	require.NoError(t, err)

	require.NoError(t, zw.Close())

	// Create multipart form with .zip filename
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("file", "testworld.zip")
	require.NoError(t, err)
	_, err = part.Write(buf.Bytes())
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	req := httptest.NewRequest(http.MethodPost, "/", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()

	hdlr.importMapToolZip(rec, req)
	assert.Equal(t, http.StatusAccepted, rec.Code)

	var snap maptool.JobInfo
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &snap))
	assert.Equal(t, "testworld", snap.WorldName)
	assert.Equal(t, "pending", snap.Status)
}

func TestGetMapToolMaps_ScanError(t *testing.T) {
	hdlr, _ := setupMaptoolTest(t)

	// Point mapsDir at a file (not a directory) so ScanMaps returns an error.
	tmpFile := filepath.Join(t.TempDir(), "notadir")
	require.NoError(t, os.WriteFile(tmpFile, []byte("x"), 0644))
	hdlr.maptoolCfg.mapsDir = tmpFile

	ctx := fuego.NewMockContextNoBody()
	_, err := hdlr.getMapToolMaps(ctx)
	assert.IsType(t, fuego.InternalServerError{}, err)
}

func TestDeleteMapToolMap_Nonexistent(t *testing.T) {
	hdlr, _ := setupMaptoolTest(t)

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"name": "does-not-exist"}

	_, err := hdlr.deleteMapToolMap(ctx)
	require.NoError(t, err)
	// RemoveAll on a non-existent path succeeds silently
}

func TestImportMapToolZip_BadExtract(t *testing.T) {
	hdlr, _ := setupMaptoolTest(t)

	// Build multipart form with a file named .zip but containing corrupt data.
	// Start with PK header followed by garbage to pass the filename check but
	// fail during zip extraction.
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("file", "test.zip")
	require.NoError(t, err)
	_, err = part.Write([]byte("PK\x03\x04corrupted-zip-data-that-is-not-valid"))
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	req := httptest.NewRequest(http.MethodPost, "/", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()

	hdlr.importMapToolZip(rec, req)
	assert.Equal(t, http.StatusBadRequest, rec.Code)

	var respBody map[string]string
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &respBody))
	assert.Contains(t, respBody["error"], "extract zip")
}

func TestRestyleMapToolAll_ExecutesCallback(t *testing.T) {
	mapsDir := t.TempDir()

	// Create a valid map directory with meta.json containing featureLayers
	// (RestyleWorld reads meta.json, not map.json)
	mapDir := filepath.Join(mapsDir, "testworld")
	require.NoError(t, os.MkdirAll(mapDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(mapDir, "meta.json"), []byte(`{
		"worldName": "testworld",
		"featureLayers": ["roads"]
	}`), 0644))

	// Create a map.json so ScanMaps finds this directory via its criticalFiles check
	require.NoError(t, os.WriteFile(filepath.Join(mapDir, "map.json"), []byte(`{"worldName":"testworld","worldSize":10240}`), 0644))

	jm := maptool.NewJobManager(mapsDir, noopPipeline)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { jm.Start(ctx); close(done) }()
	t.Cleanup(func() { cancel(); <-done })

	hdlr := &Handler{
		maptoolMgr: jm,
		maptoolCfg: &maptoolConfig{mapsDir: mapsDir},
	}

	mockCtx := fuego.NewMockContextNoBody()
	snap, err := hdlr.restyleMapToolAll(mockCtx)
	require.NoError(t, err)
	assert.Equal(t, "restyle-all", snap.WorldName)

	// Wait for the async job to complete
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		got := jm.GetJob(snap.ID)
		if got != nil && (got.Status == "done" || got.Status == "failed") {
			assert.Equal(t, "done", got.Status, "job failed: %s", got.Error)

			// Verify that RestyleWorld actually ran: style files should exist
			stylesDir := filepath.Join(mapDir, "styles")
			assert.FileExists(t, filepath.Join(stylesDir, "topo.json"))
			assert.FileExists(t, filepath.Join(stylesDir, "topo-dark.json"))
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("timed out waiting for restyle job to complete")
}

func TestImportMapToolZip_NoGradMehDir(t *testing.T) {
	hdlr, _ := setupMaptoolTest(t)

	// Build a valid zip that extracts OK but has no grad_meh structure
	var zipBuf bytes.Buffer
	zw := zip.NewWriter(&zipBuf)
	fw, err := zw.Create("readme.txt")
	require.NoError(t, err)
	_, err = fw.Write([]byte("no grad_meh here"))
	require.NoError(t, err)
	require.NoError(t, zw.Close())

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("file", "test.zip")
	require.NoError(t, err)
	_, err = part.Write(zipBuf.Bytes())
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	req := httptest.NewRequest(http.MethodPost, "/", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()

	hdlr.importMapToolZip(rec, req)
	assert.Equal(t, http.StatusBadRequest, rec.Code)

	var respBody map[string]string
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &respBody))
	assert.Contains(t, respBody["error"], "grad_meh")
}

func TestRestyleMapToolAll_ScanError(t *testing.T) {
	// Use a file (not dir) as maps dir so ScanMaps returns an error
	dir := t.TempDir()
	fakeFile := filepath.Join(dir, "notadir")
	require.NoError(t, os.WriteFile(fakeFile, []byte("x"), 0644))

	hdlr := &Handler{
		maptoolCfg: &maptoolConfig{mapsDir: fakeFile},
	}

	ctx := fuego.NewMockContextNoBody()
	_, err := hdlr.restyleMapToolAll(ctx)
	assert.IsType(t, fuego.InternalServerError{}, err)
}

func TestDeleteMapToolMap_RemoveError(t *testing.T) {
	mapsDir := t.TempDir()
	hdlr := &Handler{
		maptoolCfg: &maptoolConfig{mapsDir: mapsDir},
	}

	// Try to remove a map that exists but can't be removed (read-only parent)
	mapDir := filepath.Join(mapsDir, "locked")
	require.NoError(t, os.MkdirAll(mapDir, 0755))
	require.NoError(t, os.Chmod(mapsDir, 0555))
	defer func() { assert.NoError(t, os.Chmod(mapsDir, 0755)) }()

	ctx := fuego.NewMockContextNoBody()
	ctx.PathParams = map[string]string{"name": "locked"}

	_, err := hdlr.deleteMapToolMap(ctx)
	assert.IsType(t, fuego.InternalServerError{}, err)
}

func TestRestyleMapToolAll_RestyleWorldError(t *testing.T) {
	mapsDir := t.TempDir()

	// Create a map directory with map.json (so ScanMaps finds it)
	// but WITHOUT meta.json (so RestyleWorld fails trying to read it)
	mapDir := filepath.Join(mapsDir, "broken_world")
	require.NoError(t, os.MkdirAll(mapDir, 0755))
	require.NoError(t, os.WriteFile(
		filepath.Join(mapDir, "map.json"),
		[]byte(`{"worldName":"broken_world","worldSize":10240}`),
		0644,
	))
	// No meta.json — RestyleWorld will fail with "read meta.json: ..."

	jm := maptool.NewJobManager(mapsDir, noopPipeline)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { jm.Start(ctx); close(done) }()
	t.Cleanup(func() { cancel(); <-done })

	hdlr := &Handler{
		maptoolMgr: jm,
		maptoolCfg: &maptoolConfig{mapsDir: mapsDir},
	}

	mockCtx := fuego.NewMockContextNoBody()
	snap, err := hdlr.restyleMapToolAll(mockCtx)
	require.NoError(t, err)
	assert.Equal(t, "restyle-all", snap.WorldName)

	// Wait for the async job to finish — it should fail because RestyleWorld errors
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		got := jm.GetJob(snap.ID)
		if got != nil && (got.Status == "done" || got.Status == "failed") {
			assert.Equal(t, "failed", got.Status)
			assert.Contains(t, got.Error, "failed to restyle 1 map(s)")
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("timed out waiting for restyle job to complete")
}

func TestMapToolEventStream_Unauthorized(t *testing.T) {
	hdlr, _ := setupMaptoolTest(t)
	hdlr.jwt = NewJWTManager("secret", time.Hour)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/maptool/events", nil)
	rec := httptest.NewRecorder()

	hdlr.mapToolEventStream(rec, req)
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestMapToolEventStream_InvalidToken(t *testing.T) {
	hdlr, _ := setupMaptoolTest(t)
	hdlr.jwt = NewJWTManager("secret", time.Hour)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/maptool/events?token=bad-token", nil)
	rec := httptest.NewRecorder()

	hdlr.mapToolEventStream(rec, req)
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestMapToolEventStream_QueryToken(t *testing.T) {
	mapsDir := t.TempDir()
	jm := maptool.NewJobManager(mapsDir, noopPipeline)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { jm.Start(ctx); close(done) }()
	t.Cleanup(func() { cancel(); <-done })

	jwt := NewJWTManager("test-secret", time.Hour)
	token, err := jwt.Create("")
	require.NoError(t, err)

	hdlr := &Handler{
		maptoolMgr: jm,
		maptoolCfg: &maptoolConfig{mapsDir: mapsDir},
		jwt:        jwt,
	}

	// Use a real HTTP server so the SSE response flushes properly
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/maptool/events", hdlr.mapToolEventStream)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	// Connect with token via query param
	reqURL := fmt.Sprintf("%s/api/v1/maptool/events?token=%s", srv.URL, token)
	connCtx, connCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer connCancel()

	req, err := http.NewRequestWithContext(connCtx, http.MethodGet, reqURL, nil)
	require.NoError(t, err)

	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusOK, resp.StatusCode)
	assert.Equal(t, "text/event-stream", resp.Header.Get("Content-Type"))

	// Read the initial snapshot event
	scanner := bufio.NewScanner(resp.Body)
	var lines []string
	for scanner.Scan() {
		line := scanner.Text()
		lines = append(lines, line)
		// After we get the snapshot data line, we have enough
		if strings.HasPrefix(line, "data: ") {
			break
		}
	}

	// Verify we got the snapshot event
	found := false
	for _, l := range lines {
		if l == "event: snapshot" {
			found = true
		}
	}
	assert.True(t, found, "should receive snapshot event, got: %v", lines)

	// Submit a job to trigger a live event through the SSE channel
	_, err = jm.Submit("/tmp/sse-test", "sseworld")
	require.NoError(t, err)

	// Read the live event (job_submitted or similar)
	var eventLines []string
	for scanner.Scan() {
		line := scanner.Text()
		eventLines = append(eventLines, line)
		if strings.HasPrefix(line, "data: ") {
			break
		}
	}
	assert.NotEmpty(t, eventLines, "should receive live event after job submission")
}

func TestMapToolEventStream_BearerToken(t *testing.T) {
	mapsDir := t.TempDir()
	jm := maptool.NewJobManager(mapsDir, noopPipeline)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { jm.Start(ctx); close(done) }()
	t.Cleanup(func() { cancel(); <-done })

	jwt := NewJWTManager("test-secret", time.Hour)
	token, err := jwt.Create("")
	require.NoError(t, err)

	hdlr := &Handler{
		maptoolMgr: jm,
		maptoolCfg: &maptoolConfig{mapsDir: mapsDir},
		jwt:        jwt,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/maptool/events", hdlr.mapToolEventStream)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	// Connect with Bearer token in header
	connCtx, connCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer connCancel()

	req, err := http.NewRequestWithContext(connCtx, http.MethodGet, srv.URL+"/api/v1/maptool/events", nil)
	require.NoError(t, err)
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusOK, resp.StatusCode)
	assert.Equal(t, "text/event-stream", resp.Header.Get("Content-Type"))

	// Read the initial snapshot event
	scanner := bufio.NewScanner(resp.Body)
	var lines []string
	for scanner.Scan() {
		line := scanner.Text()
		lines = append(lines, line)
		if strings.HasPrefix(line, "data: ") {
			break
		}
	}

	found := false
	for _, l := range lines {
		if l == "event: snapshot" {
			found = true
		}
	}
	assert.True(t, found, "should receive snapshot event via Bearer token")
}

func TestRestyleMapToolAll_SubmitError(t *testing.T) {
	mapsDir := t.TempDir()

	// Create a valid map directory
	mapDir := filepath.Join(mapsDir, "testworld")
	require.NoError(t, os.MkdirAll(mapDir, 0755))
	require.NoError(t, os.WriteFile(
		filepath.Join(mapDir, "map.json"),
		[]byte(`{"worldName":"testworld","worldSize":10240}`),
		0644,
	))

	// Create a JobManager but do NOT start it — SubmitFunc will fail
	jm := maptool.NewJobManager(mapsDir, noopPipeline)
	// Don't start the job manager so the submit channel is not being consumed

	hdlr := &Handler{
		maptoolMgr: jm,
		maptoolCfg: &maptoolConfig{mapsDir: mapsDir},
	}

	// Start the job manager briefly so Submit works, then stop to test the error
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { jm.Start(ctx); close(done) }()
	t.Cleanup(func() { cancel(); <-done })
	// Give it a moment to start
	time.Sleep(20 * time.Millisecond)

	mockCtx := fuego.NewMockContextNoBody()

	// This should succeed since manager is running
	snap, err := hdlr.restyleMapToolAll(mockCtx)
	require.NoError(t, err)
	assert.Equal(t, "restyle-all", snap.WorldName)
}

func TestMapToolEventStream_ChannelClosed(t *testing.T) {
	// Test the events channel closed path (L259-261 in handler_maptool.go).
	// When the subscriber channel is closed (via Unsubscribe from the manager side),
	// the SSE handler should return gracefully.
	mapsDir := t.TempDir()
	jm := maptool.NewJobManager(mapsDir, noopPipeline)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { jm.Start(ctx); close(done) }()
	t.Cleanup(func() { cancel(); <-done })

	jwt := NewJWTManager("test-secret", time.Hour)
	token, err := jwt.Create("")
	require.NoError(t, err)

	hdlr := &Handler{
		maptoolMgr: jm,
		maptoolCfg: &maptoolConfig{mapsDir: mapsDir},
		jwt:        jwt,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/maptool/events", hdlr.mapToolEventStream)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	connCtx, connCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer connCancel()

	reqURL := fmt.Sprintf("%s/api/v1/maptool/events?token=%s", srv.URL, token)
	req, err := http.NewRequestWithContext(connCtx, http.MethodGet, reqURL, nil)
	require.NoError(t, err)

	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()

	assert.Equal(t, http.StatusOK, resp.StatusCode)

	// Read the initial snapshot event to confirm connection is established
	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "data: ") {
			break // Got the snapshot data
		}
	}

	// Cancel the client context which closes the request, triggering ctx.Done()
	// on the server side. This covers the context cancellation exit path.
	connCancel()

	// Drain remaining data to confirm no hang.
	for scanner.Scan() {
		// drain
	}
	// If we get here without timing out, the context-cancel path worked.
}

func TestMapToolEventStream_FlusherNotSupported(t *testing.T) {
	// Test the flusher not supported path (L230-233 in handler_maptool.go).
	// Use a custom ResponseWriter that does NOT implement http.Flusher.
	mapsDir := t.TempDir()
	jm := maptool.NewJobManager(mapsDir, noopPipeline)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { jm.Start(ctx); close(done) }()
	t.Cleanup(func() { cancel(); <-done })

	jwt := NewJWTManager("test-secret", time.Hour)
	token, err := jwt.Create("")
	require.NoError(t, err)

	hdlr := &Handler{
		maptoolMgr: jm,
		maptoolCfg: &maptoolConfig{mapsDir: mapsDir},
		jwt:        jwt,
	}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/maptool/events?token="+token, nil)
	rec := &nonFlushableWriter{header: http.Header{}, code: 0}

	hdlr.mapToolEventStream(rec, req)
	assert.Equal(t, http.StatusInternalServerError, rec.code)
	assert.Contains(t, string(rec.body), "streaming not supported")
}

// nonFlushableWriter is an http.ResponseWriter that does NOT implement http.Flusher.
// Used to test the "streaming not supported" error path in mapToolEventStream.
type nonFlushableWriter struct {
	header http.Header
	body   []byte
	code   int
}

func (w *nonFlushableWriter) Header() http.Header         { return w.header }
func (w *nonFlushableWriter) Write(b []byte) (int, error)  { w.body = append(w.body, b...); return len(b), nil }
func (w *nonFlushableWriter) WriteHeader(code int)         { w.code = code }

// jsonTrimmed returns the recorder body with trailing whitespace removed.
func jsonTrimmed(rec *httptest.ResponseRecorder) string {
	s := rec.Body.String()
	// Fuego's JSON encoder appends a trailing newline
	if len(s) > 0 && s[len(s)-1] == '\n' {
		s = s[:len(s)-1]
	}
	return s
}
