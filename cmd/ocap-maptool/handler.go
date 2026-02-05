package main

import (
	"embed"
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
	api.POST("/maps/import", h.importPBO)
	api.GET("/jobs", h.getJobs)
	api.GET("/jobs/:id", h.getJob)
	api.GET("/jobs/:id/sse", h.jobSSE)

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

func (h *handler) importPBO(c echo.Context) error {
	form, err := c.MultipartForm()
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "invalid multipart form"})
	}
	files := form.File["pbo"]
	if len(files) == 0 {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "no pbo file uploaded"})
	}

	// Create a per-job upload directory so all PBOs are siblings
	uploadDir := filepath.Join(os.TempDir(), "ocap-maptool-uploads",
		fmt.Sprintf("%d", time.Now().UnixNano()))
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	// Save all uploaded files and identify the main map PBO (shortest non-data_layers name).
	// Real Arma maps ship with extra PBOs like map_altis_data.pbo alongside map_altis.pbo,
	// so we pick the shortest-named one — it's the stem that FindDataLayerPBOs globs against.
	var mainPBO string
	for _, fh := range files {
		name := filepath.Base(fh.Filename)
		if !strings.HasSuffix(strings.ToLower(name), ".pbo") {
			continue
		}

		src, err := fh.Open()
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}

		dst, err := os.Create(filepath.Join(uploadDir, name))
		if err != nil {
			src.Close()
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		if _, err = io.Copy(dst, src); err != nil {
			dst.Close()
			src.Close()
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		dst.Close()
		src.Close()

		if !strings.Contains(strings.ToLower(name), "_data_layers") {
			path := filepath.Join(uploadDir, name)
			if mainPBO == "" || len(name) < len(filepath.Base(mainPBO)) {
				mainPBO = path
			}
		}
	}

	if mainPBO == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "no main map PBO found — at least one file must not be a data_layers PBO",
		})
	}

	worldName := maptool.WorldNameFromPBO(filepath.Base(mainPBO))
	snap, err := h.jm.Submit(mainPBO, worldName)
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
