package maptool

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"golang.org/x/sync/errgroup"
)

// geoJSONSource represents a discovered geojson.gz file with its layer name.
type geoJSONSource struct {
	Name string // layer name (filename without .geojson.gz)
	Path string // full path to .geojson.gz file
}

// layerNameAliases maps grad_meh layer names to canonical names used in styles.
// Some grad_meh versions use different names for the same feature.
var layerNameAliases = map[string]string{
	"mounts": "mount",
}

// DiscoverGeoJSONLayers scans a grad_meh export directory for GeoJSON layers.
// Looks for geojson/**/*.geojson.gz files recursively (layers may be in subdirectories
// like geojson/locations/ or geojson/roads/).
func DiscoverGeoJSONLayers(inputDir string) ([]geoJSONSource, error) {
	geojsonDir := filepath.Join(inputDir, "geojson")
	if _, err := os.Stat(geojsonDir); err != nil {
		return nil, nil // no geojson dir is OK
	}

	var sources []geoJSONSource
	err := filepath.Walk(geojsonDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		if strings.HasSuffix(info.Name(), ".geojson.gz") {
			name := strings.TrimSpace(strings.TrimSuffix(info.Name(), ".geojson.gz"))
			if name == "" {
				log.Printf("Skipping unnamed geojson file: %s", path)
				return nil
			}
			sources = append(sources, geoJSONSource{Name: name, Path: path})
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("walk geojson dir: %w", err)
	}
	return sources, nil
}

// ProcessGeoJSONGz reads a gzipped GeoJSON file from grad_meh, transforms coordinates
// from Arma meters to degrees, converts color arrays to hex strings, and writes a
// proper FeatureCollection to outputPath.
func ProcessGeoJSONGz(inputPath, outputPath string) error {
	f, err := os.Open(inputPath)
	if err != nil {
		return fmt.Errorf("open: %w", err)
	}
	defer f.Close()

	gz, err := gzip.NewReader(f)
	if err != nil {
		return fmt.Errorf("gzip: %w", err)
	}
	defer gz.Close()

	// grad_meh exports a bare JSON array of features, not a FeatureCollection
	var rawFeatures []json.RawMessage
	if err := json.NewDecoder(gz).Decode(&rawFeatures); err != nil {
		return fmt.Errorf("decode features: %w", err)
	}

	var features []interface{}
	for _, raw := range rawFeatures {
		var feature map[string]interface{}
		if err := json.Unmarshal(raw, &feature); err != nil {
			continue
		}

		// Transform coordinates: divide by metersPerDegree
		if geom, ok := feature["geometry"].(map[string]interface{}); ok {
			if coords, ok := geom["coordinates"]; ok {
				geom["coordinates"] = transformCoords(coords)
			}
		}

		// Transform properties
		if props, ok := feature["properties"].(map[string]interface{}); ok {
			// Convert color array [r,g,b] (0-1 floats) to hex string
			if color, ok := props["color"]; ok {
				if colorArr, ok := color.([]interface{}); ok {
					props["color"] = colorArrayToHex(colorArr)
				}
			}
			// Extract zpos from 3D position
			if pos, ok := props["position"].([]interface{}); ok && len(pos) >= 3 {
				if z, ok := toFloat64(pos[2]); ok {
					props["zpos"] = z
				}
			}
		}

		features = append(features, feature)
	}

	fc := map[string]interface{}{
		"type":     "FeatureCollection",
		"features": features,
	}

	out, err := os.Create(outputPath)
	if err != nil {
		return fmt.Errorf("create output: %w", err)
	}
	defer out.Close()

	enc := json.NewEncoder(out)
	if err := enc.Encode(fc); err != nil {
		return fmt.Errorf("encode: %w", err)
	}
	return nil
}

// transformCoords recursively divides coordinate values by metersPerDegree.
// Handles single coordinate pairs [x,y], arrays of pairs, and nested arrays.
func transformCoords(coords interface{}) interface{} {
	switch c := coords.(type) {
	case []interface{}:
		if len(c) == 0 {
			return c
		}
		// Check if this is a coordinate pair (first element is a number)
		if _, ok := toFloat64(c[0]); ok {
			// This is a coordinate: [lon, lat] or [lon, lat, alt]
			result := make([]interface{}, len(c))
			for i, v := range c {
				if f, ok := toFloat64(v); ok && i < 2 {
					result[i] = f / float64(metersPerDegree)
				} else {
					result[i] = v
				}
			}
			return result
		}
		// This is an array of coordinates or nested arrays
		result := make([]interface{}, len(c))
		for i, v := range c {
			result[i] = transformCoords(v)
		}
		return result
	default:
		return coords
	}
}

// colorArrayToHex converts a color array [r, g, b] to "rrggbb" hex string.
// Handles both 0-1 float range (Arma config) and 0-255 integer range (grad_meh exports).
func colorArrayToHex(arr []interface{}) string {
	if len(arr) < 3 {
		return "888888"
	}
	r, _ := toFloat64(arr[0])
	g, _ := toFloat64(arr[1])
	b, _ := toFloat64(arr[2])

	// Detect range: if any channel > 1, values are 0-255 integers
	if r > 1 || g > 1 || b > 1 {
		return fmt.Sprintf("%02x%02x%02x", clampInt(r), clampInt(g), clampInt(b))
	}
	return fmt.Sprintf("%02x%02x%02x", clampInt(r*255), clampInt(g*255), clampInt(b*255))
}

func clampInt(v float64) int {
	n := int(v)
	if n < 0 {
		return 0
	}
	if n > 255 {
		return 255
	}
	return n
}

func toFloat64(v interface{}) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case int:
		return float64(n), true
	case json.Number:
		f, err := n.Float64()
		return f, err == nil
	default:
		return 0, false
	}
}

