package maptool

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
)

// MapMeta holds metadata extracted from a WRP or provided by the user.
type MapMeta struct {
	WorldName string
	WorldSize int
	ImageSize int
	MinZoom   int
	MaxZoom   int
	URLPrefix string   // e.g. "images/maps/altis" — prepended to asset paths in JSON
	HasVector bool     // true when vector.pmtiles exists
	Layers    []string // vector layer names (grad_meh); when set, uses styles.go for rich styling
}

// mapJSON is the structure written to map.json.
type mapJSON struct {
	Name          string `json:"name"`
	WorldSize     int    `json:"worldSize"`
	ImageSize     int    `json:"imageSize"`
	Multiplier    int    `json:"multiplier"`
	MaxZoom       int    `json:"maxZoom"`
	MinZoom       int    `json:"minZoom"`
	MaplibreStyle string `json:"maplibreStyle"`
}

// styleJSON is the MapLibre style document.
type styleJSON struct {
	Version int                    `json:"version"`
	Name    string                 `json:"name"`
	Sources map[string]interface{} `json:"sources"`
	Layers  []interface{}          `json:"layers"`
}

// GenerateMapJSON writes a map.json file for the given world.
func GenerateMapJSON(outputDir string, meta MapMeta) error {
	maxZoom := meta.MaxZoom
	if maxZoom == 0 {
		maxZoom = 6
	}

	doc := mapJSON{
		Name:          meta.WorldName,
		WorldSize:     meta.WorldSize,
		ImageSize:     meta.ImageSize,
		Multiplier:    1,
		MaxZoom:       maxZoom,
		MinZoom:       meta.MinZoom,
		MaplibreStyle: assetPath(meta.URLPrefix, "style.json"),
	}

	return writeJSON(filepath.Join(outputDir, "map.json"), doc)
}

// GenerateStyleJSON writes a style.json MapLibre style document.
func GenerateStyleJSON(outputDir string, meta MapMeta) error {
	if meta.WorldName == "" {
		return fmt.Errorf("world name is required")
	}
	displayName := strings.ToUpper(meta.WorldName[:1]) + meta.WorldName[1:]

	minZoom := meta.MinZoom
	maxZoom := meta.MaxZoom
	if maxZoom == 0 {
		maxZoom = 6
	}

	sources := map[string]interface{}{
		"topo": map[string]interface{}{
			"type":     "raster",
			"url":      "pmtiles://" + assetPath(meta.URLPrefix, "topo.pmtiles"),
			"tileSize": 256,
			"minzoom":  minZoom,
			"maxzoom":  maxZoom,
		},
	}

	layers := []interface{}{
		map[string]interface{}{
			"id":     "basemap",
			"type":   "raster",
			"source": "topo",
		},
	}

	if meta.HasVector {
		sources["vectors"] = map[string]interface{}{
			"type": "vector",
			"url":  "pmtiles://" + assetPath(meta.URLPrefix, "vector.pmtiles"),
		}

		if len(meta.Layers) > 0 {
			// Rich styling from styles.go (grad_meh path)
			layers = append(layers, buildLayerStyles(meta.Layers)...)
		} else {
			// Legacy PBO vector layers (hardcoded)
			layers = append(layers, buildLegacyVectorLayers()...)
		}
	}

	doc := styleJSON{
		Version: 8,
		Name:    displayName,
		Sources: sources,
		Layers:  layers,
	}

	return writeJSON(filepath.Join(outputDir, "style.json"), doc)
}

// buildLayerStyles generates MapLibre style layers from grad_meh layer names
// using the style definitions in styles.go.
func buildLayerStyles(layerNames []string) []interface{} {
	var result []interface{}
	for _, name := range layerNames {
		for _, style := range GetLayerStyles(name) {
			layer := map[string]interface{}{
				"id":           style.ID,
				"type":         style.Type,
				"source":       "vectors",
				"source-layer": style.SourceLayer,
			}
			if style.MinZoom > 0 {
				layer["minzoom"] = style.MinZoom
			}
			if style.MaxZoom > 0 {
				layer["maxzoom"] = style.MaxZoom
			}
			if style.Paint != nil {
				layer["paint"] = style.Paint
			}
			if style.Layout != nil {
				layer["layout"] = style.Layout
			}
			if style.Filter != nil {
				layer["filter"] = style.Filter
			}
			result = append(result, layer)
		}
	}
	return result
}

