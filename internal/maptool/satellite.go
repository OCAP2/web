package maptool

import (
	"context"
	"fmt"
	"image"
	_ "image/png" // register PNG decoder
	"log"
	"os"
	"path/filepath"
	"strconv"
)

// SatTile represents a decoded satellite tile with its grid position.
type SatTile struct {
	X       int    // grid X coordinate
	Y       int    // grid Y coordinate
	Width   int    // decoded image width in pixels
	Height  int    // decoded image height in pixels
	PNGPath string // path to decoded PNG file
}

// metersPerDegree is the number of meters per degree of longitude at the equator.
// Must match METERS_PER_DEGREE in static/scripts/ocap.js.
const metersPerDegree = 111320

// ScanGradMehSatTiles scans a grad_meh sat/ directory for PNG tiles.
// The directory structure is sat/{X}/{Y}.png.
// Returns the tiles, the detected tile pixel size, and any error.
func ScanGradMehSatTiles(satDir string) ([]SatTile, int, error) {
	xDirs, err := os.ReadDir(satDir)
	if err != nil {
		return nil, 0, fmt.Errorf("read sat dir: %w", err)
	}

	var tiles []SatTile
	tileSize := 0

	for _, xEntry := range xDirs {
		if !xEntry.IsDir() {
			continue
		}
		x, err := strconv.Atoi(xEntry.Name())
		if err != nil {
			continue // skip non-numeric dirs
		}

		yDir := filepath.Join(satDir, xEntry.Name())
		yEntries, err := os.ReadDir(yDir)
		if err != nil {
			continue
		}

		for _, yEntry := range yEntries {
			if yEntry.IsDir() {
				continue
			}
			ext := filepath.Ext(yEntry.Name())
			if ext != ".png" {
				continue
			}
			yStr := yEntry.Name()[:len(yEntry.Name())-len(ext)]
			y, err := strconv.Atoi(yStr)
			if err != nil {
				continue
			}

			pngPath := filepath.Join(yDir, yEntry.Name())

			// Read image dimensions from PNG header (no full decode)
			w, h, err := imageDimensions(pngPath)
			if err != nil {
				log.Printf("WARNING: skipping sat tile %s: %v", pngPath, err)
				continue
			}

			if tileSize == 0 {
				tileSize = w
			}

			tiles = append(tiles, SatTile{
				X:       x,
				Y:       y,
				Width:   w,
				Height:  h,
				PNGPath: pngPath,
			})
		}
	}

	if len(tiles) == 0 {
		return nil, 0, fmt.Errorf("no satellite tiles found in %s", satDir)
	}

	return tiles, tileSize, nil
}

// imageDimensions reads just the image header to get dimensions without decoding pixels.
func imageDimensions(path string) (int, int, error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, 0, err
	}
	defer f.Close()

	cfg, _, err := image.DecodeConfig(f)
	if err != nil {
		return 0, 0, fmt.Errorf("decode config: %w", err)
	}
	return cfg.Width, cfg.Height, nil
}

// BuildGradMehVRT creates a georeferenced GDAL VRT from grad_meh satellite tiles.
//
// grad_meh tiles have no overlap, so each tile occupies
// tileSize × tileSize pixels at position (X*tileSize, Y*tileSize).
// The VRT canvas is worldSize×worldSize pixels (1 pixel = 1 meter),
// georeferenced at the equator in EPSG:4326.
func BuildGradMehVRT(vrtPath string, tiles []SatTile, tileSize, worldSize int) error {
	if len(tiles) == 0 {
		return fmt.Errorf("no tiles to build VRT from")
	}

	vrtDir := filepath.Dir(vrtPath)
	relTiles := make([]SatTile, len(tiles))
	for i, t := range tiles {
		rel, err := filepath.Rel(vrtDir, t.PNGPath)
		if err != nil {
			rel = t.PNGPath
		}
		relTiles[i] = SatTile{X: t.X, Y: t.Y, Width: t.Width, Height: t.Height, PNGPath: rel}
	}

	f, err := os.Create(vrtPath)
	if err != nil {
		return fmt.Errorf("create VRT: %w", err)
	}
	defer f.Close()

	imageSize := worldSize
	fmt.Fprintf(f, "<VRTDataset rasterXSize=\"%d\" rasterYSize=\"%d\">\n", imageSize, imageSize)

	// North-up GeoTransform: origin at (lon=0, lat=worldSizeDeg)
	worldSizeDeg := float64(worldSize) / float64(metersPerDegree)
	pixelSize := worldSizeDeg / float64(imageSize)
	fmt.Fprintf(f, "  <SRS>EPSG:4326</SRS>\n")
	fmt.Fprintf(f, "  <GeoTransform>%.15e, %.15e, 0, %.15e, 0, -%.15e</GeoTransform>\n",
		0.0, pixelSize, worldSizeDeg, pixelSize)

	bands := []struct {
		num   int
		color string
	}{{1, "Red"}, {2, "Green"}, {3, "Blue"}}

	for _, band := range bands {
		fmt.Fprintf(f, "  <VRTRasterBand dataType=\"Byte\" band=\"%d\">\n", band.num)
		fmt.Fprintf(f, "    <ColorInterp>%s</ColorInterp>\n", band.color)
		for _, t := range relTiles {
			xOff := t.X * tileSize
			yOff := t.Y * tileSize
			fmt.Fprintf(f, "    <SimpleSource>\n")
			fmt.Fprintf(f, "      <SourceFilename relativeToVRT=\"1\">%s</SourceFilename>\n", t.PNGPath)
			fmt.Fprintf(f, "      <SourceBand>%d</SourceBand>\n", band.num)
			fmt.Fprintf(f, "      <SrcRect xOff=\"0\" yOff=\"0\" xSize=\"%d\" ySize=\"%d\" />\n", t.Width, t.Height)
			fmt.Fprintf(f, "      <DstRect xOff=\"%d\" yOff=\"%d\" xSize=\"%d\" ySize=\"%d\" />\n",
				xOff, yOff, tileSize, tileSize)
			fmt.Fprintf(f, "    </SimpleSource>\n")
		}
		fmt.Fprintf(f, "  </VRTRasterBand>\n")
	}

	fmt.Fprintf(f, "</VRTDataset>\n")
	return nil
}

