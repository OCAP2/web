package maptool

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// RestyleWorld reads meta.json, probes which pmtiles exist,
// and regenerates the style JSONs + sprites for a single world.
func RestyleWorld(mapsDir, worldName string) error {
	worldDir := filepath.Join(mapsDir, worldName)

	// 1. Read meta.json to get featureLayers
	metaPath := filepath.Join(worldDir, "meta.json")
	metaData, err := os.ReadFile(metaPath)
	if err != nil {
		return fmt.Errorf("read meta.json: %w", err)
	}

	var meta struct {
		WorldName     string   `json:"worldName"`
		FeatureLayers []string `json:"featureLayers"`
	}
	if err := json.Unmarshal(metaData, &meta); err != nil {
		return fmt.Errorf("parse meta.json: %w", err)
	}

	if len(meta.FeatureLayers) == 0 {
		return fmt.Errorf("meta.json has no featureLayers")
	}

	// 2. Probe which pmtiles exist in tiles/
	tilesDir := filepath.Join(worldDir, "tiles")
	hasFile := func(name string) bool {
		_, err := os.Stat(filepath.Join(tilesDir, name))
		return err == nil
	}

	// 3. Build StyleConfig — same logic as NewGenerateStylesStage
	mapBase := "images/maps/" + meta.WorldName
	styleCfg := StyleConfig{
		WorldName:      meta.WorldName,
		URLPrefix:      mapBase + "/tiles",
		VectorLayers:   meta.FeatureLayers,
		HasSatellite:   hasFile("satellite.pmtiles"),
		HasHeightmap:   hasFile("heightmap.pmtiles"),
		HasHillshade:   hasFile("hillshade.pmtiles"),
		HasBathymetry:  hasFile("bathymetry.pmtiles"),
		HasColorRelief: hasFile("color-relief.pmtiles"),
		GlyphsURL:      "images/maps/fonts/{fontstack}/{range}.pbf",
	}

	// 4. Generate all style variants
	stylesDir := filepath.Join(worldDir, "styles")
	if err := os.MkdirAll(stylesDir, 0755); err != nil {
		return fmt.Errorf("create styles dir: %w", err)
	}

	variants := []struct {
		variant  StyleVariant
		filename string
	}{
		{StyleTopo, "topo.json"},
		{StyleTopoDark, "topo-dark.json"},
		{StyleTopoRelief, "topo-relief.json"},
		{StyleColorRelief, "color-relief.json"},
	}

	for _, v := range variants {
		styleDoc := GenerateStyleDocument(styleCfg, v.variant)
		data, err := json.MarshalIndent(styleDoc, "", "  ")
		if err != nil {
			return fmt.Errorf("marshal %s: %w", v.filename, err)
		}
		if err := os.WriteFile(filepath.Join(stylesDir, v.filename), data, 0644); err != nil {
			return fmt.Errorf("write %s: %w", v.filename, err)
		}
	}

	return nil
}
