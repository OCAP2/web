package maptool

import (
	"context"
	"fmt"
	"log"
	"path/filepath"
)

// hillshadeTools holds the common GDAL tools needed by hillshade stages.
type hillshadeTools struct {
	gdalDem       string
	gdalTranslate string
	pmtiles       string
	gdalAddo      string
	hasAddo       bool
}

// findHillshadeTools resolves the common tools needed by hillshade stages.
func findHillshadeTools(tools ToolSet) (hillshadeTools, error) {
	var ht hillshadeTools
	gdalDem, ok := tools.FindTool("gdaldem")
	if !ok {
		return ht, fmt.Errorf("gdaldem not found")
	}
	ht.gdalDem = gdalDem.Path

	gdalTranslate, ok := tools.FindTool("gdal_translate")
	if !ok {
		return ht, fmt.Errorf("gdal_translate not found")
	}
	ht.gdalTranslate = gdalTranslate.Path

	pmtilesBin, ok := tools.FindTool("pmtiles")
	if !ok {
		return ht, fmt.Errorf("pmtiles not found")
	}
	ht.pmtiles = pmtilesBin.Path

	gdalAddo, hasAddo := tools.FindTool("gdaladdo")
	ht.gdalAddo = gdalAddo.Path
	ht.hasAddo = hasAddo
	return ht, nil
}

// rasterToPMTiles converts a GeoTIFF to PMTiles via MBTiles, with optional overviews.
func rasterToPMTiles(ctx context.Context, ht hillshadeTools, inputTif, mbtilesPath, outputPath, name string) error {
	if err := RasterToMBTiles(ctx, ht.gdalTranslate, inputTif, mbtilesPath,
		name, 8, 18, "PNG", "LANCZOS"); err != nil {
		return err
	}

	if ht.hasAddo {
		if err := AddOverviews(ctx, ht.gdalAddo, mbtilesPath); err != nil {
			log.Printf("WARNING: gdaladdo failed: %v", err)
		}
	}

	return MBTilesToPMTiles(ctx, ht.pmtiles, mbtilesPath, outputPath)
}

