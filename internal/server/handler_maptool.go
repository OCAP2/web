package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/OCAP2/web/internal/maptool"
	"github.com/go-fuego/fuego"
)

// maptoolConfig holds the maptool-specific configuration for the handler.
type maptoolConfig struct {
	tools   maptool.ToolSet
	mapsDir string
}

// MapToolHealthCheck represents a single health check result.
type MapToolHealthCheck struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
}

// getMapToolHealth returns a health check for the maptool environment.
func (h *Handler) getMapToolHealth(c ContextNoBody) ([]MapToolHealthCheck, error) {
	checks := []MapToolHealthCheck{}

	// Check maps directory writability
	writable := true
	var writeErr string
	f, err := os.CreateTemp(h.maptoolCfg.mapsDir, ".health-check-*")
	if err != nil {
		writable = false
		writeErr = err.Error()
	} else {
		name := f.Name()
		f.Close()
		os.Remove(name)
	}
	check := MapToolHealthCheck{
		ID:    "maps_writable",
		Label: "Maps directory writable",
		OK:    writable,
	}
	if !writable {
		check.Error = writeErr
	}
	checks = append(checks, check)

	return checks, nil
}

// getMapToolTools returns detected tool availability.
func (h *Handler) getMapToolTools(c ContextNoBody) (maptool.ToolSet, error) {
	return h.maptoolCfg.tools, nil
}

// getMapToolMaps returns the list of installed maps.
func (h *Handler) getMapToolMaps(c ContextNoBody) ([]maptool.MapInfo, error) {
	maps, err := maptool.ScanMaps(h.maptoolCfg.mapsDir)
	if err != nil {
		return nil, fuego.InternalServerError{Err: err}
	}
	return maps, nil
}

// deleteMapToolMap removes a map directory.
func (h *Handler) deleteMapToolMap(c ContextNoBody) (any, error) {
	name := c.PathParam("name")
	if name == "" {
		return nil, fuego.BadRequestError{Err: fmt.Errorf("invalid map name")}
	}
	dir := filepath.Join(h.maptoolCfg.mapsDir, filepath.Clean(name))
	absDir, _ := filepath.Abs(dir)
	absMaps, _ := filepath.Abs(h.maptoolCfg.mapsDir)
	if !strings.HasPrefix(absDir, absMaps+string(filepath.Separator)) {
		return nil, fuego.BadRequestError{Err: fmt.Errorf("invalid map name")}
	}
	if err := os.RemoveAll(dir); err != nil {
		return nil, fuego.InternalServerError{Err: err}
	}
	c.SetStatus(http.StatusNoContent)
	return nil, nil
}

