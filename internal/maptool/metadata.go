package maptool

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
)

// mapJSON is the structure written to map.json.
type mapJSON struct {
	Name       string `json:"name"`
	WorldSize  int    `json:"worldSize"`
	ImageSize  int    `json:"imageSize"`
	Multiplier int    `json:"multiplier"`
	MaxZoom    int    `json:"maxZoom"`
	MinZoom    int    `json:"minZoom"`
	Maplibre   bool   `json:"maplibre,omitempty"`
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

// worldMetaJSON is the meta.json structure matching Python arma3-maptiler output.
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

// NewGenerateStylesStage creates a pipeline stage that writes the MapLibre
// style variants.
func NewGenerateStylesStage() Stage {
	return Stage{
		Name: "generate_styles",
		Run: func(ctx context.Context, job *Job) error {
			worldName := job.WorldName

			tilesPrefix := "images/maps/" + worldName
			stylesDir := job.OutputDir
			if job.SubDirs {
				tilesPrefix += "/tiles"
				stylesDir = job.StylesOutputDir()
				if err := os.MkdirAll(stylesDir, 0755); err != nil {
					return fmt.Errorf("create styles dir: %w", err)
				}
			}

			spritePrefix := "images/maps/" + worldName
			glyphsURL := "../fonts/{fontstack}/{range}.pbf"
			if job.SubDirs {
				spritePrefix = "images/maps/" + worldName + "/styles"
				glyphsURL = "../../fonts/{fontstack}/{range}.pbf"
			}

			styleCfg := StyleConfig{
				WorldName:      worldName,
				URLPrefix:      tilesPrefix,
				SpritePrefix:   spritePrefix,
				VectorLayers:   job.VectorLayers,
				HasSatellite:   true,
				HasHeightmap:   job.HasHeightmap,
				HasHillshade:     job.HasHillshade,
				HasHillshadeFull: job.HasHillshadeFull,
				HasColorRelief:   job.HasColorRelief,
				GlyphsURL:      glyphsURL,
			}

			variants := []struct {
				variant  StyleVariant
				filename string
			}{
				{StyleTopo, "topo.json"},
				{StyleTopoDark, "topo-dark.json"},
				{StyleTopoRelief, "topo-relief.json"},
				{StyleSatellite, "satellite.json"},
				{StyleHybrid, "hybrid.json"},
				{StyleColorRelief, "color-relief.json"},
			}

			for _, v := range variants {
				styleDoc := GenerateStyleDocument(styleCfg, v.variant)
				if err := writeJSON(filepath.Join(stylesDir, v.filename), styleDoc); err != nil {
					return fmt.Errorf("write %s: %w", v.filename, err)
				}
			}
			job.HasMaplibre = true

			if err := WriteSpriteFiles(stylesDir); err != nil {
				return fmt.Errorf("write sprites: %w", err)
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

			// 1. Generate map.json (OCAP2 web compat)
			maxZoom := job.MaxZoom
			if maxZoom == 0 {
				maxZoom = 6
			}

			doc := mapJSON{
				Name:       worldName,
				WorldSize:  job.WorldSize,
				ImageSize:  job.ImageSize,
				Multiplier: 1,
				MaxZoom:    maxZoom,
				MinZoom:    job.MinZoom,
				Maplibre:   job.HasMaplibre,
			}
			if err := writeJSON(filepath.Join(job.OutputDir, "map.json"), doc); err != nil {
				return fmt.Errorf("write map.json: %w", err)
			}

			// 2. Generate meta.json
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