// buildLegacyVectorLayers returns hardcoded vector layer styles for the PBO pipeline.
func buildLegacyVectorLayers() []interface{} {
	return []interface{}{
		map[string]interface{}{
			"id":           "contours",
			"source":       "vectors",
			"source-layer": "contours",
			"type":         "line",
			"paint": map[string]interface{}{
				"line-color":   "#8B6914",
				"line-opacity": 0.4,
				"line-width":   0.5,
			},
		},
		map[string]interface{}{
			"id":           "contours-major",
			"source":       "vectors",
			"source-layer": "contours",
			"type":         "line",
			"filter":       []interface{}{"==", "type", "major"},
			"paint": map[string]interface{}{
				"line-color":   "#8B6914",
				"line-opacity": 0.7,
				"line-width":   1,
			},
		},
		map[string]interface{}{
			"id":           "roads",
			"source":       "vectors",
			"source-layer": "roads",
			"type":         "line",
			"paint": map[string]interface{}{
				"line-color": []interface{}{
					"match", []interface{}{"get", "type"},
					"main road", "#e8e8e8",
					"road", "#d4c4a0",
					"track", "#c4a060",
					"#b0a080",
				},
				"line-width": []interface{}{
					"match", []interface{}{"get", "type"},
					"main road", 2.5,
					"road", 1.8,
					"track", 1.0,
					1.5,
				},
				"line-opacity": 0.8,
			},
		},
		map[string]interface{}{
			"id":           "buildings",
			"source":       "vectors",
			"source-layer": "buildings",
			"type":         "circle",
			"paint": map[string]interface{}{
				"circle-radius":  2,
				"circle-color":   "#888",
				"circle-opacity": 0.6,
			},
		},
	}
}

// assetPath joins a URL prefix with a filename. If prefix is empty, returns filename as-is.
func assetPath(prefix, filename string) string {
	if prefix == "" {
		return filename
	}
	return prefix + "/" + filename
}

func writeJSON(path string, v interface{}) error {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}
	if err := os.WriteFile(path, data, 0644); err != nil {
		return fmt.Errorf("write %s: %w", filepath.Base(path), err)
	}
	return nil
}

// NewGenerateMetadataStage creates a pipeline stage that writes map.json + style.json.
// Used by the PBO pipeline (legacy, single style).
func NewGenerateMetadataStage() Stage {
	return Stage{
		Name: "generate_metadata",
		Run: func(ctx context.Context, job *Job) error {
			meta := MapMeta{
				WorldName: job.WorldName,
				WorldSize: job.WorldSize,
				ImageSize: job.ImageSize,
				MinZoom:   job.MinZoom,
				MaxZoom:   job.MaxZoom,
				URLPrefix: "images/maps/" + job.WorldName,
				HasVector: job.HasVector,
				Layers:    job.VectorLayers,
			}
			if err := GenerateMapJSON(job.OutputDir, meta); err != nil {
				return err
			}
			return GenerateStyleJSON(job.OutputDir, meta)
		},
	}
}

// worldMetaJSON is the {world}-meta.json structure matching Python arma3-maptiler output.
type worldMetaJSON struct {
	WorldName     string     `json:"worldName"`
	DisplayName   string     `json:"displayName"`
	WorldSize     int        `json:"worldSize"`
	Author        string     `json:"author,omitempty"`
	Bounds        [4]float64 `json:"bounds"`
	Center        [2]float64 `json:"center"`
	Elevation     *elevStats `json:"elevation,omitempty"`
	FeatureLayers []string   `json:"featureLayers,omitempty"`
}

type elevStats struct {
	Min    float64 `json:"min"`
	Max    float64 `json:"max"`
	Avg    float64 `json:"avg"`
	StdDev float64 `json:"stddev"`
}

// computeElevationStats calculates min/max/avg/stddev from a DEMGrid.
func computeElevationStats(grid *DEMGrid) *elevStats {
	if grid == nil || len(grid.Data) == 0 {
		return nil
	}
	var sum, sumSq float64
	min, max := float64(grid.Data[0]), float64(grid.Data[0])
	n := float64(len(grid.Data))

	for _, v := range grid.Data {
		fv := float64(v)
		if fv < min {
			min = fv
		}
		if fv > max {
			max = fv
		}
		sum += fv
		sumSq += fv * fv
	}

	avg := sum / n
	variance := sumSq/n - avg*avg
	stddev := 0.0
	if variance > 0 {
		stddev = math.Sqrt(variance)
	}

	return &elevStats{
		Min:    math.Round(min*100) / 100,
		Max:    math.Round(max*100) / 100,
		Avg:    math.Round(avg*100) / 100,
		StdDev: math.Round(stddev*100) / 100,
	}
}

