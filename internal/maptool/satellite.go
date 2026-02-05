package maptool

import (
	"context"
	"fmt"
	"image/png"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"github.com/OCAP2/web/internal/maptool/paa"
)

// SatTile represents a decoded satellite tile with its grid position.
type SatTile struct {
	X       int    // grid X coordinate
	Y       int    // grid Y coordinate
	PNGPath string // path to decoded PNG file
}

// FindDataLayerPBOs finds data_layers PBOs that belong to the same map as mapPBOPath.
// Matches both the base file (map_stratis_data_layers.pbo) and grid-split files
// (map_altis_data_layers_00_00.pbo).
func FindDataLayerPBOs(mapPBOPath string) ([]string, error) {
	dir := filepath.Dir(mapPBOPath)
	base := filepath.Base(mapPBOPath)
	name := strings.TrimSuffix(base, filepath.Ext(base))

	pattern := filepath.Join(dir, name+"_data_layers*.pbo")
	matches, err := filepath.Glob(pattern)
	if err != nil {
		return nil, fmt.Errorf("glob data layers: %w", err)
	}
	sort.Strings(matches)
	return matches, nil
}

var satTilePattern = regexp.MustCompile(`^s_(\d+)_(\d+)_lco\.paa$`)

// ParseSatTileCoords extracts grid (X, Y) from a satellite tile filename like "s_020_024_lco.paa".
func ParseSatTileCoords(filename string) (x, y int, err error) {
	base := filepath.Base(filename)
	m := satTilePattern.FindStringSubmatch(base)
	if m == nil {
		return 0, 0, fmt.Errorf("not a satellite tile: %s", base)
	}
	x, _ = strconv.Atoi(m[1])
	y, _ = strconv.Atoi(m[2])
	return x, y, nil
}

// findSatTiles walks a directory tree and returns paths to all s_*_lco.paa files.
func findSatTiles(dir string) ([]string, error) {
	var tiles []string
	err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() && satTilePattern.MatchString(info.Name()) {
			tiles = append(tiles, path)
		}
		return nil
	})
	return tiles, err
}

// decodePAAToTile decodes a PAA file to PNG and returns a SatTile.
func decodePAAToTile(paaPath, pngDir string) (SatTile, error) {
	x, y, err := ParseSatTileCoords(filepath.Base(paaPath))
	if err != nil {
		return SatTile{}, err
	}

	f, err := os.Open(paaPath)
	if err != nil {
		return SatTile{}, fmt.Errorf("open PAA: %w", err)
	}
	defer f.Close()

	img, err := paa.Decode(f)
	if err != nil {
		return SatTile{}, fmt.Errorf("decode PAA: %w", err)
	}

	pngPath := filepath.Join(pngDir, fmt.Sprintf("s_%03d_%03d_lco.png", x, y))
	out, err := os.Create(pngPath)
	if err != nil {
		return SatTile{}, fmt.Errorf("create PNG: %w", err)
	}
	defer out.Close()

	if err := png.Encode(out, img); err != nil {
		return SatTile{}, fmt.Errorf("encode PNG: %w", err)
	}

	return SatTile{X: x, Y: y, PNGPath: pngPath}, nil
}

// convertTilesConcurrent decodes PAA tiles to PNG using a worker pool.
func convertTilesConcurrent(ctx context.Context, paaPaths []string, pngDir string) ([]SatTile, error) {
	if err := os.MkdirAll(pngDir, 0755); err != nil {
		return nil, fmt.Errorf("create PNG dir: %w", err)
	}

	workers := runtime.NumCPU()
	if workers > len(paaPaths) {
		workers = len(paaPaths)
	}

	type result struct {
		tile SatTile
		err  error
		path string
	}

	jobs := make(chan string, len(paaPaths))
	results := make(chan result, len(paaPaths))

	var wg sync.WaitGroup
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for paaPath := range jobs {
				if ctx.Err() != nil {
					return
				}
				tile, err := decodePAAToTile(paaPath, pngDir)
				results <- result{tile: tile, err: err, path: paaPath}
			}
		}()
	}

	for _, p := range paaPaths {
		jobs <- p
	}
	close(jobs)

	go func() {
		wg.Wait()
		close(results)
	}()

	var tiles []SatTile
	var failed int
	for r := range results {
		if r.err != nil {
			log.Printf("WARNING: skipping tile %s: %v", filepath.Base(r.path), r.err)
			failed++
			continue
		}
		tiles = append(tiles, r.tile)
	}

	if len(tiles) == 0 {
		return nil, fmt.Errorf("all %d tiles failed to decode", failed)
	}
	if failed > 0 {
		log.Printf("WARNING: %d/%d tiles failed to decode", failed, failed+len(tiles))
	}

	return tiles, nil
}

type vrtData struct {
	Width  int
	Height int
	Tiles  []SatTile
	MaxY   int
}

func (v vrtData) DstXOff(x int) int { return x * 512 }
func (v vrtData) DstYOff(y int) int { return (v.MaxY - y) * 512 }

