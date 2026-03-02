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
	"github.com/labstack/echo/v4"
)

// maptoolConfig holds the maptool-specific configuration for the handler.
type maptoolConfig struct {
	tools   maptool.ToolSet
	mapsDir string
}

// getMapToolHealth returns a health check for the maptool environment.
func (h *Handler) getMapToolHealth(c echo.Context) error {
	checks := []map[string]any{}

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
	check := map[string]any{
		"id":    "maps_writable",
		"label": "Maps directory writable",
		"ok":    writable,
	}
	if !writable {
		check["error"] = writeErr
	}
	checks = append(checks, check)

	return c.JSON(http.StatusOK, checks)
}

// getMapToolTools returns detected tool availability.
func (h *Handler) getMapToolTools(c echo.Context) error {
	return c.JSON(http.StatusOK, h.maptoolCfg.tools)
}

// getMapToolMaps returns the list of installed maps.
func (h *Handler) getMapToolMaps(c echo.Context) error {
	maps, err := maptool.ScanMaps(h.maptoolCfg.mapsDir)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, maps)
}

// deleteMapToolMap removes a map directory.
func (h *Handler) deleteMapToolMap(c echo.Context) error {
	name := c.Param("name")
	if name == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid map name"})
	}
	dir := filepath.Join(h.maptoolCfg.mapsDir, filepath.Clean(name))
	absDir, _ := filepath.Abs(dir)
	absMaps, _ := filepath.Abs(h.maptoolCfg.mapsDir)
	if !strings.HasPrefix(absDir, absMaps+string(filepath.Separator)) {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid map name"})
	}
	if err := os.RemoveAll(dir); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return c.NoContent(http.StatusNoContent)
}

// importMapToolZip handles ZIP upload, extraction, and pipeline submission.
func (h *Handler) importMapToolZip(c echo.Context) error {
	file, err := c.FormFile("file")
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "file field is required"})
	}
	if !strings.HasSuffix(strings.ToLower(file.Filename), ".zip") {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "only .zip files are accepted"})
	}

	src, err := file.Open()
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to read upload"})
	}
	defer src.Close()

	tmpFile, err := os.CreateTemp("", "ocap-maptool-upload-*.zip")
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to create temp file"})
	}
	tmpPath := tmpFile.Name()
	defer os.Remove(tmpPath)

	if _, err := io.Copy(tmpFile, src); err != nil {
		tmpFile.Close()
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to save upload"})
	}
	if err := tmpFile.Close(); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to save upload"})
	}

	extractDir, err := os.MkdirTemp("", "ocap-maptool-uploads-")
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "failed to create extraction dir"})
	}

	if err := maptool.ExtractZip(tmpPath, extractDir); err != nil {
		os.RemoveAll(extractDir)
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": fmt.Sprintf("failed to extract zip: %v", err),
		})
	}

	gradMehDir, err := maptool.FindGradMehDir(extractDir)
	if err != nil {
		os.RemoveAll(extractDir)
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": fmt.Sprintf("not a valid grad_meh export: %v", err),
		})
	}

	worldName := maptool.WorldNameFromDir(gradMehDir)
	snap, err := h.maptoolMgr.SubmitWithCleanup(gradMehDir, worldName, extractDir)
	if err != nil {
		os.RemoveAll(extractDir)
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusAccepted, snap)
}

// restyleMapToolAll restyles all existing maps.
func (h *Handler) restyleMapToolAll(c echo.Context) error {
	maps, err := maptool.ScanMaps(h.maptoolCfg.mapsDir)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	if len(maps) == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "no maps found"})
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
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusAccepted, snap)
}

// getMapToolJobs returns all job snapshots.
func (h *Handler) getMapToolJobs(c echo.Context) error {
	return c.JSON(http.StatusOK, h.maptoolMgr.ListJobs())
}

// cancelMapToolJob cancels a running job.
func (h *Handler) cancelMapToolJob(c echo.Context) error {
	id := c.Param("id")
	if err := h.maptoolMgr.CancelJob(id); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": err.Error()})
	}
	return c.NoContent(http.StatusNoContent)
}

// mapToolEventStream is an SSE endpoint that streams all job events.
func (h *Handler) mapToolEventStream(c echo.Context) error {
	// Auth: EventSource cannot set headers, so accept token via query param
	token := bearerToken(c)
	if token == "" {
		token = c.QueryParam("token")
	}
	if token == "" || h.jwt.Validate(token) != nil {
		return echo.ErrUnauthorized
	}

	c.Response().Header().Set("Content-Type", "text/event-stream")
	c.Response().Header().Set("Cache-Control", "no-cache")
	c.Response().Header().Set("Connection", "keep-alive")
	c.Response().Header().Set("X-Accel-Buffering", "no") // disable nginx buffering

	// Send initial snapshot of all jobs
	jobs := h.maptoolMgr.ListJobs()
	snapData, _ := json.Marshal(jobs)
	fmt.Fprintf(c.Response(), "event: snapshot\ndata: %s\n\n", snapData)
	c.Response().Flush()

	// Subscribe to live events
	subID, events := h.maptoolMgr.Subscribe()
	defer h.maptoolMgr.Unsubscribe(subID)

	// Heartbeat keeps the connection alive through proxies that buffer responses
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()

	ctx := c.Request().Context()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-heartbeat.C:
			// SSE comment line — ignored by EventSource, flushes proxy buffers
			fmt.Fprintf(c.Response(), ": keepalive\n\n")
			c.Response().Flush()
		case evt, ok := <-events:
			if !ok {
				return nil
			}
			data, _ := json.Marshal(evt)
			fmt.Fprintf(c.Response(), "event: %s\ndata: %s\n\n", evt.Type, data)
			c.Response().Flush()
		}
	}
}
