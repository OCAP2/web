package maptool

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
)

// colorReliefGuide is the color guide matching the Python arma3-maptiler.
const colorReliefGuide = `-11000  0    0    0
-500    0    0    10
-300    0    0    20
-200    0    0    70
-100    0    0    130
-50     0    0    205
0       0    255  255
0.1     57   151  105
50      117  194  93
150     230  230  128
250     202  158  75
350     214  187  98
450     185  154  100
550     220  220  220
650     250  250  250
750     255  255  255
nv      255  255  255
`

// NewGenerateColorReliefStage creates a pipeline stage that generates a color relief
// raster from the DEM GeoTIFF and packages it as PMTiles.
func NewGenerateColorReliefStage(tools ToolSet) Stage {
	return Stage{
		Name:     "generate_colorrelief",
		Optional: true,
		Run: func(ctx context.Context, job *Job) error {
			if job.DEMPath == "" {
				return fmt.Errorf("DEM not available")
			}

			gdalDem, ok := tools.FindTool("gdaldem")
			if !ok {
				return fmt.Errorf("gdaldem not found")
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

			// Write color guide to temp file
			guidePath := filepath.Join(job.TempDir, "color-relief-guide.txt")
			if err := os.WriteFile(guidePath, []byte(colorReliefGuide), 0644); err != nil {
				return fmt.Errorf("write color guide: %w", err)
			}

			// Generate color relief
			colorReliefTif := filepath.Join(job.TempDir, "color-relief.tif")
			{
				args := []string{
					"color-relief",
					job.DEMPath,
					guidePath,
					colorReliefTif,
				}
				log.Printf("Generating color relief")
				if err := runCmd(ctx, gdalDem.Path, args...); err != nil {
					return fmt.Errorf("gdaldem color-relief: %w", err)
				}
			}

			// Convert to MBTiles → PMTiles
			mbtilesPath := filepath.Join(job.TempDir, "color-relief.mbtiles")
			if err := RasterToMBTiles(ctx, gdalTranslate.Path, colorReliefTif, mbtilesPath,
				"color-relief", 8, 18, "PNG", "AVERAGE"); err != nil {
				return err
			}

			if hasAddo {
				if err := AddOverviews(ctx, gdalAddo.Path, mbtilesPath); err != nil {
					log.Printf("WARNING: gdaladdo failed: %v", err)
				}
			}

			outputPath := filepath.Join(job.TilesOutputDir(), "color-relief.pmtiles")
			if err := MBTilesToPMTiles(ctx, pmtilesBin.Path, mbtilesPath, outputPath); err != nil {
				return err
			}

			job.HasColorRelief = true
			log.Printf("Generated %s", outputPath)
			return nil
		},
	}
}
