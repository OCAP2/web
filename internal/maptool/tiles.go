package maptool

import (
	"context"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
)

// MercatorZoomForWorld calculates appropriate min and max web-mercator zoom levels
// for a georeferenced world placed at the equator in EPSG:4326.
//
// At zoom z, one 256px tile covers 360/2^z degrees.
// The world covers worldSize/metersPerDegree degrees.
//
// minZoom: smallest z where the world fills at least one tile.
// maxZoom: smallest z where tile resolution is at least as fine as the source image.
func MercatorZoomForWorld(worldSize, imageSize int) (minZoom, maxZoom int) {
	worldDeg := float64(worldSize) / metersPerDegree
	// minZoom: 360/2^z ≤ worldDeg → z = floor(log2(360/worldDeg))
	minZoom = int(math.Floor(math.Log2(360.0 / worldDeg)))
	// maxZoom: tile pixel size ≤ source pixel size
	// 360/(2^z * 256) ≤ worldDeg/imageSize → z = ceil(log2(360*imageSize/(256*worldDeg)))
	maxZoom = int(math.Ceil(math.Log2(360.0 * float64(imageSize) / (256.0 * worldDeg))))
	return minZoom, maxZoom
}

func buildGdal2tilesArgs(inputImage, outputDir string, minZoom, maxZoom int) []string {
	return []string{
		"--profile=mercator",
		"-z", fmt.Sprintf("%d-%d", minZoom, maxZoom),
		"-r", "average",
		"--processes=4",
		"-w", "none",
		inputImage,
		outputDir,
	}
}

func buildPmtilesConvertArgs(tilesDir, outputPath string) []string {
	return []string{"convert", tilesDir, outputPath}
}

func GenerateTiles(ctx context.Context, tools ToolSet, inputImage, outputDir string, minZoom, maxZoom int) error {
	var gdalTool Tool
	for _, t := range tools {
		if t.Name == "gdal2tiles.py" && t.Found {
			gdalTool = t
			break
		}
	}
	if !gdalTool.Found {
		return fmt.Errorf("gdal2tiles.py not found")
	}

	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return fmt.Errorf("create tiles dir: %w", err)
	}

	args := buildGdal2tilesArgs(inputImage, outputDir, minZoom, maxZoom)
	cmd := exec.CommandContext(ctx, gdalTool.Path, args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("gdal2tiles: %w", err)
	}
	return nil
}

func PackagePMTiles(ctx context.Context, tools ToolSet, tilesDir, outputPath string) error {
	var pmtilesTool Tool
	for _, t := range tools {
		if t.Name == "pmtiles" && t.Found {
			pmtilesTool = t
			break
		}
	}
	if !pmtilesTool.Found {
		return fmt.Errorf("pmtiles CLI not found")
	}

	args := buildPmtilesConvertArgs(tilesDir, outputPath)
	cmd := exec.CommandContext(ctx, pmtilesTool.Path, args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("pmtiles convert: %w", err)
	}
	return nil
}

func NewGenerateTilesStage(tools ToolSet) Stage {
	return Stage{
		Name: "generate_tiles",
		Run: func(ctx context.Context, job *Job) error {
			tilesDir := filepath.Join(job.TempDir, "tiles")
			job.MinZoom, job.MaxZoom = MercatorZoomForWorld(job.WorldSize, job.ImageSize)
			if err := GenerateTiles(ctx, tools, job.SatImage, tilesDir, job.MinZoom, job.MaxZoom); err != nil {
				return err
			}
			job.TilesDir = tilesDir
			return nil
		},
	}
}

func NewPackagePMTilesStage(tools ToolSet) Stage {
	return Stage{
		Name: "package_pmtiles",
		Run: func(ctx context.Context, job *Job) error {
			// Convert tile directory to MBTiles first (pmtiles convert requires MBTiles input)
			mbtilesPath := filepath.Join(job.TempDir, "tiles.mbtiles")
			if err := TilesToMBTiles(job.TilesDir, mbtilesPath); err != nil {
				return fmt.Errorf("create mbtiles: %w", err)
			}

			outputPath := filepath.Join(job.OutputDir, "topo.pmtiles")
			return PackagePMTiles(ctx, tools, mbtilesPath, outputPath)
		},
	}
}
