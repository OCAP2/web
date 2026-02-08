package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"github.com/OCAP2/web/internal/maptool"
)

func runRestyle(args []string) error {
	fs := flag.NewFlagSet("restyle", flag.ExitOnError)
	mapsDir := fs.String("maps", "maps", "Maps directory")

	fs.Usage = func() {
		fmt.Fprintf(os.Stderr, "Usage: %s restyle [options] [worldName...]\n\n", os.Args[0])
		fmt.Fprintf(os.Stderr, "  Regenerates MapLibre style JSONs and sprites from existing map data.\n")
		fmt.Fprintf(os.Stderr, "  If no world names are given, restyles all maps in the directory.\n\n")
		fmt.Fprintf(os.Stderr, "Options:\n")
		fs.PrintDefaults()
		fmt.Fprintf(os.Stderr, "\nExamples:\n")
		fmt.Fprintf(os.Stderr, "  %s restyle altis\n", os.Args[0])
		fmt.Fprintf(os.Stderr, "  %s restyle --maps /srv/ocap/maps altis stratis\n", os.Args[0])
		fmt.Fprintf(os.Stderr, "  %s restyle --maps /srv/ocap/maps\n", os.Args[0])
	}

	if err := fs.Parse(args); err != nil {
		return err
	}

	worlds := fs.Args()

	// If no worlds specified, discover all maps
	if len(worlds) == 0 {
		maps, err := maptool.ScanMaps(*mapsDir)
		if err != nil {
			return fmt.Errorf("scan maps: %w", err)
		}
		if len(maps) == 0 {
			return fmt.Errorf("no maps found in %s", *mapsDir)
		}
		for _, m := range maps {
			worlds = append(worlds, m.Name)
		}
	}

	var hadErrors bool
	for _, world := range worlds {
		if err := restyleWorld(*mapsDir, world); err != nil {
			log.Printf("ERROR: %s: %v", world, err)
			hadErrors = true
			continue
		}
		log.Printf("Restyled: %s", world)
	}

	if hadErrors {
		return fmt.Errorf("one or more worlds failed to restyle")
	}

	return nil
}

// restyleWorld reads meta.json, probes which pmtiles exist,
// and regenerates the style JSONs + sprites.
func restyleWorld(mapsDir, worldName string) error {
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
	styleCfg := maptool.StyleConfig{
		WorldName:      meta.WorldName,
		URLPrefix:      "images/maps/" + meta.WorldName + "/tiles",
		SpritePrefix:   "images/maps/" + meta.WorldName + "/styles",
		VectorLayers:   meta.FeatureLayers,
		HasSatellite:   hasFile("satellite.pmtiles"),
		HasHeightmap:   hasFile("heightmap.pmtiles"),
		HasHillshade:     hasFile("hillshade.pmtiles"),
		HasBathymetry:    hasFile("bathymetry.pmtiles"),
		HasColorRelief:   hasFile("color-relief.pmtiles"),
		GlyphsURL:      "../../fonts/{fontstack}/{range}.pbf",
	}

	// 4. Generate all style variants
	stylesDir := filepath.Join(worldDir, "styles")
	if err := os.MkdirAll(stylesDir, 0755); err != nil {
		return fmt.Errorf("create styles dir: %w", err)
	}

	variants := []struct {
		variant  maptool.StyleVariant
		filename string
	}{
		{maptool.StyleTopo, "topo.json"},
		{maptool.StyleTopoDark, "topo-dark.json"},
		{maptool.StyleTopoRelief, "topo-relief.json"},
		{maptool.StyleColorRelief, "color-relief.json"},
	}

	for _, v := range variants {
		styleDoc := maptool.GenerateStyleDocument(styleCfg, v.variant)
		data, err := json.MarshalIndent(styleDoc, "", "  ")
		if err != nil {
			return fmt.Errorf("marshal %s: %w", v.filename, err)
		}
		if err := os.WriteFile(filepath.Join(stylesDir, v.filename), data, 0644); err != nil {
			return fmt.Errorf("write %s: %w", v.filename, err)
		}
	}

	// 5. Regenerate sprites
	if err := maptool.WriteSpriteFiles(stylesDir); err != nil {
		return fmt.Errorf("write sprites: %w", err)
	}

	return nil
}
