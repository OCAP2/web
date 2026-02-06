package maptool

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
)

// RasterToMBTiles converts a raster image to MBTiles using gdal_translate.
func RasterToMBTiles(ctx context.Context, gdalTranslate, input, output, name string,
	minZ, maxZ int, tileFormat, resampling string) error {

	// Remove stale output to avoid "readonly database" errors on re-runs
	os.Remove(output)

	args := []string{
		"-of", "MBTILES",
		"-co", "TYPE=baselayer",
		"-co", "QUALITY=80",
		"-co", fmt.Sprintf("NAME=%s", name),
		"-co", fmt.Sprintf("TILE_FORMAT=%s", tileFormat),
		"-co", "ZLEVEL=9",
		"-co", fmt.Sprintf("RESAMPLING=%s", resampling),
		"-co", fmt.Sprintf("MINZOOM=%d", minZ),
		"-co", fmt.Sprintf("MAXZOOM=%d", maxZ),
		"-co", "BLOCKSIZE=256",
		input,
		output,
	}

	log.Printf("gdal_translate → %s (z%d-%d, %s, %s)", output, minZ, maxZ, tileFormat, resampling)
	cmd := exec.CommandContext(ctx, gdalTranslate, args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("gdal_translate: %w", err)
	}
	return nil
}

// AddOverviews adds overview levels to an MBTiles file using gdaladdo.
func AddOverviews(ctx context.Context, gdalAddo, mbtiles string) error {
	args := []string{"-r", "average", mbtiles, "2", "4", "8", "16"}
	log.Printf("gdaladdo %s", mbtiles)
	cmd := exec.CommandContext(ctx, gdalAddo, args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("gdaladdo: %w", err)
	}
	return nil
}

// MBTilesToPMTiles converts MBTiles to PMTiles using the pmtiles CLI.
func MBTilesToPMTiles(ctx context.Context, pmtilesBin, input, output string) error {
	args := []string{"convert", input, output}
	log.Printf("pmtiles convert → %s", output)
	cmd := exec.CommandContext(ctx, pmtilesBin, args...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("pmtiles convert: %w", err)
	}
	return nil
}
