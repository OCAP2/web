package maptool

import (
	"context"
	"fmt"
	"log"
	"os"
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
				if err := runCmd(ctx, gdalContour.Path, args...); err != nil {
					log.Printf("WARNING: gdal_contour %dm failed: %v", ci.interval, err)
					continue
				}

				job.ContourFiles[ci.suffix] = outputPath
				log.Printf("Generated contours%s.geojson", ci.suffix)
			}

			if len(job.ContourFiles) == 0 {
				return fmt.Errorf("no contour files generated")
			}

			// Generate sea polygons from DEM (land/water split).
			// Uses gdal_contour -p with a large interval to create polygons
			// with ELEV_MAX/ELEV_MIN properties for filtering land vs water.
			seaPath := filepath.Join(contourDir, "sea.geojson")
			seaArgs := []string{
				"-p",           // polygon mode
				"-amax", "ELEV_MAX",
				"-amin", "ELEV_MIN",
				"-b", "1",
				"-i", "5000",   // single interval covering full range
				"-f", "GeoJSON",
				job.DEMPath,
				seaPath,
			}
			log.Printf("Generating sea polygons from DEM")
			if err := runCmd(ctx, gdalContour.Path, seaArgs...); err != nil {
				log.Printf("WARNING: sea polygon generation failed: %v", err)
			} else {
				job.SeaFile = seaPath
				log.Printf("Generated sea.geojson")
			}

			return nil
		},
	}
}
