package main

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/OCAP2/web/internal/maptool"
	"github.com/labstack/echo/v4"
)

//go:embed static
var staticFiles embed.FS

type handler struct {
	tools   maptool.ToolSet
	jm      *maptool.JobManager
	mapsDir string
}

func newHandler(e *echo.Echo, tools maptool.ToolSet, jm *maptool.JobManager, mapsDir string) {
	h := &handler{tools: tools, jm: jm, mapsDir: mapsDir}

	// API routes
	api := e.Group("/api")
	api.GET("/tools", h.getTools)
	api.GET("/maps", h.getMaps)
	api.DELETE("/maps/:name", h.deleteMap)
	api.POST("/maps/import", h.importZip)
	api.POST("/maps/restyle", h.restyleAll)
	api.GET("/jobs", h.getJobs)
	api.GET("/jobs/:id", h.getJob)
	api.GET("/jobs/:id/sse", h.jobSSE)

	// Serve map files (previews, etc.) from the maps directory
	e.Static("/maps", mapsDir)

	// Static files (embedded) — strip "static/" prefix so files are served from root
	staticSub, _ := fs.Sub(staticFiles, "static")
	fileServer := http.FileServer(http.FS(staticSub))
	e.GET("/*", echo.WrapHandler(fileServer))
}

func (h *handler) getTools(c echo.Context) error {
	return c.JSON(http.StatusOK, h.tools)
}

func (h *handler) getMaps(c echo.Context) error {
	maps, err := maptool.ScanMaps(h.mapsDir)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return c.JSON(http.StatusOK, maps)
}

func (h *handler) deleteMap(c echo.Context) error {
	name := c.Param("name")
	if name == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid map name"})
	}
	dir := filepath.Join(h.mapsDir, filepath.Clean(name))
	absDir, _ := filepath.Abs(dir)
	absMaps, _ := filepath.Abs(h.mapsDir)
	if !strings.HasPrefix(absDir, absMaps+string(filepath.Separator)) {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid map name"})
	}
	if err := os.RemoveAll(dir); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return c.NoContent(http.StatusNoContent)
}

func (h *handler) importZip(c echo.Context) error {
	file, err := c.FormFile("file")
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "file field is required"})
	}
	if !strings.HasSuffix(strings.ToLower(file.Filename), ".zip") {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "only .zip files are accepted"})
	}

	// Save uploaded file to temp
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
	tmpFile.Close()

	// Extract ZIP to a per-upload directory
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

	// Locate grad_meh directory — could be at root or one level deep
	gradMehDir, err := maptool.FindGradMehDir(extractDir)
	if err != nil {
		os.RemoveAll(extractDir)
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": fmt.Sprintf("not a valid grad_meh export: %v", err),
		})
	}

	worldName := maptool.WorldNameFromDir(gradMehDir)
	snap, err := h.jm.SubmitWithCleanup(gradMehDir, worldName, extractDir)
	if err != nil {
		os.RemoveAll(extractDir)
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusAccepted, snap)
}

func (h *handler) restyleAll(c echo.Context) error {
	maps, err := maptool.ScanMaps(h.mapsDir)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	if len(maps) == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "no maps found"})
	}

	id := fmt.Sprintf("restyle-%d", time.Now().UnixMilli())
	snap, err := h.jm.SubmitFunc(id, "restyle-all", func(ctx context.Context, job *maptool.Job) error {
		var errs []error
		for i, m := range maps {
			if err := ctx.Err(); err != nil {
				return err
			}
			job.SetProgress(m.Name, i+1, len(maps))
			if err := maptool.RestyleWorld(h.mapsDir, m.Name); err != nil {
				log.Printf("restyle %s: %v", m.Name, err)
				errs = append(errs, fmt.Errorf("%s: %w", m.Name, err))
				continue
			}
			log.Printf("restyled: %s", m.Name)
		}
		if len(errs) > 0 {
			return fmt.Errorf("failed to restyle %d map(s):\n%w", len(errs), errors.Join(errs...))
		}
		return nil
	})
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusAccepted, snap)
}

func (h *handler) getJobs(c echo.Context) error {
	return c.JSON(http.StatusOK, h.jm.ListJobs())
}

func (h *handler) getJob(c echo.Context) error {
	job := h.jm.GetJob(c.Param("id"))
	if job == nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "job not found"})
	}
	return c.JSON(http.StatusOK, job)
}

func (h *handler) jobSSE(c echo.Context) error {
	jobID := c.Param("id")
	snap := h.jm.GetJob(jobID)
	if snap == nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "job not found"})
	}

	c.Response().Header().Set("Content-Type", "text/event-stream")
	c.Response().Header().Set("Cache-Control", "no-cache")
	c.Response().Header().Set("Connection", "keep-alive")

	fmt.Fprintf(c.Response(), "data: {\"status\":%q,\"error\":%q}\n\n", snap.Status, snap.Error)
	c.Response().Flush()

	log.Printf("SSE connection for job %s (status: %s)", jobID, snap.Status)
	return nil
}
