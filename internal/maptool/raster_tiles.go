package maptool

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

// runCmd executes a command, capturing output silently. On success it logs the
// duration; on error the captured output is included in the error message.
// Output is not streamed to stdout/stderr to avoid garbled progress bars when
// multiple commands run in parallel.
func runCmd(ctx context.Context, name string, args ...string) error {
	start := time.Now()
	var buf bytes.Buffer
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Stdout = &buf
	cmd.Stderr = &buf
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("%w\nOutput:\n%s", err, buf.String())
	}
	log.Printf("%s completed in %s", filepath.Base(name), time.Since(start).Round(time.Millisecond))
	return nil
}

// RasterToMBTiles converts a raster image to MBTiles using gdal_translate.
func RasterToMBTiles(ctx context.Context, gdalTranslate, input, output, name string,
	minZ, maxZ int, tileFormat, resampling string) error {

	// Remove stale output to avoid "readonly database" errors on re-runs
	os.Remove(output)

	args := []string{
		"--config", "GDAL_NUM_THREADS", "ALL_CPUS",
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
	return runCmd(ctx, gdalAddo, "--config", "GDAL_NUM_THREADS", "ALL_CPUS",
		"-r", "average", mbtiles, "2", "4", "8", "16")
}

// MBTilesToPMTiles converts MBTiles to PMTiles using the pmtiles CLI.
func MBTilesToPMTiles(ctx context.Context, pmtilesBin, input, output string) error {
	log.Printf("pmtiles convert → %s", output)
	return runCmd(ctx, pmtilesBin, "convert", input, output)
}
