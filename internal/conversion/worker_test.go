package conversion

import (
	"compress/gzip"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/OCAP2/web/internal/storage"
	"github.com/stretchr/testify/assert"
)

func init() {
	// Register storage engines for tests
	storage.RegisterEngine(storage.NewProtobufEngine("/tmp"))
	storage.RegisterEngine(storage.NewFlatBuffersEngine("/tmp"))
}

// mockRepo implements OperationRepo for testing
type mockRepo struct {
	pending  []Operation
	status   map[int64]string
	format   map[int64]string
	duration map[int64]float64
}

func newMockRepo() *mockRepo {
	return &mockRepo{
		pending:  []Operation{},
		status:   make(map[int64]string),
		format:   make(map[int64]string),
		duration: make(map[int64]float64),
	}
}

func (m *mockRepo) SelectPending(ctx context.Context, limit int) ([]Operation, error) {
	if len(m.pending) <= limit {
		return m.pending, nil
	}
	return m.pending[:limit], nil
}

func (m *mockRepo) UpdateConversionStatus(ctx context.Context, id int64, status string) error {
	m.status[id] = status
	return nil
}

func (m *mockRepo) UpdateStorageFormat(ctx context.Context, id int64, format string) error {
	m.format[id] = format
	return nil
}

func (m *mockRepo) UpdateMissionDuration(ctx context.Context, id int64, duration float64) error {
	m.duration[id] = duration
	return nil
}

func TestWorker_ConvertOne(t *testing.T) {
	dir := t.TempDir()

	// Create test JSON data
	testData := `{
		"worldName": "altis",
		"missionName": "Test Mission",
		"captureDelay": 1,
		"endFrame": 10,
		"entities": [
			{
				"id": 1,
				"type": "unit",
				"startFrameNum": 0,
				"positions": [
					[[100, 200], 45, 1, 0, "Player1", 1],
					[[101, 201], 46, 1, 0, "Player1", 1]
				],
				"framesFired": [],
				"name": "Player1",
				"group": "Alpha",
				"side": "WEST",
				"isPlayer": 1
			}
		],
		"events": [],
		"times": []
	}`

	// Write gzipped JSON file
	jsonPath := filepath.Join(dir, "test_mission.gz")
	f, err := os.Create(jsonPath)
	assert.NoError(t, err)
	gw := gzip.NewWriter(f)
	_, err = gw.Write([]byte(testData))
	assert.NoError(t, err)
	gw.Close()
	f.Close()

	// Create mock repo and worker
	repo := newMockRepo()
	worker := NewWorker(repo, Config{
		DataDir:   dir,
		ChunkSize: 5,
	})

	// Convert
	ctx := context.Background()
	err = worker.ConvertOne(ctx, 1, "test_mission")
	assert.NoError(t, err)

	// Verify status updates
	assert.Equal(t, "completed", repo.status[1])
	assert.Equal(t, "protobuf", repo.format[1])

	// Verify output files exist
	outputDir := filepath.Join(dir, "test_mission")
	_, err = os.Stat(filepath.Join(outputDir, "manifest.pb"))
	assert.NoError(t, err)
	_, err = os.Stat(filepath.Join(outputDir, "chunks", "0000.pb"))
	assert.NoError(t, err)
}

func TestWorker_ProcessOnce(t *testing.T) {
	dir := t.TempDir()

	// Create test JSON data for two operations
	testData := `{
		"worldName": "altis",
		"missionName": "Test",
		"captureDelay": 1,
		"endFrame": 5,
		"entities": [],
		"events": [],
		"times": []
	}`

	// Write gzipped JSON files
	for _, name := range []string{"mission1", "mission2"} {
		jsonPath := filepath.Join(dir, name+".gz")
		f, _ := os.Create(jsonPath)
		gw := gzip.NewWriter(f)
		gw.Write([]byte(testData))
		gw.Close()
		f.Close()
	}

	// Create mock repo with pending operations
	repo := newMockRepo()
	repo.pending = []Operation{
		{ID: 1, Filename: "mission1"},
		{ID: 2, Filename: "mission2"},
	}

	// Create worker with batch size 1
	worker := NewWorker(repo, Config{
		DataDir:   dir,
		BatchSize: 1,
	})

	// Process once (should only process 1 due to batch size)
	ctx := context.Background()
	worker.processOnce(ctx)

	// Only first operation should be completed
	assert.Equal(t, "completed", repo.status[1])
	assert.Equal(t, "protobuf", repo.format[1])
}

