package convertcli

import (
	"context"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"

	"github.com/OCAP2/web/internal/conversion"
	"github.com/OCAP2/web/internal/server"
	"github.com/OCAP2/web/internal/storage"
)

// Run is the entry point for `ocap-webserver convert ...`. Returns the process exit code.
func Run(args []string) int {
	return run(args, defaultDeps())
}

// deps bundles injectable dependencies for the convert CLI.
type deps struct {
	loadSettings func() (server.Setting, error)
	newRepo      func(dbPath string) (*server.RepoOperation, error)
	stdout       io.Writer
	stderr       io.Writer
}

func defaultDeps() deps {
	return deps{
		loadSettings: server.NewSetting,
		newRepo:      server.NewRepoOperation,
		stdout:       os.Stdout,
		stderr:       os.Stderr,
	}
}

func run(args []string, d deps) int {
	fs := flag.NewFlagSet("convert", flag.ContinueOnError)
	fs.SetOutput(d.stderr)

	inputFile := fs.String("input", "", "Convert a single JSON file")
	all := fs.Bool("all", false, "Convert all pending operations")
	status := fs.Bool("status", false, "Show conversion status of all operations")
	setFormat := fs.String("set-format", "", "Set storage format for an operation (use with --id)")
	opID := fs.Int64("id", 0, "Operation ID (for --set-format)")
	chunkSize := fs.Uint("chunk-size", 300, "Frames per chunk (default: 300)")

	fs.Usage = func() {
		fmt.Fprintf(d.stderr, "Usage: convert [options]\n\n")
		fmt.Fprintf(d.stderr, "Options:\n")
		fs.PrintDefaults()
		fmt.Fprintf(d.stderr, "\nExamples:\n")
		fmt.Fprintf(d.stderr, "  convert --input mission.json.gz       Convert to protobuf\n")
		fmt.Fprintf(d.stderr, "  convert --all                         Convert all pending\n")
		fmt.Fprintf(d.stderr, "  convert --status                      Show conversion status\n")
		fmt.Fprintf(d.stderr, "  convert --set-format protobuf --id 1  Set format for operation\n")
	}

	if err := fs.Parse(args); err != nil {
		// ContinueOnError already wrote the error to d.stderr via fs.SetOutput
		return 2
	}

	setting, err := d.loadSettings()
	if err != nil {
		fmt.Fprintf(d.stderr, "error loading settings: %v\n", err)
		return 2
	}

	repo, err := d.newRepo(setting.DB)
	if err != nil {
		fmt.Fprintf(d.stderr, "error creating operation repo: %v\n", err)
		return 2
	}

	ctx := context.Background()

	switch {
	case *status:
		if err := showConversionStatus(ctx, repo, d.stdout); err != nil {
			fmt.Fprintf(d.stderr, "error: %v\n", err)
			return 1
		}
		return 0

	case *setFormat != "":
		if *opID == 0 {
			fmt.Fprintf(d.stderr, "error: --id is required when using --set-format\n")
			return 1
		}
		if err := repo.UpdateStorageFormat(ctx, *opID, *setFormat); err != nil {
			fmt.Fprintf(d.stderr, "error: update format: %v\n", err)
			return 1
		}
		log.Printf("Updated operation %d to format: %s", *opID, *setFormat)
		if err := showConversionStatus(ctx, repo, d.stdout); err != nil {
			fmt.Fprintf(d.stderr, "error: %v\n", err)
			return 1
		}
		return 0

	case *inputFile != "":
		if err := convertSingleFile(ctx, repo, *inputFile, setting.Data, uint32(*chunkSize)); err != nil {
			fmt.Fprintf(d.stderr, "error: %v\n", err)
			return 1
		}
		return 0

	case *all:
		if err := convertAll(ctx, repo, setting, uint32(*chunkSize)); err != nil {
			fmt.Fprintf(d.stderr, "error: %v\n", err)
			return 1
		}
		fmt.Fprintln(d.stdout)
		if err := showConversionStatus(ctx, repo, d.stdout); err != nil {
			fmt.Fprintf(d.stderr, "error: %v\n", err)
			return 1
		}
		return 0

	default:
		fs.Usage()
		return 0
	}
}

func showConversionStatus(ctx context.Context, repo *server.RepoOperation, w io.Writer) error {
	ops, err := repo.Select(ctx, server.Filter{})
	if err != nil {
		return fmt.Errorf("select operations: %w", err)
	}

	fmt.Fprintf(w, "%-6s %-30s %-10s %-12s\n", "ID", "Mission Name", "Format", "Status")
	fmt.Fprintln(w, string(make([]byte, 62)))

	for _, op := range ops {
		name := op.MissionName
		if len(name) > 28 {
			name = name[:28] + ".."
		}
		fmt.Fprintf(w, "%-6d %-30s %-10s %-12s\n",
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

	return nil
}