// importMapToolZip handles ZIP upload, extraction, and pipeline submission.
func (h *Handler) importMapToolZip(w http.ResponseWriter, r *http.Request) {
	file, header, err := r.FormFile("file")
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "file field is required")
		return
	}
	defer file.Close()

	if !strings.HasSuffix(strings.ToLower(header.Filename), ".zip") {
		writeJSONError(w, http.StatusBadRequest, "only .zip files are accepted")
		return
	}

	tmpFile, err := os.CreateTemp("", "ocap-maptool-upload-*.zip")
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "failed to create temp file")
		return
	}
	tmpPath := tmpFile.Name()
	defer os.Remove(tmpPath)

	if _, err := io.Copy(tmpFile, file); err != nil {
		tmpFile.Close()
		writeJSONError(w, http.StatusInternalServerError, "failed to save upload")
		return
	}
	if err := tmpFile.Close(); err != nil {
		writeJSONError(w, http.StatusInternalServerError, "failed to save upload")
		return
	}

	extractDir, err := os.MkdirTemp("", "ocap-maptool-uploads-")
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "failed to create extraction dir")
		return
	}

	if err := maptool.ExtractZip(tmpPath, extractDir); err != nil {
		os.RemoveAll(extractDir)
		writeJSONError(w, http.StatusBadRequest, fmt.Sprintf("failed to extract zip: %v", err))
		return
	}

	gradMehDir, err := maptool.FindGradMehDir(extractDir)
	if err != nil {
		os.RemoveAll(extractDir)
		writeJSONError(w, http.StatusBadRequest, fmt.Sprintf("not a valid grad_meh export: %v", err))
		return
	}

	worldName := maptool.WorldNameFromDir(gradMehDir)
	snap, err := h.maptoolMgr.SubmitWithCleanup(gradMehDir, worldName, extractDir)
	if err != nil {
		os.RemoveAll(extractDir)
		writeJSONError(w, http.StatusInternalServerError, err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(snap)
}

// restyleMapToolAll restyles all existing maps.
func (h *Handler) restyleMapToolAll(c ContextNoBody) (maptool.JobInfo, error) {
	maps, err := maptool.ScanMaps(h.maptoolCfg.mapsDir)
	if err != nil {
		return maptool.JobInfo{}, fuego.InternalServerError{Err: err}
	}
	if len(maps) == 0 {
		return maptool.JobInfo{}, fuego.BadRequestError{Err: fmt.Errorf("no maps found")}
	}

	id := fmt.Sprintf("restyle-%d", time.Now().UnixMilli())
	snap, err := h.maptoolMgr.SubmitFunc(id, "restyle-all", func(ctx context.Context, job *maptool.Job) error {
		var errs []error
		for i, m := range maps {
			if err := ctx.Err(); err != nil {
				return err
			}
			job.SetProgress(m.Name, i+1, len(maps))
			if err := maptool.RestyleWorld(h.maptoolCfg.mapsDir, m.Name); err != nil {
				log.Printf("restyle %s: %v", m.Name, err)
				errs = append(errs, fmt.Errorf("%s: %w", m.Name, err))
				continue
			}
			log.Printf("restyled: %s", m.Name)
		}
		if len(errs) > 0 {
			return fmt.Errorf("failed to restyle %d map(s)", len(errs))
		}
		return nil
	})
	if err != nil {
		return maptool.JobInfo{}, fuego.InternalServerError{Err: err}
	}

	c.SetStatus(http.StatusAccepted)
	return snap, nil
}

// getMapToolJobs returns all job snapshots.
func (h *Handler) getMapToolJobs(c ContextNoBody) ([]maptool.JobInfo, error) {
	return h.maptoolMgr.ListJobs(), nil
}

// cancelMapToolJob cancels a running job.
func (h *Handler) cancelMapToolJob(c ContextNoBody) (any, error) {
	id := c.PathParam("id")
	if err := h.maptoolMgr.CancelJob(id); err != nil {
		return nil, fuego.BadRequestError{Err: err}
	}
	c.SetStatus(http.StatusNoContent)
	return nil, nil
}

// mapToolEventStream is an SSE endpoint that streams all job events.
func (h *Handler) mapToolEventStream(w http.ResponseWriter, r *http.Request) {
	// Auth: EventSource cannot set headers, so accept token via query param
	token := bearerToken(r)
	if token == "" {
		token = r.URL.Query().Get("token")
	}
	if token == "" || h.jwt.Validate(token) != nil {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no") // disable nginx buffering

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	// Send initial snapshot of all jobs
	jobs := h.maptoolMgr.ListJobs()
	snapData, _ := json.Marshal(jobs)
	fmt.Fprintf(w, "event: snapshot\ndata: %s\n\n", snapData)
	flusher.Flush()

	// Subscribe to live events
	subID, events := h.maptoolMgr.Subscribe()
	defer h.maptoolMgr.Unsubscribe(subID)

	// Heartbeat keeps the connection alive through proxies that buffer responses
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case <-heartbeat.C:
			// SSE comment line — ignored by EventSource, flushes proxy buffers
			fmt.Fprintf(w, ": keepalive\n\n")
			flusher.Flush()
		case evt, ok := <-events:
			if !ok {
				return
			}
			data, _ := json.Marshal(evt)
			fmt.Fprintf(w, "event: %s\ndata: %s\n\n", evt.Type, data)
			flusher.Flush()
		}
	}
}

// writeJSONError writes a JSON error response.
func writeJSONError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
