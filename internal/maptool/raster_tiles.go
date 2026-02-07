package maptool

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
)

// runCmd executes a command, streaming output to stdout/stderr in real time
// while also capturing it. On error, the captured output is included in the
// error message for diagnostics.
func runCmd(ctx context.Context, name string, args ...string) error {
	var buf bytes.Buffer
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Stdout = io.MultiWriter(os.Stdout, &buf)
	cmd.Stderr = io.MultiWriter(os.Stderr, &buf)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("%w\nOutput:\n%s", err, buf.String())
	}
	return nil
}

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
	return runCmd(ctx, gdalTranslate, args...)
}

// AddOverviews adds overview levels to an MBTiles file using gdaladdo.
func AddOverviews(ctx context.Context, gdalAddo, mbtiles string) error {
	log.Printf("gdaladdo %s", mbtiles)
	return runCmd(ctx, gdalAddo, "-r", "average", mbtiles, "2", "4", "8", "16")
}

// MBTilesToPMTiles converts MBTiles to PMTiles using the pmtiles CLI.
func MBTilesToPMTiles(ctx context.Context, pmtilesBin, input, output string) error {
	log.Printf("pmtiles convert → %s", output)
	return runCmd(ctx, pmtilesBin, "convert", input, output)
}
