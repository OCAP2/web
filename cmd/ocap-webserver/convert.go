package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"

	"github.com/OCAP2/web/internal/conversion"
	"github.com/OCAP2/web/internal/server"
	"github.com/OCAP2/web/internal/storage"
)

func runConvert(args []string) error {
	fs := flag.NewFlagSet("convert", flag.ExitOnError)
	inputFile := fs.String("input", "", "Convert a single JSON file")
	all := fs.Bool("all", false, "Convert all pending operations")
	status := fs.Bool("status", false, "Show conversion status of all operations")
	setFormat := fs.String("set-format", "", "Set storage format for an operation (use with --id)")
	opID := fs.Int64("id", 0, "Operation ID (for --set-format)")
	chunkSize := fs.Uint("chunk-size", 300, "Frames per chunk (default: 300)")

	fs.Usage = func() {
		fmt.Fprintf(os.Stderr, "Usage: %s convert [options]\n\n", os.Args[0])
		fmt.Fprintf(os.Stderr, "Options:\n")
		fs.PrintDefaults()
		fmt.Fprintf(os.Stderr, "\nExamples:\n")
		fmt.Fprintf(os.Stderr, "  %s convert --input mission.json.gz       Convert to protobuf\n", os.Args[0])
		fmt.Fprintf(os.Stderr, "  %s convert --all                         Convert all pending\n", os.Args[0])
		fmt.Fprintf(os.Stderr, "  %s convert --status                      Show conversion status\n", os.Args[0])
		fmt.Fprintf(os.Stderr, "  %s convert --set-format protobuf --id 1  Set format for operation\n", os.Args[0])
	}

	if err := fs.Parse(args); err != nil {
		return err
	}

	setting, err := server.NewSetting()
	if err != nil {
		return fmt.Errorf("setting: %w", err)
	}

	repo, err := server.NewRepoOperation(setting.DB)
	if err != nil {
		return fmt.Errorf("operation: %w", err)
	}

	ctx := context.Background()

	switch {
	case *status:
		return showConversionStatus(ctx, repo)

	case *setFormat != "":
		if *opID == 0 {
			return fmt.Errorf("--id is required when using --set-format")
		}
		if err := repo.UpdateStorageFormat(ctx, *opID, *setFormat); err != nil {
			return fmt.Errorf("update format: %w", err)
		}
		log.Printf("Updated operation %d to format: %s", *opID, *setFormat)
		return showConversionStatus(ctx, repo)

	case *inputFile != "":
		return convertSingleFile(ctx, repo, *inputFile, setting.Data, uint32(*chunkSize))

	case *all:
		return convertAll(ctx, repo, setting, uint32(*chunkSize))

	default:
		fs.Usage()
		return nil
	}
}

func showConversionStatus(ctx context.Context, repo *server.RepoOperation) error {
	ops, err := repo.Select(ctx, server.Filter{})
	if err != nil {
		return fmt.Errorf("select operations: %w", err)
	}

	fmt.Printf("%-6s %-30s %-10s %-12s\n", "ID", "Mission Name", "Format", "Status")
	fmt.Println(string(make([]byte, 62)))

	for _, op := range ops {
		name := op.MissionName
		if len(name) > 28 {
			name = name[:28] + ".."
		}
		fmt.Printf("%-6d %-30s %-10s %-12s\n",
			op.ID, name, op.StorageFormat, op.ConversionStatus)
	}

	return nil
}

func convertSingleFile(ctx context.Context, repo *server.RepoOperation, inputFile, dataDir string, chunkSize uint32) error {
	// Determine filename - strip .gz and .json to get base name
	baseName := filepath.Base(inputFile)
	if ext := filepath.Ext(baseName); ext == ".gz" {
		baseName = baseName[:len(baseName)-len(ext)]
	}
	if ext := filepath.Ext(baseName); ext == ".json" {
		baseName = baseName[:len(baseName)-len(ext)]
	}

	// Check if operation exists in database - if so, use worker for consistent behavior
	if op, err := repo.GetByFilename(ctx, baseName); err == nil && op != nil {
		log.Printf("Converting operation %d: %s", op.ID, op.Filename)

		// Use worker to ensure identical behavior as background conversion
		worker := conversion.NewWorker(
			repo,
			conversion.Config{
				DataDir:   dataDir,
				ChunkSize: chunkSize,
			},
		)
		if err := worker.ConvertOne(ctx, op.ID, op.Filename); err != nil {
			return err
		}
		log.Printf("Conversion complete: %s", op.Filename)
		return nil
	}

	// Standalone conversion (no database entry)
	outputPath := filepath.Join(dataDir, baseName)
	log.Printf("Converting %s to %s (chunk size: %d)", inputFile, outputPath, chunkSize)

	engine := storage.NewProtobufEngine(dataDir)
	if err := engine.Convert(ctx, inputFile, outputPath); err != nil {
		return fmt.Errorf("conversion failed: %w", err)
	}

	log.Printf("Conversion complete: %s", outputPath)
	return nil
}

func convertAll(ctx context.Context, repo *server.RepoOperation, setting server.Setting, chunkSize uint32) error {
	operations, err := repo.SelectAll(ctx)
	if err != nil {
		return fmt.Errorf("select operations: %w", err)
	}

	if len(operations) == 0 {
		log.Println("No operations to convert")
		return nil
	}

	log.Printf("Found %d operations to convert", len(operations))

	worker := conversion.NewWorker(
		repo,
		conversion.Config{
			DataDir:   setting.Data,
			ChunkSize: chunkSize,
		},
	)

	for _, op := range operations {
		log.Printf("Converting operation %d: %s", op.ID, op.Filename)
		if err := worker.ConvertOne(ctx, op.ID, op.Filename); err != nil {
			log.Printf("Error converting %s: %v", op.Filename, err)
			// Update status to failed
			repo.UpdateConversionStatus(ctx, op.ID, "failed")
		}
	}

	// Show final status
	fmt.Println()
	return showConversionStatus(ctx, repo)
}