// BuildVRT creates a GDAL VRT file referencing the given tiles.
// The VRT uses relative paths and applies Y-flip so tile (0,0) is at the bottom.
func BuildVRT(vrtPath string, tiles []SatTile, imageWidth, imageHeight int) error {
	if len(tiles) == 0 {
		return fmt.Errorf("no tiles to build VRT from")
	}

	v := vrtData{Width: imageWidth, Height: imageHeight}
	for _, t := range tiles {
		if t.Y > v.MaxY {
			v.MaxY = t.Y
		}
	}

	// Make PNGPath relative to VRT file location
	vrtDir := filepath.Dir(vrtPath)
	relTiles := make([]SatTile, len(tiles))
	for i, t := range tiles {
		rel, err := filepath.Rel(vrtDir, t.PNGPath)
		if err != nil {
			rel = t.PNGPath
		}
		relTiles[i] = SatTile{X: t.X, Y: t.Y, PNGPath: rel}
	}

	f, err := os.Create(vrtPath)
	if err != nil {
		return fmt.Errorf("create VRT: %w", err)
	}
	defer f.Close()

	fmt.Fprintf(f, "<VRTDataset rasterXSize=\"%d\" rasterYSize=\"%d\">\n", v.Width, v.Height)

	bands := []struct {
		num   int
		color string
	}{{1, "Red"}, {2, "Green"}, {3, "Blue"}}

	for _, band := range bands {
		fmt.Fprintf(f, "  <VRTRasterBand dataType=\"Byte\" band=\"%d\">\n", band.num)
		fmt.Fprintf(f, "    <ColorInterp>%s</ColorInterp>\n", band.color)
		for _, t := range relTiles {
			fmt.Fprintf(f, "    <SimpleSource>\n")
			fmt.Fprintf(f, "      <SourceFilename relativeToVRT=\"1\">%s</SourceFilename>\n", t.PNGPath)
			fmt.Fprintf(f, "      <SourceBand>%d</SourceBand>\n", band.num)
			fmt.Fprintf(f, "      <SrcRect xOff=\"0\" yOff=\"0\" xSize=\"512\" ySize=\"512\" />\n")
			fmt.Fprintf(f, "      <DstRect xOff=\"%d\" yOff=\"%d\" xSize=\"512\" ySize=\"512\" />\n",
				v.DstXOff(t.X), v.DstYOff(t.Y))
			fmt.Fprintf(f, "    </SimpleSource>\n")
		}
		fmt.Fprintf(f, "  </VRTRasterBand>\n")
	}

	fmt.Fprintf(f, "</VRTDataset>\n")
	return nil
}

// NewProcessSatelliteStage creates a pipeline stage that extracts satellite imagery
// from data_layers PBOs, decodes PAA tiles to PNG, and builds a GDAL VRT.
func NewProcessSatelliteStage(tools ToolSet) Stage {
	return Stage{
		Name: "process_satellite",
		Run: func(ctx context.Context, job *Job) error {
			// 1. Read WRP metadata
			wrpHdr, err := ReadWRPMeta(job.WRPPath)
			if err != nil {
				return fmt.Errorf("read WRP: %w", err)
			}
			job.WorldSize = wrpHdr.WorldSize()
			log.Printf("World size: %d meters", job.WorldSize)

			// 2. Look for satellite tiles in the already-extracted main PBO first
			//    (small maps like Stratis bundle them directly)
			paaPaths, err := findSatTiles(job.TempDir)
			if err != nil {
				return fmt.Errorf("find satellite tiles in main PBO: %w", err)
			}

			// 3. If none found, try data_layers PBOs (large maps split them out)
			if len(paaPaths) == 0 {
				dataLayerPBOs, err := FindDataLayerPBOs(job.InputPath)
				if err != nil {
					return fmt.Errorf("find data layers: %w", err)
				}
				if len(dataLayerPBOs) == 0 {
					stem := strings.TrimSuffix(filepath.Base(job.InputPath), filepath.Ext(job.InputPath))
					return fmt.Errorf("no satellite tiles found in main PBO and no data_layers PBOs found — upload %s_data_layers_*.pbo files alongside the main map PBO", stem)
				}
				log.Printf("Found %d data_layers PBOs", len(dataLayerPBOs))

				extractDir := filepath.Join(job.TempDir, "data_layers")
				for i, pboPath := range dataLayerPBOs {
					log.Printf("Extracting data layers PBO %d/%d: %s", i+1, len(dataLayerPBOs), filepath.Base(pboPath))
					subDir := filepath.Join(extractDir, fmt.Sprintf("dl_%02d", i))
					if err := ExtractPBO(ctx, tools, pboPath, subDir); err != nil {
						return fmt.Errorf("extract %s: %w", filepath.Base(pboPath), err)
					}
				}

				paaPaths, err = findSatTiles(extractDir)
				if err != nil {
					return fmt.Errorf("find satellite tiles: %w", err)
				}
				if len(paaPaths) == 0 {
					return fmt.Errorf("no satellite tiles (s_*_lco.paa) found in extracted data layers")
				}
			}
			log.Printf("Found %d satellite tiles", len(paaPaths))

			// 5. Decode PAA → PNG concurrently
			pngDir := filepath.Join(job.TempDir, "sat_png")
			tiles, err := convertTilesConcurrent(ctx, paaPaths, pngDir)
			if err != nil {
				return fmt.Errorf("convert tiles: %w", err)
			}
			log.Printf("Decoded %d satellite tiles to PNG", len(tiles))

			// 6. Build VRT
			// Image dimensions: (gridMax+1) × 512
			maxX, maxY := 0, 0
			for _, t := range tiles {
				if t.X > maxX {
					maxX = t.X
				}
				if t.Y > maxY {
					maxY = t.Y
				}
			}
			imageWidth := (maxX + 1) * 512
			imageHeight := (maxY + 1) * 512

			vrtPath := filepath.Join(job.TempDir, "satellite.vrt")
			if err := BuildVRT(vrtPath, tiles, imageWidth, imageHeight); err != nil {
				return fmt.Errorf("build VRT: %w", err)
			}

			job.SatImage = vrtPath
			job.ImageSize = imageWidth
			log.Printf("Built VRT: %dx%d pixels, %d tiles", imageWidth, imageHeight, len(tiles))

			return nil
		},
	}
}
