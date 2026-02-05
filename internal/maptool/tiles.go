package maptool

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

func buildGdal2tilesArgs(inputImage, outputDir string, maxZoom int) []string {
	return []string{
		"--profile=raster",
		"-z", fmt.Sprintf("0-%d", maxZoom),
		"--processes=4",
		"-w", "none",
		inputImage,
		outputDir,
	}
}

func buildPmtilesConvertArgs(tilesDir, outputPath string) []string {
	return []string{"convert", tilesDir, outputPath}
}

func GenerateTiles(ctx context.Context, tools ToolSet, inputImage, outputDir string, maxZoom int) error {
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

	args := buildGdal2tilesArgs(inputImage, outputDir, maxZoom)
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
			maxZoom := 6
			if err := GenerateTiles(ctx, tools, job.SatImage, tilesDir, maxZoom); err != nil {
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