// NewProcessGeoJSONStage creates a pipeline stage that discovers and transforms
// grad_meh GeoJSON layers, adds contour files, and stores them on the job
// for the subsequent generate_vector_tiles stage.
func NewProcessGeoJSONStage() Stage {
	return Stage{
		Name: "process_geojson",
		Run: func(ctx context.Context, job *Job) error {
			tmpDir := filepath.Join(job.TempDir, "vector")
			if err := os.MkdirAll(tmpDir, 0755); err != nil {
				return fmt.Errorf("create vector temp dir: %w", err)
			}

			var layerFiles []LayerFile
			var layerNames []string

			// Process GeoJSON layers from grad_meh export (in parallel)
			layers, err := DiscoverGeoJSONLayers(job.InputPath)
			if err != nil {
				return fmt.Errorf("discover layers: %w", err)
			}
			log.Printf("Found %d GeoJSON layers", len(layers))

			{
				var mu sync.Mutex
				var g errgroup.Group
				for _, src := range layers {
					if src.Name == "bush" {
						log.Printf("Skipping bush layer (too dense for vector tiles)")
						continue
					}
					g.Go(func() error {
						name := src.Name
						if canonical, ok := layerNameAliases[name]; ok {
							log.Printf("Renaming layer %s → %s", name, canonical)
							name = canonical
						}
						outPath := filepath.Join(tmpDir, name+".geojson")
						if err := ProcessGeoJSONGz(src.Path, outPath); err != nil {
							log.Printf("WARNING: skipping layer %s: %v", name, err)
							return nil
						}
						mu.Lock()
						layerFiles = append(layerFiles, LayerFile{Name: name, Path: outPath})
						layerNames = append(layerNames, name)
						mu.Unlock()
						return nil
					})
				}
				g.Wait()
			}

			// Add sea polygon file if available (from generate_contours stage)
			if job.SeaFile != "" {
				layerFiles = append(layerFiles, LayerFile{Name: "sea", Path: job.SeaFile})
				layerNames = append(layerNames, "sea")
				log.Printf("Added sea polygon layer from DEM")
			}

			// Add GDAL contour files if available (from generate_contours stage)
			if len(job.ContourFiles) > 0 {
				for _, ci := range contourIntervals {
					if path, ok := job.ContourFiles[ci.suffix]; ok {
						name := "contours" + ci.suffix
						layerFiles = append(layerFiles, LayerFile{Name: name, Path: path})
						layerNames = append(layerNames, name)
					}
				}
			} else {
				// Fallback: generate contours from DEM using Go marching squares
				demPath := filepath.Join(job.InputPath, "dem.asc.gz")
				if _, err := os.Stat(demPath); err == nil {
					log.Printf("Parsing DEM for contours (Go fallback): %s", demPath)
					grid, err := ParseASCGridGz(demPath)
					if err != nil {
						log.Printf("WARNING: failed to parse DEM: %v", err)
					} else {
						contours := GenerateContours(
							grid.Data, grid.Cols, grid.Rows, grid.CellSize,
							grid.XllCorner, grid.YllCorner,
							50, 10,
						)
						if len(contours) > 0 {
							path := filepath.Join(tmpDir, "contours.geojson")
							if err := WriteGeoJSON(path, FeatureCollection{Type: "FeatureCollection", Features: contours}); err != nil {
								return fmt.Errorf("write contours: %w", err)
							}
							log.Printf("Generated %d contour features (Go fallback)", len(contours))
							layerFiles = append(layerFiles, LayerFile{Name: "contours", Path: path})
							layerNames = append(layerNames, "contours")
						}
					}
				}
			}

			if len(layerFiles) == 0 {
				return fmt.Errorf("no vector features found")
			}

			job.LayerFiles = layerFiles
			job.VectorLayers = layerNames
			log.Printf("Prepared %d vector layers for tiling", len(layerFiles))
			return nil
		},
	}
}

