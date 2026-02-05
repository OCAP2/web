package maptool

import (
	"context"
	"encoding/json"
	"fmt"
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
	URLPrefix string // e.g. "images/maps/altis" — prepended to asset paths in JSON
	HasVector bool   // true when vector.pmtiles exists
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
		layers = append(layers,
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
					"line-color": "#d4a017",
					"line-width": 1.5,
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
		)
	}

	doc := styleJSON{
		Version: 8,
		Name:    displayName,
		Sources: sources,
		Layers:  layers,
	}

	return writeJSON(filepath.Join(outputDir, "style.json"), doc)
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
			}
			if err := GenerateMapJSON(job.OutputDir, meta); err != nil {
				return err
			}
			return GenerateStyleJSON(job.OutputDir, meta)
		},
	}
}