// NewGenerateHillshadeFullStage creates a pipeline stage that generates a hillshade
// raster from the full DEM (including underwater terrain) and packages it as PMTiles.
// Unlike the land-only hillshade, this does not mask below sea level.
func NewGenerateHillshadeFullStage(tools ToolSet) Stage {
	return Stage{
		Name:     "generate_hillshade_full",
		Optional: true,
		Run: func(ctx context.Context, job *Job) error {
			if job.DEMPath == "" {
				return fmt.Errorf("DEM not available")
			}

			ht, err := findHillshadeTools(tools)
			if err != nil {
				return err
			}

			// Generate hillshade from full DEM (no sea masking)
			hillshadeTif := filepath.Join(job.TempDir, "hillshade-full.tif")
			log.Printf("Generating full hillshade (including underwater)")
			if err := runCmd(ctx, ht.gdalDem,
				"hillshade", job.DEMPath, hillshadeTif,
				"-alg", "ZevenbergenThorne",
				"-multidirectional",
				"-z", "1.0", "-s", "1.0", "-alt", "45.0",
				"-compute_edges",
				"-co", "COMPRESS=LZW", "-co", "PREDICTOR=2", "-co", "NUM_THREADS=ALL_CPUS",
			); err != nil {
				return fmt.Errorf("gdaldem hillshade-full: %w", err)
			}

			// Convert to PMTiles
			mbtilesPath := filepath.Join(job.TempDir, "hillshade-full.mbtiles")
			outputPath := filepath.Join(job.TilesOutputDir(), "hillshade-full.pmtiles")
			if err := rasterToPMTiles(ctx, ht, hillshadeTif, mbtilesPath, outputPath, "hillshade-full"); err != nil {
				return err
			}

			job.HasHillshadeFull = true
			log.Printf("Generated %s", outputPath)
			return nil
		},
	}
}

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

			ht, err := findHillshadeTools(tools)
			if err != nil {
				return err
			}
			gdalCalc, hasCalc := tools.FindTool("gdal_calc.py")
			gdalBuildVrt, ok := tools.FindTool("gdalbuildvrt")
			if !ok {
				return fmt.Errorf("gdalbuildvrt not found")
			}

			demInput := job.DEMPath

			// 1. Mask below sea level (keep only elevation > 0)
			if hasCalc {
				demAboveSea := filepath.Join(job.TempDir, "dem-above-sea.tif")
				log.Printf("Masking DEM below sea level")
				if err := runCmd(ctx, gdalCalc.Path,
					"-A", job.DEMPath,
					"--outfile="+demAboveSea,
					"--calc=A*(A>=0)",
					"--NoDataValue=0",
					"--overwrite",
				); err != nil {
					return fmt.Errorf("gdal_calc (mask sea level): %w", err)
				}
				demInput = demAboveSea
			}

			// 2. Generate hillshade
			hillshadeTif := filepath.Join(job.TempDir, "hillshade.tif")
			{
				log.Printf("Generating hillshade")
				if err := runCmd(ctx, ht.gdalDem,
					"hillshade", demInput, hillshadeTif,
					"-alg", "ZevenbergenThorne",
					"-multidirectional",
					"-z", "1.0", "-s", "1.0", "-alt", "45.0",
					"-compute_edges",
					"-co", "COMPRESS=LZW", "-co", "PREDICTOR=2", "-co", "NUM_THREADS=ALL_CPUS",
				); err != nil {
					return fmt.Errorf("gdaldem hillshade: %w", err)
				}
			}

			// 3. Invert for alpha channel
			var hillshadeInvTif string
			if hasCalc {
				hillshadeInvTif = filepath.Join(job.TempDir, "hillshade-inv.tif")
				log.Printf("Inverting hillshade for alpha")
				if err := runCmd(ctx, gdalCalc.Path,
					"-A", hillshadeTif,
					"--outfile="+hillshadeInvTif,
					"--calc=255-A",
					"--NoDataValue=0",
					"--overwrite",
				); err != nil {
					return fmt.Errorf("gdal_calc (invert): %w", err)
				}
			}

			// 4. Merge to RGBA VRT (hillshade RGB + inverted alpha)
			hillshadeRgba := filepath.Join(job.TempDir, "hillshade-rgba.tif")
			if hasCalc && hillshadeInvTif != "" {
				mergeVrt := filepath.Join(job.TempDir, "hillshade-merge.vrt")
				log.Printf("Building hillshade RGBA VRT")
				if err := runCmd(ctx, gdalBuildVrt.Path,
					"-separate", mergeVrt,
					hillshadeTif, hillshadeTif, hillshadeTif, hillshadeInvTif,
				); err != nil {
					return fmt.Errorf("gdalbuildvrt: %w", err)
				}

				// 5. Convert to RGBA GeoTIFF
				log.Printf("Converting hillshade to RGBA GeoTIFF")
				if err := runCmd(ctx, ht.gdalTranslate,
					"-of", "GTiff",
					"-colorinterp_4", "alpha",
					"-co", "TILED=YES", "-co", "COMPRESS=LZW",
					mergeVrt, hillshadeRgba,
				); err != nil {
					return fmt.Errorf("gdal_translate (RGBA): %w", err)
				}
			} else {
				// Without gdal_calc, just use the raw hillshade (no alpha)
				hillshadeRgba = hillshadeTif
			}

			// 6. Convert to PMTiles
			mbtilesPath := filepath.Join(job.TempDir, "hillshade.mbtiles")
			outputPath := filepath.Join(job.TilesOutputDir(), "hillshade.pmtiles")
			if err := rasterToPMTiles(ctx, ht, hillshadeRgba, mbtilesPath, outputPath, "hillshade"); err != nil {
				return err
			}

			job.HasHillshade = true
			log.Printf("Generated %s", outputPath)
			return nil
		},
	}
}
