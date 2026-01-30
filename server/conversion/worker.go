// server/conversion/worker.go
package conversion

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/OCAP2/web/server/storage"
)

// OperationRepo defines the repository interface needed by the worker
type OperationRepo interface {
	SelectPending(ctx context.Context, limit int) ([]Operation, error)
	UpdateConversionStatus(ctx context.Context, id int64, status string) error
	UpdateStorageFormat(ctx context.Context, id int64, format string) error
}

// Operation represents a minimal operation for conversion
type Operation struct {
	ID       int64
	Filename string
}

// Worker handles background conversion of JSON recordings to binary format
type Worker struct {
	repo          OperationRepo
	dataDir       string
	converter     *storage.Converter
	interval      time.Duration
	batchSize     int
	storageFormat string
}

// Config holds worker configuration
type Config struct {
	DataDir       string
	Interval      time.Duration
	BatchSize     int
	ChunkSize     uint32
	StorageFormat string // "protobuf" or "flatbuffers"
}

// DefaultConfig returns default worker configuration
func DefaultConfig() Config {
	return Config{
		Interval:  5 * time.Minute,
		BatchSize: 1,
		ChunkSize: storage.DefaultChunkSize,
	}
}

// NewWorker creates a new conversion worker
func NewWorker(repo OperationRepo, cfg Config) *Worker {
	if cfg.Interval == 0 {
		cfg.Interval = 5 * time.Minute
	}
	if cfg.BatchSize == 0 {
		cfg.BatchSize = 1
	}
	if cfg.StorageFormat == "" {
		cfg.StorageFormat = "protobuf"
	}

	return &Worker{
		repo:          repo,
		dataDir:       cfg.DataDir,
		converter:     storage.NewConverter(cfg.ChunkSize),
		interval:      cfg.Interval,
		batchSize:     cfg.BatchSize,
		storageFormat: cfg.StorageFormat,
	}
}

// Start begins the background conversion loop
func (w *Worker) Start(ctx context.Context) {
	log.Printf("Conversion worker started (interval: %v, batch: %d)", w.interval, w.batchSize)

	// Run immediately on start
	w.processOnce(ctx)

	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Printf("Conversion worker stopped")
			return
		case <-ticker.C:
			w.processOnce(ctx)
		}
	}
}

// processOnce runs a single conversion batch
func (w *Worker) processOnce(ctx context.Context) {
	ops, err := w.repo.SelectPending(ctx, w.batchSize)
	if err != nil {
		log.Printf("Error fetching pending operations: %v", err)
		return
	}

	for _, op := range ops {
		select {
		case <-ctx.Done():
			return
		default:
		}

		if err := w.convertOperation(ctx, op); err != nil {
			log.Printf("Error converting operation %d (%s): %v", op.ID, op.Filename, err)
			if err := w.repo.UpdateConversionStatus(ctx, op.ID, "failed"); err != nil {
				log.Printf("Error updating status to failed: %v", err)
			}
		}
	}
}

// convertOperation converts a single operation from JSON to the configured format
func (w *Worker) convertOperation(ctx context.Context, op Operation) error {
	log.Printf("Converting operation %d: %s (format: %s)", op.ID, op.Filename, w.storageFormat)

	// Update status to converting
	if err := w.repo.UpdateConversionStatus(ctx, op.ID, "converting"); err != nil {
		return fmt.Errorf("update status to converting: %w", err)
	}

	// Determine paths
	jsonPath := filepath.Join(w.dataDir, op.Filename+".gz")
	outputPath := filepath.Join(w.dataDir, op.Filename)

	// Check if JSON file exists
	if _, err := os.Stat(jsonPath); os.IsNotExist(err) {
		return fmt.Errorf("JSON file not found: %s", jsonPath)
	}

	// Get the appropriate storage engine
	engine, err := storage.GetEngine(w.storageFormat)
	if err != nil {
		return fmt.Errorf("get storage engine: %w", err)
	}

	// Run conversion using the storage engine
	if err := engine.Convert(ctx, jsonPath, outputPath); err != nil {
		return fmt.Errorf("conversion failed: %w", err)
	}

	// Update database with the actual format used
	if err := w.repo.UpdateStorageFormat(ctx, op.ID, w.storageFormat); err != nil {
		return fmt.Errorf("update storage format: %w", err)
	}
	if err := w.repo.UpdateConversionStatus(ctx, op.ID, "completed"); err != nil {
		return fmt.Errorf("update status to completed: %w", err)
	}

	log.Printf("Completed conversion for operation %d: %s", op.ID, op.Filename)
	return nil
}

// ConvertOne converts a single operation by ID (for CLI/manual use)
func (w *Worker) ConvertOne(ctx context.Context, id int64, filename string) error {
	return w.convertOperation(ctx, Operation{ID: id, Filename: filename})
}