func TestWorker_StartStop(t *testing.T) {
	dir := t.TempDir()
	repo := newMockRepo()

	worker := NewWorker(repo, Config{
		DataDir:  dir,
		Interval: 50 * time.Millisecond,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	// Start should run and exit when context is cancelled
	done := make(chan struct{})
	go func() {
		worker.Start(ctx)
		close(done)
	}()

	select {
	case <-done:
		// Worker stopped as expected
	case <-time.After(500 * time.Millisecond):
		t.Fatal("Worker did not stop in time")
	}
}

func TestWorker_MissingFile(t *testing.T) {
	dir := t.TempDir()
	repo := newMockRepo()

	worker := NewWorker(repo, Config{
		DataDir: dir,
	})

	ctx := context.Background()
	err := worker.ConvertOne(ctx, 1, "nonexistent")

	// Should fail with file not found
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not found")

	// Status should be set to converting before failure
	assert.Equal(t, "converting", repo.status[1])
}

func TestDefaultConfig(t *testing.T) {
	cfg := DefaultConfig()

	assert.Equal(t, 5*time.Minute, cfg.Interval)
	assert.Equal(t, 1, cfg.BatchSize)
	assert.Equal(t, uint32(storage.DefaultChunkSize), cfg.ChunkSize)
	assert.Empty(t, cfg.DataDir)
	assert.Empty(t, cfg.StorageFormat)
}

func TestNewWorker_Defaults(t *testing.T) {
	dir := t.TempDir()
	repo := newMockRepo()

	t.Run("applies default interval", func(t *testing.T) {
		worker := NewWorker(repo, Config{
			DataDir:  dir,
			Interval: 0, // Zero should be replaced with default
		})
		assert.Equal(t, 5*time.Minute, worker.interval)
	})

	t.Run("applies default batch size", func(t *testing.T) {
		worker := NewWorker(repo, Config{
			DataDir:   dir,
			BatchSize: 0, // Zero should be replaced with default
		})
		assert.Equal(t, 1, worker.batchSize)
	})

	t.Run("applies default storage format", func(t *testing.T) {
		worker := NewWorker(repo, Config{
			DataDir:       dir,
			StorageFormat: "", // Empty should be replaced with default
		})
		assert.Equal(t, "protobuf", worker.storageFormat)
	})

	t.Run("respects custom values", func(t *testing.T) {
		worker := NewWorker(repo, Config{
			DataDir:       dir,
			Interval:      10 * time.Minute,
			BatchSize:     5,
			StorageFormat: "flatbuffers",
		})
		assert.Equal(t, 10*time.Minute, worker.interval)
		assert.Equal(t, 5, worker.batchSize)
		assert.Equal(t, "flatbuffers", worker.storageFormat)
	})
}

func TestTriggerConversion(t *testing.T) {
	dir := t.TempDir()

	// Create test JSON data
	testData := `{
		"worldName": "altis",
		"missionName": "Trigger Test",
		"captureDelay": 1,
		"endFrame": 5,
		"entities": [],
		"events": [],
		"times": []
	}`

	// Write gzipped JSON file
	jsonPath := filepath.Join(dir, "trigger_mission.gz")
	f, err := os.Create(jsonPath)
	assert.NoError(t, err)
	gw := gzip.NewWriter(f)
	gw.Write([]byte(testData))
	gw.Close()
	f.Close()

	repo := newMockRepo()
	worker := NewWorker(repo, Config{
		DataDir:   dir,
		ChunkSize: 10,
	})

	// TriggerConversion is async, so we need to wait for it
	worker.TriggerConversion(1, "trigger_mission")

	// Wait for async conversion to complete
	timeout := time.After(5 * time.Second)
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-timeout:
			t.Fatal("Timeout waiting for async conversion")
		case <-ticker.C:
			if status, ok := repo.status[1]; ok && status == "completed" {
				// Conversion completed
				assert.Equal(t, "protobuf", repo.format[1])
				return
			}
		}
	}
}

