package main

import (
	"archive/zip"
	"context"
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

	if err := extractZip(tmpPath, extractDir); err != nil {
		os.RemoveAll(extractDir)
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": fmt.Sprintf("failed to extract zip: %v", err),
		})
	}

	// Locate grad_meh directory — could be at root or one level deep
	gradMehDir, err := findGradMehDir(extractDir)
	if err != nil {
		os.RemoveAll(extractDir)
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": fmt.Sprintf("not a valid grad_meh export: %v", err),
		})
	}

	worldName := maptool.WorldNameFromDir(gradMehDir)
	snap, err := h.jm.Submit(gradMehDir, worldName)
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
		for i, m := range maps {
			if err := ctx.Err(); err != nil {
				return err
			}
			job.SetProgress(m.Name, i+1, len(maps))
			if err := restyleWorld(h.mapsDir, m.Name); err != nil {
				log.Printf("restyle %s: %v", m.Name, err)
				return fmt.Errorf("%s: %w", m.Name, err)
			}
			log.Printf("restyled: %s", m.Name)
		}
		return nil
	})
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}

	return c.JSON(http.StatusAccepted, snap)
}

// extractZip extracts a ZIP file to the target directory with zip-slip protection.
func extractZip(zipPath, targetDir string) error {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer r.Close()

	for _, f := range r.File {
		destPath := filepath.Join(targetDir, f.Name)
		// Zip-slip protection
		if !strings.HasPrefix(filepath.Clean(destPath)+string(os.PathSeparator), filepath.Clean(targetDir)+string(os.PathSeparator)) &&
			filepath.Clean(destPath) != filepath.Clean(targetDir) {
			return fmt.Errorf("illegal file path: %s", f.Name)
		}

		if f.FileInfo().IsDir() {
			os.MkdirAll(destPath, 0755)
			continue
		}

		if err := os.MkdirAll(filepath.Dir(destPath), 0755); err != nil {
			return err
		}

		outFile, err := os.Create(destPath)
		if err != nil {
			return err
		}

		rc, err := f.Open()
		if err != nil {
			outFile.Close()
			return err
		}

		_, err = io.Copy(outFile, rc)
		rc.Close()
		outFile.Close()
		if err != nil {
			return err
		}
	}
	return nil
}

// findGradMehDir locates the grad_meh export directory within an extracted ZIP.
// It checks the root first, then one level deep.
func findGradMehDir(dir string) (string, error) {
	if maptool.ValidateGradMehDir(dir) == nil {
		return dir, nil
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", err
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		subDir := filepath.Join(dir, e.Name())
		if maptool.ValidateGradMehDir(subDir) == nil {
			return subDir, nil
		}
	}

	return "", fmt.Errorf("no directory with meta.json and sat/ found")
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
