package maptool

import (
	"context"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"log"
	"os"
	"path/filepath"
)

// NewGenerateHeightmapStage creates a pipeline stage that encodes a DEM grid
// as Mapbox terrain-RGB tiles. Requires job.DEMGrid to be populated.
func NewGenerateHeightmapStage(tools ToolSet) Stage {
	return Stage{
		Name:     "generate_heightmap",
		Optional: true,
		Run: func(ctx context.Context, job *Job) error {
			if job.DEMGrid == nil || job.DEMPath == "" {
				return fmt.Errorf("DEM not available")
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

			grid := job.DEMGrid

			// Encode to Mapbox terrain-RGB PNG
			rgbPath := filepath.Join(job.TempDir, "heightmap-rgb.png")
			if err := encodeTerrainRGB(grid, rgbPath); err != nil {
				return fmt.Errorf("encode terrain-RGB: %w", err)
			}

			// Create georeferenced VRT pointing to the RGB PNG
			vrtPath := filepath.Join(job.TempDir, "heightmap.vrt")
			if err := writeHeightmapVRT(vrtPath, rgbPath, grid.Cols, grid.Rows, job.WorldSize); err != nil {
				return fmt.Errorf("write heightmap VRT: %w", err)
			}

			// Convert to MBTiles → PMTiles
			mbtilesPath := filepath.Join(job.TempDir, "heightmap.mbtiles")
			if err := RasterToMBTiles(ctx, gdalTranslate.Path, vrtPath, mbtilesPath,
				"heightmap", 11, 14, "PNG", "LANCZOS"); err != nil {
				return err
			}

			if hasAddo {
				if err := AddOverviews(ctx, gdalAddo.Path, mbtilesPath); err != nil {
					log.Printf("WARNING: gdaladdo failed: %v", err)
				}
			}

			outputPath := filepath.Join(job.TilesOutputDir(), "heightmap.pmtiles")
			if err := MBTilesToPMTiles(ctx, pmtilesBin.Path, mbtilesPath, outputPath); err != nil {
				return err
			}
			os.Remove(mbtilesPath)

			job.HasHeightmap = true
			log.Printf("Generated %s", outputPath)
			return nil
		},
	}
}

// encodeTerrainRGB encodes a DEMGrid into a Mapbox terrain-RGB PNG.
// Formula: val = int((height + 10000) * 10); R = val>>16, G = (val>>8)&0xFF, B = val&0xFF
func encodeTerrainRGB(grid *DEMGrid, outputPath string) error {
	img := image.NewNRGBA(image.Rect(0, 0, grid.Cols, grid.Rows))

	for row := 0; row < grid.Rows; row++ {
		for col := 0; col < grid.Cols; col++ {
			// DEMGrid has row 0 = south, but PNG row 0 = top (north)
			srcRow := grid.Rows - 1 - row
			height := float64(grid.Data[srcRow*grid.Cols+col])

			val := int((height + 10000) * 10)
			if val < 0 {
				val = 0
			}
			r := byte(val >> 16)
			g := byte((val >> 8) & 0xFF)
			b := byte(val & 0xFF)

			img.SetNRGBA(col, row, color.NRGBA{R: r, G: g, B: b, A: 255})
		}
	}

	f, err := os.Create(outputPath)
	if err != nil {
		return err
	}
	defer f.Close()

	log.Printf("Encoded terrain-RGB: %dx%d pixels", grid.Cols, grid.Rows)
	return png.Encode(f, img)
}

// writeHeightmapVRT creates a georeferenced VRT for the heightmap RGB PNG.
func writeHeightmapVRT(vrtPath, pngPath string, cols, rows, worldSize int) error {
	vrtDir := filepath.Dir(vrtPath)
	relPng, err := filepath.Rel(vrtDir, pngPath)
	if err != nil {
		relPng = pngPath
	}

	worldSizeDeg := float64(worldSize) / float64(metersPerDegree)
	pixelSizeX := worldSizeDeg / float64(cols)
	pixelSizeY := worldSizeDeg / float64(rows)

	f, err := os.Create(vrtPath)
	if err != nil {
		return err
	}
	defer f.Close()

	fmt.Fprintf(f, "<VRTDataset rasterXSize=\"%d\" rasterYSize=\"%d\">\n", cols, rows)
	fmt.Fprintf(f, "  <SRS>EPSG:4326</SRS>\n")
	fmt.Fprintf(f, "  <GeoTransform>%.15e, %.15e, 0, %.15e, 0, -%.15e</GeoTransform>\n",
		0.0, pixelSizeX, worldSizeDeg, pixelSizeY)

	bands := []struct {
		num   int
		color string
	}{{1, "Red"}, {2, "Green"}, {3, "Blue"}}

	for _, band := range bands {
		fmt.Fprintf(f, "  <VRTRasterBand dataType=\"Byte\" band=\"%d\">\n", band.num)
		fmt.Fprintf(f, "    <ColorInterp>%s</ColorInterp>\n", band.color)
		fmt.Fprintf(f, "    <SimpleSource>\n")
		fmt.Fprintf(f, "      <SourceFilename relativeToVRT=\"1\">%s</SourceFilename>\n", relPng)
		fmt.Fprintf(f, "      <SourceBand>%d</SourceBand>\n", band.num)
		fmt.Fprintf(f, "      <SrcRect xOff=\"0\" yOff=\"0\" xSize=\"%d\" ySize=\"%d\" />\n", cols, rows)
		fmt.Fprintf(f, "      <DstRect xOff=\"0\" yOff=\"0\" xSize=\"%d\" ySize=\"%d\" />\n", cols, rows)
		fmt.Fprintf(f, "    </SimpleSource>\n")
		fmt.Fprintf(f, "  </VRTRasterBand>\n")
	}

	fmt.Fprintf(f, "</VRTDataset>\n")
	return nil
}
