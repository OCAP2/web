package maptool

import (
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
)

// NewPrepareDEMStage creates a pipeline stage that decompresses dem.asc.gz,
// parses the elevation grid, and georeferences it as a GeoTIFF.
func NewPrepareDEMStage(tools ToolSet) Stage {
	return Stage{
		Name:     "prepare_dem",
		Optional: true,
		Run: func(ctx context.Context, job *Job) error {
			demGz := filepath.Join(job.InputPath, "dem.asc.gz")
			if _, err := os.Stat(demGz); err != nil {
				return fmt.Errorf("dem.asc.gz not found: %w", err)
			}

			// Decompress dem.asc.gz
			ascPath := filepath.Join(job.TempDir, "dem.asc")
			if err := decompressGz(demGz, ascPath); err != nil {
				return fmt.Errorf("decompress DEM: %w", err)
			}
			log.Printf("Decompressed DEM to %s", ascPath)

			// Parse the grid for elevation data (used by heightmap, contours, metadata)
			grid, err := ParseASCGridGz(demGz)
			if err != nil {
				return fmt.Errorf("parse DEM grid: %w", err)
			}
			job.DEMGrid = grid
			log.Printf("DEM grid: %dx%d, cellSize=%.1f", grid.Cols, grid.Rows, grid.CellSize)

			// Georeference to GeoTIFF using gdal_translate
			gdalTranslate, ok := tools.FindTool("gdal_translate")
			if !ok {
				return fmt.Errorf("gdal_translate not found")
			}

			worldSizeDeg := float64(job.WorldSize) / float64(metersPerDegree)
			demTif := filepath.Join(job.TempDir, "dem.tif")
			args := []string{
				"-of", "GTiff",
				"-ot", "Float32",
				"-a_srs", "EPSG:4326",
				"-a_ullr",
				"0",
				fmt.Sprintf("%f", worldSizeDeg),
				fmt.Sprintf("%f", worldSizeDeg),
				"0",
				ascPath,
				demTif,
			}

			log.Printf("Georeferencing DEM → %s", demTif)
			if err := runCmd(ctx, gdalTranslate.Path, args...); err != nil {
				return fmt.Errorf("gdal_translate DEM: %w", err)
			}

			// Fill nodata holes (matching Python: gdal_fillnodata.py -md 25)
			fillNodata, hasFill := tools.FindTool("gdal_fillnodata.py")
			if hasFill {
				log.Printf("Filling DEM nodata holes")
				demFilled := filepath.Join(job.TempDir, "dem-filled.tif")
				if err := runCmd(ctx, fillNodata.Path, "-md", "25", demTif, demFilled); err != nil {
					log.Printf("WARNING: gdal_fillnodata failed: %v", err)
				} else {
					// Replace original with filled version
					if err := os.Rename(demFilled, demTif); err != nil {
						log.Printf("WARNING: rename filled DEM: %v", err)
					}
				}
			}

			job.DEMPath = demTif
			return nil
		},
	}
}

// decompressGz decompresses a .gz file to the given output path.
func decompressGz(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	gz, err := gzip.NewReader(in)
	if err != nil {
		return err
	}
	defer gz.Close()

	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()

	if _, err := io.Copy(out, gz); err != nil {
		return err
	}
	return nil
}