// NewGradMehVectorTilesStage creates a pipeline stage that runs tippecanoe
// on the GeoJSON files prepared by process_geojson to produce vector PMTiles.
func NewGradMehVectorTilesStage(tools ToolSet) Stage {
	return Stage{
		Name: "generate_vector_tiles",
		Run: func(ctx context.Context, job *Job) error {
			if len(job.LayerFiles) == 0 {
				return fmt.Errorf("no layer files prepared (run process_geojson first)")
			}

			tippeTool, ok := tools.FindTool("tippecanoe")
			if !ok {
				return fmt.Errorf("tippecanoe not found")
			}
			pmtilesBin, ok := tools.FindTool("pmtiles")
			if !ok {
				return fmt.Errorf("pmtiles not found")
			}
			tileJoin, ok := tools.FindTool("tile-join")
			if !ok {
				return fmt.Errorf("tile-join not found")
			}

			tmpDir := filepath.Join(job.TempDir, "vector")
			mbtilesDir := filepath.Join(tmpDir, "mbtiles")
			if err := os.MkdirAll(mbtilesDir, 0755); err != nil {
				return fmt.Errorf("create mbtiles dir: %w", err)
			}

			// Per-layer tippecanoe in parallel, then tile-join to merge.
			var (
				mu           sync.Mutex
				mbtilesFiles []string
			)
			var g errgroup.Group
			g.SetLimit(4)
			for _, lf := range job.LayerFiles {
				g.Go(func() error {
					mbPath := filepath.Join(mbtilesDir, lf.Name+".mbtiles")
					args := []string{
						"-o", mbPath,
						"-f",
						"--minimum-zoom=8",
						"--maximum-zoom=17",
					}
					if categorizeLayer(lf.Name) == "icons" {
						args = append(args, "-r1", "--no-feature-limit", "--no-tile-size-limit")
					} else {
						args = append(args, "--coalesce-densest-as-needed", "--extend-zooms-if-still-dropping")
					}
					args = append(args, "--layer="+lf.Name, lf.Path)

					log.Printf("tippecanoe: processing layer %s", lf.Name)
					if err := runCmd(ctx, tippeTool.Path, args...); err != nil {
						log.Printf("WARNING: tippecanoe failed for layer %s: %v", lf.Name, err)
						return nil // non-fatal
					}
					mu.Lock()
					mbtilesFiles = append(mbtilesFiles, mbPath)
					mu.Unlock()
					return nil
				})
			}
			if err := g.Wait(); err != nil {
				return err
			}

			// tile-join to merge all per-layer MBTiles
			mergedMbtiles := filepath.Join(tmpDir, job.WorldName+"_features.mbtiles")
			joinArgs := []string{
				"-pk", "-pC",
				"--force",
				"-n", "features",
				"--minimum-zoom=8",
				"--maximum-zoom=17",
				"-o", mergedMbtiles,
			}
			joinArgs = append(joinArgs, mbtilesFiles...)

			log.Printf("tile-join: merging %d layers", len(mbtilesFiles))
			if err := runCmd(ctx, tileJoin.Path, joinArgs...); err != nil {
				return fmt.Errorf("tile-join: %w", err)
			}

			// Convert to PMTiles
			outputPath := filepath.Join(job.TilesOutputDir(), "features.pmtiles")
			if err := MBTilesToPMTiles(ctx, pmtilesBin.Path, mergedMbtiles, outputPath); err != nil {
				return err
			}
			job.HasVector = true
			log.Printf("Generated %s", outputPath)

			return nil
		},
	}
}

// LayerFile associates a layer name with its GeoJSON file path.
type LayerFile struct {
	Name string
	Path string
}