func TestTriggerConversion_Failure(t *testing.T) {
	dir := t.TempDir()
	repo := newMockRepo()

	worker := NewWorker(repo, Config{
		DataDir: dir,
	})

	// Trigger conversion for non-existent file
	worker.TriggerConversion(99, "nonexistent_file")

	// Wait for async conversion to fail
	timeout := time.After(2 * time.Second)
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-timeout:
			t.Fatal("Timeout waiting for async conversion failure")
		case <-ticker.C:
			if status, ok := repo.status[99]; ok && status == "failed" {
				// Conversion failed as expected
				return
			}
		}
	}
}

func TestWorker_FlatBuffersFormat(t *testing.T) {
	dir := t.TempDir()

	// Create test JSON data
	testData := `{
		"worldName": "altis",
		"missionName": "FlatBuffers Test",
		"captureDelay": 1,
		"endFrame": 5,
		"entities": [
			{
				"id": 1,
				"type": "unit",
				"startFrameNum": 0,
				"positions": [
					[[100, 200], 45, 1, 0, "Player1", 1]
				],
				"framesFired": [],
				"name": "Player1",
				"group": "Alpha",
				"side": "WEST",
				"isPlayer": 1
			}
		],
		"events": [],
		"times": []
	}`

	// Write gzipped JSON file
	jsonPath := filepath.Join(dir, "fb_test.gz")
	f, err := os.Create(jsonPath)
	assert.NoError(t, err)
	gw := gzip.NewWriter(f)
	gw.Write([]byte(testData))
	gw.Close()
	f.Close()

	repo := newMockRepo()
	worker := NewWorker(repo, Config{
		DataDir:       dir,
		ChunkSize:     10,
		StorageFormat: "flatbuffers",
	})

	ctx := context.Background()
	err = worker.ConvertOne(ctx, 1, "fb_test")
	assert.NoError(t, err)

	// Verify flatbuffers format was used
	assert.Equal(t, "completed", repo.status[1])
	assert.Equal(t, "flatbuffers", repo.format[1])

	// Verify output files exist
	outputDir := filepath.Join(dir, "fb_test")
	_, err = os.Stat(filepath.Join(outputDir, "manifest.fb"))
	assert.NoError(t, err)
}

func TestWorker_ContextCancellation(t *testing.T) {
	dir := t.TempDir()

	// Create test JSON data for multiple operations
	testData := `{
		"worldName": "altis",
		"missionName": "Cancel Test",
		"captureDelay": 1,
		"endFrame": 5,
		"entities": [],
		"events": [],
		"times": []
	}`

	// Write multiple gzipped JSON files
	for i := 1; i <= 3; i++ {
		jsonPath := filepath.Join(dir, fmt.Sprintf("cancel_%d.gz", i))
		f, _ := os.Create(jsonPath)
		gw := gzip.NewWriter(f)
		gw.Write([]byte(testData))
		gw.Close()
		f.Close()
	}

	repo := newMockRepo()
	repo.pending = []Operation{
		{ID: 1, Filename: "cancel_1"},
		{ID: 2, Filename: "cancel_2"},
		{ID: 3, Filename: "cancel_3"},
	}

	worker := NewWorker(repo, Config{
		DataDir:   dir,
		BatchSize: 10, // Allow all operations
	})

	// Create a cancelled context
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	// processOnce should exit early due to cancelled context
	worker.processOnce(ctx)

	// Not all operations should be completed
	completedCount := 0
	for _, status := range repo.status {
		if status == "completed" {
			completedCount++
		}
	}
	// At most 1 should complete (the one that started before cancel was checked)
	assert.LessOrEqual(t, completedCount, 1)
}
