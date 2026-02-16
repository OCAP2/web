// server/conversion/worker.go
package conversion

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/OCAP2/web/internal/server"
	"github.com/OCAP2/web/internal/storage"
)

// OperationRepo defines the repository interface needed by the worker
type OperationRepo interface {
	SelectPending(ctx context.Context, limit int) ([]server.Operation, error)
	SelectByStatus(ctx context.Context, status string) ([]server.Operation, error)
	SelectStatsBackfill(ctx context.Context) ([]server.Operation, error)
	ResetConversionStatus(ctx context.Context, fromStatus, toStatus string) (int64, error)
	UpdateConversionStatus(ctx context.Context, id int64, status string) error
	UpdateStorageFormat(ctx context.Context, id int64, format string) error
	UpdateMissionDuration(ctx context.Context, id int64, duration float64) error
	UpdateSchemaVersion(ctx context.Context, id int64, version uint32) error
	UpdateChunkCount(ctx context.Context, id int64, count int) error
	UpdateOperationStats(ctx context.Context, id int64, playerCount, killCount, playerKillCount int, sideComposition server.SideComposition) error
}

// Worker handles background conversion of JSON recordings to protobuf format
type Worker struct {
	repo        OperationRepo
	dataDir     string
	converter   *storage.Converter
	engine      storage.Engine
	interval    time.Duration
	batchSize   int
	retryFailed bool
}

// Config holds worker configuration
type Config struct {
	DataDir     string
	Interval    time.Duration
	BatchSize   int
	ChunkSize   uint32
	RetryFailed bool
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

	return &Worker{
		repo:        repo,
		dataDir:     cfg.DataDir,
		converter:   storage.NewConverter(cfg.ChunkSize),
		engine:      storage.NewProtobufEngine(cfg.DataDir),
		interval:    cfg.Interval,
		batchSize:   cfg.BatchSize,
		retryFailed: cfg.RetryFailed,
	}
}

// cleanupInterrupted resets interrupted conversions and removes partial output files.
// This should be called once at startup before the background loop.
func (w *Worker) cleanupInterrupted(ctx context.Context) {
	// Reset 'streaming' status (ingestion was interrupted by server shutdown — no partial files to clean up)
	if count, err := w.repo.ResetConversionStatus(ctx, server.ConversionStatusStreaming, server.ConversionStatusPending); err != nil {
		slog.Error("failed to reset streaming status", "error", err)
	} else if count > 0 {
		slog.Info("reset interrupted streaming sessions", "count", count)
	}

	// Always reset 'converting' status (these were interrupted by shutdown)
	ops, err := w.repo.SelectByStatus(ctx, server.ConversionStatusConverting)
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
		if count, err := w.repo.ResetConversionStatus(ctx, server.ConversionStatusConverting, server.ConversionStatusPending); err != nil {
			slog.Error("failed to reset converting status", "error", err)
		} else if count > 0 {
			slog.Info("reset interrupted conversions", "count", count)
		}
	}

	// Optionally reset 'failed' status
	if w.retryFailed {
		if count, err := w.repo.ResetConversionStatus(ctx, server.ConversionStatusFailed, server.ConversionStatusPending); err != nil {
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

	// Backfill stats for existing completed operations
	w.backfillStats(ctx)

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
			if err := w.repo.UpdateConversionStatus(ctx, op.ID, server.ConversionStatusFailed); err != nil {
				slog.Error("failed to update status", "operation_id", op.ID, "error", err)
			}
		}
	}
}

// convertOperation converts a single operation from JSON to protobuf format
func (w *Worker) convertOperation(ctx context.Context, op server.Operation) error {
	slog.Info("converting", "operation_id", op.ID, "filename", op.Filename)

	// Update status to converting
	if err := w.repo.UpdateConversionStatus(ctx, op.ID, server.ConversionStatusConverting); err != nil {
		return fmt.Errorf("update status to converting: %w", err)
	}

	// Determine paths
	jsonPath := filepath.Join(w.dataDir, op.Filename+".json.gz")
	outputPath := filepath.Join(w.dataDir, op.Filename)

	// Check if JSON file exists
	if _, err := os.Stat(jsonPath); os.IsNotExist(err) {
		return fmt.Errorf("JSON file not found: %s", jsonPath)
	}

	// Run conversion using the storage engine
	if err := w.engine.Convert(ctx, jsonPath, outputPath); err != nil {
		return fmt.Errorf("conversion failed: %w", err)
	}

	// Read manifest to get duration info and compute stats
	manifest, err := w.engine.GetManifest(ctx, op.Filename)
	if err != nil {
		slog.Warn("failed to read manifest for duration", "error", err)
	} else {
		// Calculate duration: frameCount * captureDelayMs / 1000 (to seconds)
		durationSeconds := float64(manifest.FrameCount) * float64(manifest.CaptureDelayMs) / 1000.0
		if err := w.repo.UpdateMissionDuration(ctx, op.ID, durationSeconds); err != nil {
			slog.Warn("failed to update mission duration", "error", err)
		}
		if err := w.repo.UpdateChunkCount(ctx, op.ID, int(manifest.ChunkCount)); err != nil {
			slog.Warn("failed to update chunk count", "error", err)
		}

		// Compute and store operation stats
		playerCount, killCount, playerKillCount, sides := computeStats(manifest)
		if err := w.repo.UpdateOperationStats(ctx, op.ID, playerCount, killCount, playerKillCount, sides); err != nil {
			slog.Warn("failed to update operation stats", "error", err)
		}
	}

	// Update database format
	if err := w.repo.UpdateStorageFormat(ctx, op.ID, "protobuf"); err != nil {
		return fmt.Errorf("update storage format: %w", err)
	}
	if err := w.repo.UpdateConversionStatus(ctx, op.ID, server.ConversionStatusCompleted); err != nil {
		return fmt.Errorf("update status to completed: %w", err)
	}

	slog.Info("conversion completed", "operation_id", op.ID, "filename", op.Filename)
	return nil
}