// NewGenerateStylesStage creates a pipeline stage that writes the 3 MapLibre
// style variants (standard.json, satellite.json, hybrid.json).
func NewGenerateStylesStage() Stage {
	return Stage{
		Name: "generate_styles",
		Run: func(ctx context.Context, job *Job) error {
			worldName := job.WorldName
			basePrefix := "images/maps/" + worldName

			tilesPrefix := basePrefix
			stylesDir := job.OutputDir
			if job.SubDirs {
				tilesPrefix = basePrefix + "/tiles"
				stylesDir = job.StylesOutputDir()
				if err := os.MkdirAll(stylesDir, 0755); err != nil {
					return fmt.Errorf("create styles dir: %w", err)
				}
			}

			styleCfg := StyleConfig{
				WorldName:      worldName,
				URLPrefix:      tilesPrefix,
				VectorLayers:   job.VectorLayers,
				HasSatellite:   true,
				HasHeightmap:   job.HasHeightmap,
				HasHillshade:   job.HasHillshade,
				HasColorRelief: job.HasColorRelief,
			}

			variants := []struct {
				variant  StyleVariant
				filename string
			}{
				{StyleStandard, "standard.json"},
				{StyleSatellite, "satellite.json"},
				{StyleHybrid, "hybrid.json"},
			}
			for _, v := range variants {
				styleDoc := GenerateStyleDocument(styleCfg, v.variant)
				if err := writeJSON(filepath.Join(stylesDir, v.filename), styleDoc); err != nil {
					return fmt.Errorf("write %s: %w", v.filename, err)
				}
			}

			return nil
		},
	}
}

// NewGenerateGradMehMetadataStage creates the metadata stage for the grad_meh pipeline.
// It generates:
//   - map.json (OCAP2 web compat)
//   - meta.json (rich metadata matching Python arma3-maptiler)
func NewGenerateGradMehMetadataStage() Stage {
	return Stage{
		Name: "generate_metadata",
		Run: func(ctx context.Context, job *Job) error {
			worldName := job.WorldName
			basePrefix := "images/maps/" + worldName

			stylesPrefix := basePrefix
			if job.SubDirs {
				stylesPrefix = basePrefix + "/styles"
			}

			// 1. Generate map.json (OCAP2 web compat) — points to standard style
			maxZoom := job.MaxZoom
			if maxZoom == 0 {
				maxZoom = 6
			}
			doc := mapJSON{
				Name:          worldName,
				WorldSize:     job.WorldSize,
				ImageSize:     job.ImageSize,
				Multiplier:    1,
				MaxZoom:       maxZoom,
				MinZoom:       job.MinZoom,
				MaplibreStyle: assetPath(stylesPrefix, "standard.json"),
			}
			if err := writeJSON(filepath.Join(job.OutputDir, "map.json"), doc); err != nil {
				return fmt.Errorf("write map.json: %w", err)
			}

			// 2. Generate {world}-meta.json
			worldSizeDeg := float64(job.WorldSize) / float64(metersPerDegree)
			displayName := worldName
			author := ""
			if job.GradMehMeta != nil {
				displayName = job.GradMehMeta.DisplayName
				author = job.GradMehMeta.Author
			}

			metaDoc := worldMetaJSON{
				WorldName:     worldName,
				DisplayName:   displayName,
				WorldSize:     job.WorldSize,
				Author:        author,
				Bounds:        [4]float64{0, 0, worldSizeDeg, worldSizeDeg},
				Center:        [2]float64{worldSizeDeg / 2, worldSizeDeg / 2},
				Elevation:     computeElevationStats(job.DEMGrid),
				FeatureLayers: job.VectorLayers,
			}
			if err := writeJSON(filepath.Join(job.OutputDir, "meta.json"), metaDoc); err != nil {
				return fmt.Errorf("write meta: %w", err)
			}

			return nil
		},
	}
}
