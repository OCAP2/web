package maptool

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
)

// NewGenerateHillshadeStage creates a pipeline stage that generates a hillshade
// raster from the DEM GeoTIFF and packages it as PMTiles.
func NewGenerateHillshadeStage(tools ToolSet) Stage {
	return Stage{
		Name:     "generate_hillshade",
		Optional: true,
		Run: func(ctx context.Context, job *Job) error {
			if job.DEMPath == "" {
				return fmt.Errorf("DEM not available")
			}

			gdalCalc, hasCalc := tools.FindTool("gdal_calc.py")
			gdalDem, ok := tools.FindTool("gdaldem")
			if !ok {
				return fmt.Errorf("gdaldem not found")
			}
			gdalBuildVrt, ok := tools.FindTool("gdalbuildvrt")
			if !ok {
				return fmt.Errorf("gdalbuildvrt not found")
			}
			gdalTranslate, ok := tools.FindTool("gdal_translate")
			if !ok {
				return fmt.Errorf("gdal_translate not found")
			}
			pmtilesBin, ok := tools.FindTool("pmtiles")
			if !ok {
				return fmt.Errorf("pmtiles not found")
			}
			gdalAddo, hasAddo := tools.FindTool("gdaladdo")

			demInput := job.DEMPath

			// 1. Mask below sea level (keep only elevation > 0)
			if hasCalc {
				demAboveSea := filepath.Join(job.TempDir, "dem-above-sea.tif")
				args := []string{
					"-A", job.DEMPath,
					"--outfile=" + demAboveSea,
					"--calc=A*(A>=0)",
					"--NoDataValue=0",
					"--overwrite",
				}
				log.Printf("Masking DEM below sea level")
				cmd := exec.CommandContext(ctx, gdalCalc.Path, args...)
				cmd.Stdout = os.Stdout
				cmd.Stderr = os.Stderr
				if err := cmd.Run(); err != nil {
					return fmt.Errorf("gdal_calc (mask sea level): %w", err)
				}
				demInput = demAboveSea
			}

			// 2. Generate hillshade
			hillshadeTif := filepath.Join(job.TempDir, "hillshade.tif")
			{
				args := []string{
					"hillshade",
					demInput,
					hillshadeTif,
					"-alg", "ZevenbergenThorne",
					"-multidirectional",
					"-z", "1.0",
					"-s", "1.0",
					"-alt", "45.0",
					"-compute_edges",
					"-co", "COMPRESS=LZW",
					"-co", "PREDICTOR=2",
					"-co", "NUM_THREADS=ALL_CPUS",
				}
				log.Printf("Generating hillshade")
				cmd := exec.CommandContext(ctx, gdalDem.Path, args...)
				cmd.Stdout = os.Stdout
				cmd.Stderr = os.Stderr
				if err := cmd.Run(); err != nil {
					return fmt.Errorf("gdaldem hillshade: %w", err)
				}
			}

			// 3. Invert for alpha channel
			var hillshadeInvTif string
			if hasCalc {
				hillshadeInvTif = filepath.Join(job.TempDir, "hillshade-inv.tif")
				args := []string{
					"-A", hillshadeTif,
					"--outfile=" + hillshadeInvTif,
					"--calc=255-A",
					"--NoDataValue=0",
					"--overwrite",
				}
				log.Printf("Inverting hillshade for alpha")
				cmd := exec.CommandContext(ctx, gdalCalc.Path, args...)
				cmd.Stdout = os.Stdout
				cmd.Stderr = os.Stderr
				if err := cmd.Run(); err != nil {
					return fmt.Errorf("gdal_calc (invert): %w", err)
				}
			}

			// 4. Merge to RGBA VRT (hillshade RGB + inverted alpha)
			hillshadeRgba := filepath.Join(job.TempDir, "hillshade-rgba.tif")
			if hasCalc && hillshadeInvTif != "" {
				mergeVrt := filepath.Join(job.TempDir, "hillshade-merge.vrt")
				{
					args := []string{
						"-separate",
						mergeVrt,
						hillshadeTif, hillshadeTif, hillshadeTif, hillshadeInvTif,
					}
					log.Printf("Building hillshade RGBA VRT")
					cmd := exec.CommandContext(ctx, gdalBuildVrt.Path, args...)
					cmd.Stdout = os.Stdout
					cmd.Stderr = os.Stderr
					if err := cmd.Run(); err != nil {
						return fmt.Errorf("gdalbuildvrt: %w", err)
					}
				}

				// 5. Convert to RGBA GeoTIFF
				{
					args := []string{
						"-of", "GTiff",
						"-colorinterp_4", "alpha",
						"-co", "TILED=YES",
						"-co", "COMPRESS=LZW",
						mergeVrt,
						hillshadeRgba,
					}
					log.Printf("Converting hillshade to RGBA GeoTIFF")
					cmd := exec.CommandContext(ctx, gdalTranslate.Path, args...)
					cmd.Stdout = os.Stdout
					cmd.Stderr = os.Stderr
					if err := cmd.Run(); err != nil {
						return fmt.Errorf("gdal_translate (RGBA): %w", err)
					}
				}
			} else {
				// Without gdal_calc, just use the raw hillshade (no alpha)
				hillshadeRgba = hillshadeTif
			}

			// 6. Convert to MBTiles → PMTiles
			mbtilesPath := filepath.Join(job.TempDir, "hillshade.mbtiles")
			if err := RasterToMBTiles(ctx, gdalTranslate.Path, hillshadeRgba, mbtilesPath,
				"hillshade", 8, 18, "PNG", "LANCZOS"); err != nil {
				return err
			}

			if hasAddo {
				if err := AddOverviews(ctx, gdalAddo.Path, mbtilesPath); err != nil {
					log.Printf("WARNING: gdaladdo failed: %v", err)
				}
			}

			outputPath := filepath.Join(job.TilesOutputDir(), "hillshade.pmtiles")
			if err := MBTilesToPMTiles(ctx, pmtilesBin.Path, mbtilesPath, outputPath); err != nil {
				return err
			}

			job.HasHillshade = true
			log.Printf("Generated %s", outputPath)
			return nil
		},
	}
}