// NewGenerateSatellitePMTilesStage creates a pipeline stage that converts the satellite
// VRT directly to PMTiles using gdal_translate → MBTiles → pmtiles convert.
// This replaces the old gdal2tiles + tile-directory approach.
func NewGenerateSatellitePMTilesStage(tools ToolSet) Stage {
	return Stage{
		Name: "generate_satellite_tiles",
		Run: func(ctx context.Context, job *Job) error {
			gdalTranslate, ok := tools.FindTool("gdal_translate")
			if !ok {
				return fmt.Errorf("gdal_translate not found")
			}
			gdalAddo, hasAddo := tools.FindTool("gdaladdo")
			pmtilesBin, ok := tools.FindTool("pmtiles")
			if !ok {
				return fmt.Errorf("pmtiles not found")
			}

			_, job.MaxZoom = MercatorZoomForWorld(job.WorldSize, job.ImageSize)
			job.MinZoom = 8 // match Python: always start at z8

			if err := os.MkdirAll(job.TilesOutputDir(), 0755); err != nil {
				return fmt.Errorf("create tiles dir: %w", err)
			}

			mbtilesPath := filepath.Join(job.TempDir, "satellite.mbtiles")
			if err := RasterToMBTiles(ctx, gdalTranslate.Path, job.SatImage, mbtilesPath,
				"satellite", job.MinZoom, job.MaxZoom, "PNG", "LANCZOS"); err != nil {
				return err
			}

			if hasAddo {
				if err := AddOverviews(ctx, gdalAddo.Path, mbtilesPath); err != nil {
					log.Printf("WARNING: gdaladdo failed: %v", err)
				}
			}

			outputPath := filepath.Join(job.TilesOutputDir(), "satellite.pmtiles")
			return MBTilesToPMTiles(ctx, pmtilesBin.Path, mbtilesPath, outputPath)
		},
	}
}

// NewGradMehSatelliteStage creates a pipeline stage that scans grad_meh satellite tiles,
// builds a VRT, and populates job.SatImage and job.ImageSize.
func NewGradMehSatelliteStage() Stage {
	return Stage{
		Name: "process_satellite",
		Run: func(ctx context.Context, job *Job) error {
			satDir := filepath.Join(job.InputPath, "sat")
			tiles, tileSize, err := ScanGradMehSatTiles(satDir)
			if err != nil {
				return fmt.Errorf("scan satellite tiles: %w", err)
			}
			log.Printf("Found %d satellite tiles (%dx%d pixels each)", len(tiles), tileSize, tileSize)

			vrtPath := filepath.Join(job.TempDir, "satellite.vrt")
			if err := BuildGradMehVRT(vrtPath, tiles, tileSize, job.WorldSize); err != nil {
				return fmt.Errorf("build VRT: %w", err)
			}

			job.SatImage = vrtPath
			job.ImageSize = job.WorldSize
			log.Printf("Built VRT: %dx%d pixels, %d tiles", job.WorldSize, job.WorldSize, len(tiles))
			return nil
		},
	}
}
