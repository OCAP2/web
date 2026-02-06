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
	all := fs.String("all", "", "Import all PBOs from a directory")
	mapsDir := fs.String("maps", "maps", "Output maps directory")

	fs.Usage = func() {
		fmt.Fprintf(os.Stderr, "Usage: %s import [options] <path>\n\n", os.Args[0])
		fmt.Fprintf(os.Stderr, "  <path> can be a .pbo file or a grad_meh export directory.\n\n")
		fmt.Fprintf(os.Stderr, "Options:\n")
		fs.PrintDefaults()
		fmt.Fprintf(os.Stderr, "\nExamples:\n")
		fmt.Fprintf(os.Stderr, "  %s import /path/to/gradmeh/altis/\n", os.Args[0])
		fmt.Fprintf(os.Stderr, "  %s import altis.pbo\n", os.Args[0])
		fmt.Fprintf(os.Stderr, "  %s import --all ./pbos/\n", os.Args[0])
		fmt.Fprintf(os.Stderr, "  %s import --maps /srv/ocap/maps altis.pbo\n", os.Args[0])
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

	if *all != "" {
		return importAllPBOs(ctx, tools, *all, *mapsDir)
	}

	if fs.NArg() < 1 {
		fs.Usage()
		return nil
	}

	inputPath := fs.Arg(0)

	// Auto-detect: directory → grad_meh, .pbo → PBO pipeline
	info, err := os.Stat(inputPath)
	if err != nil {
		return fmt.Errorf("stat %s: %w", inputPath, err)
	}
	if info.IsDir() {
		return importGradMehDir(ctx, tools, inputPath, *mapsDir)
	}
	return importPBO(ctx, tools, inputPath, *mapsDir)
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

func importPBO(ctx context.Context, tools maptool.ToolSet, pboPath, mapsDir string) error {
	worldName := maptool.WorldNameFromPBO(pboPath)
	log.Printf("Importing PBO: %s (world: %s)", pboPath, worldName)

	pipeline := buildPBOPipeline(tools)
	pipeline.OnProgress = func(p maptool.Progress) {
		log.Printf("[%d/%d] %s: %s", p.StageNum, p.TotalStages, p.Stage, p.Message)
	}

	job := &maptool.Job{
		ID:        worldName,
		WorldName: worldName,
		InputPath: pboPath,
		OutputDir: filepath.Join(mapsDir, worldName),
		TempDir:   filepath.Join(os.TempDir(), "ocap-maptool", worldName),
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
	log.Printf("Import complete: %s → %s", pboPath, job.OutputDir)
	return nil
}

func importAllPBOs(ctx context.Context, tools maptool.ToolSet, dir, mapsDir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("read directory: %w", err)
	}

	var pbos []string
	for _, e := range entries {
		if !e.IsDir() && filepath.Ext(e.Name()) == ".pbo" {
			pbos = append(pbos, filepath.Join(dir, e.Name()))
		}
	}

	if len(pbos) == 0 {
		log.Println("No .pbo files found")
		return nil
	}

	log.Printf("Found %d PBO files", len(pbos))
	for _, pbo := range pbos {
		if err := importPBO(ctx, tools, pbo, mapsDir); err != nil {
			log.Printf("Error importing %s: %v", pbo, err)
		}
	}
	return nil
}

func buildPBOPipeline(tools maptool.ToolSet) *maptool.Pipeline {
	stages := []maptool.Stage{
		maptool.NewExtractPBOStage(tools),
		maptool.NewProcessSatelliteStage(tools),
		maptool.NewGenerateTilesStage(tools),
		maptool.NewPackagePMTilesStage(tools),
		maptool.NewGenerateVectorTilesStage(tools),
		maptool.NewGenerateMetadataStage(),
	}
	return maptool.NewPipeline(stages)
}
