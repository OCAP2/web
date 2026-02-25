package main

import (
	"flag"
	"fmt"
	"log"
	"os"

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
		if err := maptool.RestyleWorld(*mapsDir, world); err != nil {
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
