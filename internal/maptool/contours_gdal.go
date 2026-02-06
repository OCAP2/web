package maptool

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
)

// contourIntervals maps interval values to their file suffixes.
var contourIntervals = []struct {
	interval int
	suffix   string
}{
	{5, "05"},
	{10, "10"},
	{50, "50"},
	{100, "100"},
}

// NewGenerateContoursStage creates a pipeline stage that generates contour lines
// from the DEM GeoTIFF at 4 intervals using gdal_contour.
func NewGenerateContoursStage(tools ToolSet) Stage {
	return Stage{
		Name:     "generate_contours",
		Optional: true,
		Run: func(ctx context.Context, job *Job) error {
			if job.DEMPath == "" {
				return fmt.Errorf("DEM not available")
			}

			gdalContour, ok := tools.FindTool("gdal_contour")
			if !ok {
				return fmt.Errorf("gdal_contour not found")
			}

			contourDir := filepath.Join(job.TempDir, "contours")
			if err := os.MkdirAll(contourDir, 0755); err != nil {
				return fmt.Errorf("create contour dir: %w", err)
			}

			job.ContourFiles = make(map[string]string)

			for _, ci := range contourIntervals {
				outputPath := filepath.Join(contourDir, fmt.Sprintf("contours%s.geojson", ci.suffix))
				args := []string{
					"-a", "elevation",
					"-nln", "contours-line",
					"-i", fmt.Sprintf("%d", ci.interval),
					"-f", "GeoJSON",
					job.DEMPath,
					outputPath,
				}

				log.Printf("Generating %dm contours", ci.interval)
				cmd := exec.CommandContext(ctx, gdalContour.Path, args...)
				cmd.Stdout = os.Stdout
				cmd.Stderr = os.Stderr
				if err := cmd.Run(); err != nil {
					log.Printf("WARNING: gdal_contour %dm failed: %v", ci.interval, err)
					continue
				}

				job.ContourFiles[ci.suffix] = outputPath
				log.Printf("Generated contours%s.geojson", ci.suffix)
			}

			if len(job.ContourFiles) == 0 {
				return fmt.Errorf("no contour files generated")
			}

			return nil
		},
	}
}