// ConvertOne converts a single operation by ID (for CLI/manual use)
func (w *Worker) ConvertOne(ctx context.Context, id int64, filename string) error {
	return w.convertOperation(ctx, server.Operation{ID: id, Filename: filename})
}

// computeStats derives player count, kill count, player kill count, and side composition from a manifest.
func computeStats(manifest *storage.Manifest) (playerCount, killCount, playerKillCount int, sides server.SideComposition) {
	sides = make(server.SideComposition)

	// Build entity lookups
	// Deduplicate players by name: respawns/JIPs create new entities for the same player.
	entityIsPlayer := make(map[uint32]bool)
	entitySide := make(map[uint32]string)
	seenPlayerName := make(map[string]bool)
	seenPlayerSide := make(map[string]map[string]bool) // name -> set of sides already counted
	for _, ent := range manifest.Entities {
		if ent.Type == "unit" {
			if ent.IsPlayer {
				entityIsPlayer[ent.ID] = true
				if ent.Name == "" || !seenPlayerName[ent.Name] {
					seenPlayerName[ent.Name] = true
					playerCount++
				}
			}
			if ent.Side != "" && ent.Side != "UNKNOWN" && ent.Side != "GLOBAL" {
				entitySide[ent.ID] = ent.Side
				sc := sides[ent.Side]
				sc.Units++
				if ent.IsPlayer {
					if ent.Name == "" {
						sc.Players++
					} else {
						if seenPlayerSide[ent.Name] == nil {
							seenPlayerSide[ent.Name] = make(map[string]bool)
						}
						if !seenPlayerSide[ent.Name][ent.Side] {
							seenPlayerSide[ent.Name][ent.Side] = true
							sc.Players++
						}
					}
				}
				sides[ent.Side] = sc
			}
		}
	}

	for _, evt := range manifest.Events {
		if evt.Type == "killed" {
			killCount++
			if entityIsPlayer[evt.SourceID] {
				playerKillCount++
			}
			// Per-side kill attribution
			if sourceSide, ok := entitySide[evt.SourceID]; ok {
				sc := sides[sourceSide]
				sc.Kills++
				sides[sourceSide] = sc
			}
			// Per-side death tracking
			if targetSide, ok := entitySide[evt.TargetID]; ok {
				sc := sides[targetSide]
				sc.Dead++
				sides[targetSide] = sc
			}
		}
	}
	return
}

// backfillStats populates stats for completed operations that don't have them yet.
func (w *Worker) backfillStats(ctx context.Context) {
	ops, err := w.repo.SelectStatsBackfill(ctx)
	if err != nil {
		slog.Error("failed to select operations for stats backfill", "error", err)
		return
	}
	if len(ops) == 0 {
		return
	}

	slog.Info("backfilling operation stats", "count", len(ops))
	filled := 0
	for _, op := range ops {
		// Try protobuf engine first, fall back to JSON
		manifest, err := w.engine.GetManifest(ctx, op.Filename)
		if err != nil {
			jsonEngine := storage.NewJSONEngine(w.dataDir)
			manifest, err = jsonEngine.GetManifest(ctx, op.Filename)
			if err != nil {
				slog.Debug("skipping stats backfill", "operation_id", op.ID, "error", err)
				continue
			}
		}
		playerCount, killCount, playerKillCount, sides := computeStats(manifest)
		if playerCount == 0 && killCount == 0 {
			continue
		}
		if err := w.repo.UpdateOperationStats(ctx, op.ID, playerCount, killCount, playerKillCount, sides); err != nil {
			slog.Warn("failed to backfill stats", "operation_id", op.ID, "error", err)
			continue
		}
		filled++
	}
	if filled > 0 {
		slog.Info("stats backfill completed", "filled", filled, "total", len(ops))
	}
}

// TriggerConversion starts an async conversion for the given operation.
// This is called immediately after upload for event-driven conversion.
// It spawns a goroutine and returns immediately (non-blocking).
func (w *Worker) TriggerConversion(id int64, filename string) {
	go func() {
		ctx := context.Background()
		if err := w.convertOperation(ctx, server.Operation{ID: id, Filename: filename}); err != nil {
			slog.Error("async conversion failed", "operation_id", id, "filename", filename, "error", err)
			if err := w.repo.UpdateConversionStatus(ctx, id, server.ConversionStatusFailed); err != nil {
				slog.Error("failed to update status", "operation_id", id, "error", err)
			}
		}
	}()
}
