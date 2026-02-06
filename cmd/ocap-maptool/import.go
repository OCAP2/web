package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"github.com/OCAP2/web/internal/maptool"
)

func runImport(args []string) error {
	fs := flag.NewFlagSet("import", flag.ExitOnError)
	mapsDir := fs.String("maps", "maps", "Output maps directory")

	fs.Usage = func() {
		fmt.Fprintf(os.Stderr, "Usage: %s import [options] <path>\n\n", os.Args[0])
		fmt.Fprintf(os.Stderr, "  <path> is a grad_meh export directory.\n\n")
		fmt.Fprintf(os.Stderr, "Options:\n")
		fs.PrintDefaults()
		fmt.Fprintf(os.Stderr, "\nExamples:\n")
		fmt.Fprintf(os.Stderr, "  %s import /path/to/gradmeh/altis/\n", os.Args[0])
		fmt.Fprintf(os.Stderr, "  %s import --maps /srv/ocap/maps /path/to/gradmeh/altis/\n", os.Args[0])
	}

	if err := fs.Parse(args); err != nil {
		return err
	}

	// Detect tools
	tools := maptool.DetectTools()
	log.Println("Detected tools:")
	for _, t := range tools {
		status := "not found"
		if t.Found {
			status = t.Path
		}
		req := ""
		if !t.Required {
			req = " (optional)"
		}
		log.Printf("  %s: %s%s", t.Name, status, req)
	}

	if missing := tools.MissingRequired(); len(missing) > 0 {
		for _, t := range missing {
			log.Printf("ERROR: required tool not found: %s", t.Name)
		}
		return fmt.Errorf("missing required tools")
	}

	ctx := context.Background()

	if fs.NArg() < 1 {
		fs.Usage()
		return nil
	}

	return importGradMehDir(ctx, tools, fs.Arg(0), *mapsDir)
}

func importGradMehDir(ctx context.Context, tools maptool.ToolSet, dir, mapsDir string) error {
	if err := maptool.ValidateGradMehDir(dir); err != nil {
		return fmt.Errorf("not a valid grad_meh export: %w", err)
	}

	worldName := maptool.WorldNameFromDir(dir)
	log.Printf("Importing grad_meh export: %s (world: %s)", dir, worldName)

	pipeline := buildGradMehPipeline(tools)
	pipeline.OnProgress = func(p maptool.Progress) {
		log.Printf("[%d/%d] %s: %s", p.StageNum, p.TotalStages, p.Stage, p.Message)
	}

	job := &maptool.Job{
		ID:        worldName,
		WorldName: worldName,
		InputPath: dir,
		OutputDir: filepath.Join(mapsDir, worldName),
		TempDir:   filepath.Join(os.TempDir(), "ocap-maptool", worldName),
		SubDirs:   true,
	}

	if err := os.MkdirAll(job.OutputDir, 0755); err != nil {
		return fmt.Errorf("create output dir: %w", err)
	}
	if err := os.MkdirAll(job.TempDir, 0755); err != nil {
		return fmt.Errorf("create temp dir: %w", err)
	}

	if err := pipeline.Run(ctx, job); err != nil {
		log.Printf("Pipeline failed: %v (temp dir preserved at %s)", err, job.TempDir)
		return err
	}

	os.RemoveAll(job.TempDir)
	log.Printf("Import complete: %s → %s", dir, job.OutputDir)
	return nil
}
