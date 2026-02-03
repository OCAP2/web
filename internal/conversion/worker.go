// server/conversion/worker.go
package conversion

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/OCAP2/web/internal/storage"
)

// OperationRepo defines the repository interface needed by the worker
type OperationRepo interface {
	SelectPending(ctx context.Context, limit int) ([]Operation, error)
	SelectByStatus(ctx context.Context, status string) ([]Operation, error)
	ResetConversionStatus(ctx context.Context, fromStatus, toStatus string) (int64, error)
	UpdateConversionStatus(ctx context.Context, id int64, status string) error
	UpdateStorageFormat(ctx context.Context, id int64, format string) error
	UpdateMissionDuration(ctx context.Context, id int64, duration float64) error
	UpdateSchemaVersion(ctx context.Context, id int64, version uint32) error
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
	retryFailed   bool
}

// Config holds worker configuration
type Config struct {
	DataDir       string
	Interval      time.Duration
	BatchSize     int
	ChunkSize     uint32
	StorageFormat string // "protobuf" or "flatbuffers"
	RetryFailed   bool
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
		retryFailed:   cfg.RetryFailed,
	}
}

// cleanupInterrupted resets interrupted conversions and removes partial output files.
// This should be called once at startup before the background loop.
func (w *Worker) cleanupInterrupted(ctx context.Context) {
	// Always reset 'converting' status (these were interrupted by shutdown)
	ops, err := w.repo.SelectByStatus(ctx, "converting")
	if err != nil {
		slog.Error("failed to select converting operations", "error", err)
	} else {
		for _, op := range ops {
			// Remove partial output directory
			outputPath := filepath.Join(w.dataDir, op.Filename)
			if err := os.RemoveAll(outputPath); err != nil && !os.IsNotExist(err) {
				slog.Warn("failed to remove partial conversion", "path", outputPath, "error", err)
			} else if err == nil {
				slog.Info("removed partial conversion", "path", outputPath)
			}
		}
		if count, err := w.repo.ResetConversionStatus(ctx, "converting", "pending"); err != nil {
			slog.Error("failed to reset converting status", "error", err)
		} else if count > 0 {
			slog.Info("reset interrupted conversions", "count", count)
		}
	}

	// Optionally reset 'failed' status
	if w.retryFailed {
		if count, err := w.repo.ResetConversionStatus(ctx, "failed", "pending"); err != nil {
			slog.Error("failed to reset failed status", "error", err)
		} else if count > 0 {
			slog.Info("reset failed conversions for retry", "count", count)
		}
	}
}

// Start begins the background conversion loop
func (w *Worker) Start(ctx context.Context) {
	slog.Info("conversion worker started", "interval", w.interval, "batch", w.batchSize)

	// Clean up any interrupted conversions from previous run
	w.cleanupInterrupted(ctx)

	// Run immediately on start
	w.processOnce(ctx)

	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			slog.Info("conversion worker stopped")
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
		slog.Error("failed to fetch pending operations", "error", err)
		return
	}

	for _, op := range ops {
		select {
		case <-ctx.Done():
			return
		default:
		}

		if err := w.convertOperation(ctx, op); err != nil {
			slog.Error("conversion failed", "operation_id", op.ID, "filename", op.Filename, "error", err)
			if err := w.repo.UpdateConversionStatus(ctx, op.ID, "failed"); err != nil {
				slog.Error("failed to update status", "operation_id", op.ID, "error", err)
			}
		}
	}
}

// convertOperation converts a single operation from JSON to the configured format
func (w *Worker) convertOperation(ctx context.Context, op Operation) error {
	slog.Info("converting", "operation_id", op.ID, "filename", op.Filename, "format", w.storageFormat)

	// Update status to converting
	if err := w.repo.UpdateConversionStatus(ctx, op.ID, "converting"); err != nil {
		return fmt.Errorf("update status to converting: %w", err)
	}

	// Determine paths
	jsonPath := filepath.Join(w.dataDir, op.Filename+".json.gz")
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

	// Read manifest to get duration info
	manifest, err := engine.GetManifest(ctx, op.Filename)
	if err != nil {
		slog.Warn("failed to read manifest for duration", "error", err)
	} else {
		// Calculate duration: frameCount * captureDelayMs / 1000 (to seconds)
		durationSeconds := float64(manifest.FrameCount) * float64(manifest.CaptureDelayMs) / 1000.0
		if err := w.repo.UpdateMissionDuration(ctx, op.ID, durationSeconds); err != nil {
			slog.Warn("failed to update mission duration", "error", err)
		}
	}

	// Update database with the actual format used
	if err := w.repo.UpdateStorageFormat(ctx, op.ID, w.storageFormat); err != nil {
		return fmt.Errorf("update storage format: %w", err)
	}
	if err := w.repo.UpdateConversionStatus(ctx, op.ID, "completed"); err != nil {
		return fmt.Errorf("update status to completed: %w", err)
	}

	slog.Info("conversion completed", "operation_id", op.ID, "filename", op.Filename)
	return nil
}

// ConvertOne converts a single operation by ID (for CLI/manual use)
func (w *Worker) ConvertOne(ctx context.Context, id int64, filename string) error {
	return w.convertOperation(ctx, Operation{ID: id, Filename: filename})
}

// TriggerConversion starts an async conversion for the given operation.
// This is called immediately after upload for event-driven conversion.
// It spawns a goroutine and returns immediately (non-blocking).
func (w *Worker) TriggerConversion(id int64, filename string) {
	go func() {
		ctx := context.Background()
		if err := w.convertOperation(ctx, Operation{ID: id, Filename: filename}); err != nil {
			slog.Error("async conversion failed", "operation_id", id, "filename", filename, "error", err)
			if err := w.repo.UpdateConversionStatus(ctx, id, "failed"); err != nil {
				slog.Error("failed to update status", "operation_id", id, "error", err)
			}
		}
	}()
}
