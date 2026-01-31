package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"log"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/OCAP2/web/internal/server"
	"github.com/OCAP2/web/internal/conversion"
	"github.com/OCAP2/web/internal/storage"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "convert" {
		if err := runConvert(os.Args[2:]); err != nil {
			log.Fatalf("convert: %v", err)
		}
		return
	}

	if err := app(); err != nil {
		log.Panicln(err)
	}
}

func runConvert(args []string) error {
	fs := flag.NewFlagSet("convert", flag.ExitOnError)
	inputFile := fs.String("input", "", "Convert a single JSON file")
	all := fs.Bool("all", false, "Convert all pending operations")
	status := fs.Bool("status", false, "Show conversion status of all operations")
	setFormat := fs.String("set-format", "", "Set storage format for an operation (use with --id)")
	opID := fs.Int64("id", 0, "Operation ID (for --set-format)")
	chunkSize := fs.Uint("chunk-size", 300, "Frames per chunk (default: 300)")
	format := fs.String("format", "protobuf", "Output format: protobuf or flatbuffers")

	fs.Usage = func() {
		fmt.Fprintf(os.Stderr, "Usage: %s convert [options]\n\n", os.Args[0])
		fmt.Fprintf(os.Stderr, "Options:\n")
		fs.PrintDefaults()
		fmt.Fprintf(os.Stderr, "\nExamples:\n")
		fmt.Fprintf(os.Stderr, "  %s convert --input mission.json.gz                  Convert to protobuf\n", os.Args[0])
		fmt.Fprintf(os.Stderr, "  %s convert --input mission.json.gz --format flatbuffers   Convert to flatbuffers\n", os.Args[0])
		fmt.Fprintf(os.Stderr, "  %s convert --all                                     Convert all pending\n", os.Args[0])
		fmt.Fprintf(os.Stderr, "  %s convert --status                                  Show conversion status\n", os.Args[0])
		fmt.Fprintf(os.Stderr, "  %s convert --set-format flatbuffers --id 1          Set format for operation\n", os.Args[0])
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

	// Register storage engines for CLI commands that read data directly
	storage.RegisterEngine(storage.NewProtobufEngine(setting.Data))
	storage.RegisterEngine(storage.NewFlatBuffersEngine(setting.Data))

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
		return convertSingleFile(ctx, repo, *inputFile, setting.Data, uint32(*chunkSize), *format)

	case *all:
		return convertAll(ctx, repo, setting, uint32(*chunkSize), *format)

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

func convertSingleFile(ctx context.Context, repo *server.RepoOperation, inputFile, dataDir string, chunkSize uint32, format string) error {
	// Determine filename - only strip .gz to match database filename format
	baseName := filepath.Base(inputFile)
	if ext := filepath.Ext(baseName); ext == ".gz" {
		baseName = baseName[:len(baseName)-len(ext)]
	}

	// Check if operation exists in database - if so, use worker for consistent behavior
	if op, err := repo.GetByFilename(ctx, baseName); err == nil && op != nil {
		log.Printf("Converting operation %d: %s (format: %s)", op.ID, op.Filename, format)

		// Use worker to ensure identical behavior as background conversion
		worker := conversion.NewWorker(
			&repoAdapter{repo},
			conversion.Config{
				DataDir:       dataDir,
				ChunkSize:     chunkSize,
				StorageFormat: format,
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
	log.Printf("Converting %s to %s (format: %s, chunk size: %d)", inputFile, outputPath, format, chunkSize)

	engine, err := storage.GetEngine(format)
	if err != nil {
		return fmt.Errorf("unknown format %q: %w", format, err)
	}

	if err := engine.Convert(ctx, inputFile, outputPath); err != nil {
		return fmt.Errorf("conversion failed: %w", err)
	}

	log.Printf("Conversion complete: %s", outputPath)
	return nil
}

func convertAll(ctx context.Context, repo *server.RepoOperation, setting server.Setting, chunkSize uint32, format string) error {
	operations, err := repo.SelectAll(ctx)
	if err != nil {
		return fmt.Errorf("select operations: %w", err)
	}

	if len(operations) == 0 {
		log.Println("No operations to convert")
		return nil
	}

	log.Printf("Found %d operations to convert (format: %s)", len(operations), format)

	worker := conversion.NewWorker(
		&repoAdapter{repo},
		conversion.Config{
			DataDir:       setting.Data,
			ChunkSize:     chunkSize,
			StorageFormat: format,
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

func app() error {
	setting, err := server.NewSetting()
	if err != nil {
		return fmt.Errorf("setting: %w", err)
	}

	// Configure structured JSON logging
	var logOutput io.Writer = os.Stdout
	var flog *os.File
	if setting.Logger {
		flog, err = os.OpenFile("ocap.log", os.O_RDWR|os.O_CREATE|os.O_APPEND, 0666)
		if err != nil {
			return fmt.Errorf("open logger file: %w", err)
		}
		defer flog.Close()
		logOutput = io.MultiWriter(os.Stdout, flog)
	}

	// Set up slog with JSON handler for consistent logging
	slog.SetDefault(slog.New(slog.NewJSONHandler(logOutput, nil)))

	operation, err := server.NewRepoOperation(setting.DB)
	if err != nil {
		return fmt.Errorf("operation: %w", err)
	}

	marker, err := server.NewRepoMarker(setting.Markers)
	if err != nil {
		return fmt.Errorf("marker: %w", err)
	}

	ammo, err := server.NewRepoAmmo(setting.Ammo)
	if err != nil {
		return fmt.Errorf("ammo: %w", err)
	}

	e := echo.New()

	loggerConfig := middleware.DefaultLoggerConfig
	loggerConfig.Output = logOutput

	e.Use(
		middleware.LoggerWithConfig(loggerConfig),
	)

	// Create conversion worker if enabled (before handler so we can pass it)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var handlerOpts []server.HandlerOption
	if setting.Conversion.Enabled {
		interval, err := time.ParseDuration(setting.Conversion.Interval)
		if err != nil {
			log.Printf("Invalid conversion interval %q, using default 5m", setting.Conversion.Interval)
			interval = 5 * time.Minute
		}

		worker := conversion.NewWorker(
			&repoAdapter{operation},
			conversion.Config{
				DataDir:       setting.Data,
				Interval:      interval,
				BatchSize:     setting.Conversion.BatchSize,
				ChunkSize:     setting.Conversion.ChunkSize,
				StorageFormat: setting.Conversion.StorageEngine,
			},
		)

		// Pass worker to handler for event-driven conversion on upload
		handlerOpts = append(handlerOpts, server.WithConversionTrigger(worker))

		// Start background worker for retries and batch processing
		go worker.Start(ctx)
	}

	server.NewHandler(e, operation, marker, ammo, setting, handlerOpts...)

	// Handle graceful shutdown
	go func() {
		quit := make(chan os.Signal, 1)
		signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
		<-quit
		cancel()
		e.Shutdown(context.Background())
	}()

	err = e.Start(setting.Listen)
	if err != nil {
		return fmt.Errorf("start server: %w", err)
	}

	return nil
}

// repoAdapter adapts server.RepoOperation to conversion.OperationRepo
type repoAdapter struct {
	repo *server.RepoOperation
}

func (a *repoAdapter) SelectPending(ctx context.Context, limit int) ([]conversion.Operation, error) {
	ops, err := a.repo.SelectPending(ctx, limit)
	if err != nil {
		return nil, err
	}
	result := make([]conversion.Operation, len(ops))
	for i, op := range ops {
		result[i] = conversion.Operation{
			ID:       op.ID,
			Filename: op.Filename,
		}
	}
	return result, nil
}

func (a *repoAdapter) UpdateConversionStatus(ctx context.Context, id int64, status string) error {
	return a.repo.UpdateConversionStatus(ctx, id, status)
}

func (a *repoAdapter) UpdateStorageFormat(ctx context.Context, id int64, format string) error {
	return a.repo.UpdateStorageFormat(ctx, id, format)
}

func (a *repoAdapter) UpdateMissionDuration(ctx context.Context, id int64, duration float64) error {
	return a.repo.UpdateMissionDuration(ctx, id, duration)
}

func (a *repoAdapter) UpdateSchemaVersion(ctx context.Context, id int64, version uint32) error {
	return a.repo.UpdateSchemaVersion(ctx, id, version)
}
