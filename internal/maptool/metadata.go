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
	MaxZoom   int
	URLPrefix string // e.g. "images/maps/altis" — prepended to asset paths in JSON
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
		MinZoom:       0,
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

	doc := styleJSON{
		Version: 8,
		Name:    displayName,
		Sources: map[string]interface{}{
			"topo": map[string]interface{}{
				"type":     "raster",
				"url":      "pmtiles://" + assetPath(meta.URLPrefix, "topo.pmtiles"),
				"tileSize": 256,
			},
		},
		Layers: []interface{}{
			map[string]interface{}{
				"id":     "basemap",
				"type":   "raster",
				"source": "topo",
			},
		},
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
				URLPrefix: "images/maps/" + job.WorldName,
			}
			if err := GenerateMapJSON(job.OutputDir, meta); err != nil {
				return err
			}
			return GenerateStyleJSON(job.OutputDir, meta)
		},
	}
}
