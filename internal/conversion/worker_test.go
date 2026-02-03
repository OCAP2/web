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
	pending       []Operation
	status        map[int64]string
	format        map[int64]string
	duration      map[int64]float64
	schemaVersion map[int64]uint32
	byStatus      map[string][]Operation
}

func newMockRepo() *mockRepo {
	return &mockRepo{
		pending:       []Operation{},
		status:        make(map[int64]string),
		format:        make(map[int64]string),
		duration:      make(map[int64]float64),
		schemaVersion: make(map[int64]uint32),
		byStatus:      make(map[string][]Operation),
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

func (m *mockRepo) UpdateSchemaVersion(ctx context.Context, id int64, version uint32) error {
	m.schemaVersion[id] = version
	return nil
}

func (m *mockRepo) SelectByStatus(ctx context.Context, status string) ([]Operation, error) {
	return m.byStatus[status], nil
}

func (m *mockRepo) ResetConversionStatus(ctx context.Context, fromStatus, toStatus string) (int64, error) {
	ops := m.byStatus[fromStatus]
	delete(m.byStatus, fromStatus)
	m.byStatus[toStatus] = append(m.byStatus[toStatus], ops...)
	// Also update individual status tracking
	for _, op := range ops {
		m.status[op.ID] = toStatus
	}
	return int64(len(ops)), nil
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
	jsonPath := filepath.Join(dir, "test_mission.json.gz")
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
		jsonPath := filepath.Join(dir, name+".json.gz")
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
	jsonPath := filepath.Join(dir, "trigger_mission.json.gz")
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
	jsonPath := filepath.Join(dir, "fb_test.json.gz")
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
		jsonPath := filepath.Join(dir, fmt.Sprintf("cancel_%d.json.gz", i))
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

// errorMockRepo is a mock that can return errors for testing error paths
type errorMockRepo struct {
	pending                  []Operation
	byStatus                 map[string][]Operation
	status                   map[int64]string
	format                   map[int64]string
	duration                 map[int64]float64
	schemaVersion            map[int64]uint32
	selectPendingErr         error
	selectByStatusErr        error
	resetConversionStatusErr error
	updateStatusErr          error
	updateFormatErr          error
	updateDurationErr        error
	failStatusUpdateOnID     int64  // only fail for this ID
	failStatusUpdateAfter    string // only fail when setting this status
}

func newErrorMockRepo() *errorMockRepo {
	return &errorMockRepo{
		pending:       []Operation{},
		byStatus:      make(map[string][]Operation),
		status:        make(map[int64]string),
		format:        make(map[int64]string),
		duration:      make(map[int64]float64),
		schemaVersion: make(map[int64]uint32),
	}
}

func (m *errorMockRepo) SelectPending(ctx context.Context, limit int) ([]Operation, error) {
	if m.selectPendingErr != nil {
		return nil, m.selectPendingErr
	}
	if len(m.pending) <= limit {
		return m.pending, nil
	}
	return m.pending[:limit], nil
}

func (m *errorMockRepo) UpdateConversionStatus(ctx context.Context, id int64, status string) error {
	if m.updateStatusErr != nil {
		if m.failStatusUpdateOnID == 0 || m.failStatusUpdateOnID == id {
			if m.failStatusUpdateAfter == "" || m.failStatusUpdateAfter == status {
				return m.updateStatusErr
			}
		}
	}
	m.status[id] = status
	return nil
}

func (m *errorMockRepo) UpdateStorageFormat(ctx context.Context, id int64, format string) error {
	if m.updateFormatErr != nil {
		return m.updateFormatErr
	}
	m.format[id] = format
	return nil
}

func (m *errorMockRepo) UpdateMissionDuration(ctx context.Context, id int64, duration float64) error {
	if m.updateDurationErr != nil {
		return m.updateDurationErr
	}
	m.duration[id] = duration
	return nil
}

func (m *errorMockRepo) UpdateSchemaVersion(ctx context.Context, id int64, version uint32) error {
	m.schemaVersion[id] = version
	return nil
}

func (m *errorMockRepo) SelectByStatus(ctx context.Context, status string) ([]Operation, error) {
	if m.selectByStatusErr != nil {
		return nil, m.selectByStatusErr
	}
	return m.byStatus[status], nil
}

func (m *errorMockRepo) ResetConversionStatus(ctx context.Context, fromStatus, toStatus string) (int64, error) {
	if m.resetConversionStatusErr != nil {
		return 0, m.resetConversionStatusErr
	}
	ops := m.byStatus[fromStatus]
	delete(m.byStatus, fromStatus)
	m.byStatus[toStatus] = append(m.byStatus[toStatus], ops...)
	return int64(len(ops)), nil
}

func TestProcessOnce_SelectPendingError(t *testing.T) {
	dir := t.TempDir()
	repo := newErrorMockRepo()
	repo.selectPendingErr = fmt.Errorf("database connection failed")

	worker := NewWorker(repo, Config{
		DataDir: dir,
	})

	ctx := context.Background()
	// Should not panic, just log error and return
	worker.processOnce(ctx)

	// No operations should be processed
	assert.Empty(t, repo.status)
}

func TestProcessOnce_ConversionFailureStatusUpdateError(t *testing.T) {
	dir := t.TempDir()
	repo := newErrorMockRepo()
	repo.pending = []Operation{
		{ID: 1, Filename: "nonexistent"},
	}
	// Fail the "failed" status update after conversion error
	repo.updateStatusErr = fmt.Errorf("status update failed")
	repo.failStatusUpdateAfter = "failed"

	worker := NewWorker(repo, Config{
		DataDir: dir,
	})

	ctx := context.Background()
	// Should not panic, conversion fails and then status update fails
	worker.processOnce(ctx)

	// Status for "converting" should be set (before the failure)
	assert.Equal(t, "converting", repo.status[1])
}

func TestConvertOperation_UpdateConvertingStatusError(t *testing.T) {
	dir := t.TempDir()

	// Create test JSON file
	testData := `{"worldName": "test", "missionName": "Test", "endFrame": 5, "captureDelay": 1, "entities": [], "events": [], "times": []}`
	jsonPath := filepath.Join(dir, "test.json.gz")
	f, _ := os.Create(jsonPath)
	gw := gzip.NewWriter(f)
	gw.Write([]byte(testData))
	gw.Close()
	f.Close()

	repo := newErrorMockRepo()
	repo.updateStatusErr = fmt.Errorf("cannot update to converting")
	repo.failStatusUpdateAfter = "converting"

	worker := NewWorker(repo, Config{
		DataDir: dir,
	})

	ctx := context.Background()
	err := worker.ConvertOne(ctx, 1, "test")

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "update status to converting")
}

func TestConvertOperation_UpdateStorageFormatError(t *testing.T) {
	dir := t.TempDir()

	// Create test JSON file
	testData := `{"worldName": "test", "missionName": "Test", "endFrame": 5, "captureDelay": 1, "entities": [], "events": [], "times": []}`
	jsonPath := filepath.Join(dir, "test.json.gz")
	f, _ := os.Create(jsonPath)
	gw := gzip.NewWriter(f)
	gw.Write([]byte(testData))
	gw.Close()
	f.Close()

	repo := newErrorMockRepo()
	repo.updateFormatErr = fmt.Errorf("cannot update format")

	worker := NewWorker(repo, Config{
		DataDir: dir,
	})

	ctx := context.Background()
	err := worker.ConvertOne(ctx, 1, "test")

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "update storage format")
}

func TestConvertOperation_UpdateCompletedStatusError(t *testing.T) {
	dir := t.TempDir()

	// Create test JSON file
	testData := `{"worldName": "test", "missionName": "Test", "endFrame": 5, "captureDelay": 1, "entities": [], "events": [], "times": []}`
	jsonPath := filepath.Join(dir, "test.json.gz")
	f, _ := os.Create(jsonPath)
	gw := gzip.NewWriter(f)
	gw.Write([]byte(testData))
	gw.Close()
	f.Close()

	repo := newErrorMockRepo()
	repo.updateStatusErr = fmt.Errorf("cannot update to completed")
	repo.failStatusUpdateAfter = "completed"

	worker := NewWorker(repo, Config{
		DataDir: dir,
	})

	ctx := context.Background()
	err := worker.ConvertOne(ctx, 1, "test")

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "update status to completed")
}

func TestConvertOperation_UpdateDurationError(t *testing.T) {
	dir := t.TempDir()

	// Create test JSON file
	testData := `{"worldName": "test", "missionName": "Test", "endFrame": 5, "captureDelay": 1, "entities": [], "events": [], "times": []}`
	jsonPath := filepath.Join(dir, "test.json.gz")
	f, _ := os.Create(jsonPath)
	gw := gzip.NewWriter(f)
	gw.Write([]byte(testData))
	gw.Close()
	f.Close()

	repo := newErrorMockRepo()
	repo.updateDurationErr = fmt.Errorf("cannot update duration")

	worker := NewWorker(repo, Config{
		DataDir: dir,
	})

	ctx := context.Background()
	// Should complete successfully despite duration update failure (it's just a warning)
	err := worker.ConvertOne(ctx, 1, "test")

	assert.NoError(t, err)
	assert.Equal(t, "completed", repo.status[1])
}

func TestConvertOperation_InvalidStorageFormat(t *testing.T) {
	dir := t.TempDir()

	// Create test JSON file
	testData := `{"worldName": "test", "missionName": "Test", "endFrame": 5, "captureDelay": 1, "entities": [], "events": [], "times": []}`
	jsonPath := filepath.Join(dir, "test.json.gz")
	f, _ := os.Create(jsonPath)
	gw := gzip.NewWriter(f)
	gw.Write([]byte(testData))
	gw.Close()
	f.Close()

	repo := newErrorMockRepo()
	worker := NewWorker(repo, Config{
		DataDir:       dir,
		StorageFormat: "invalid_format",
	})

	ctx := context.Background()
	err := worker.ConvertOne(ctx, 1, "test")

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "get storage engine")
}

func TestConvertOperation_JSONFileNotFound(t *testing.T) {
	dir := t.TempDir()
	// Don't create the JSON file - test the "file not found" error path

	repo := newErrorMockRepo()
	worker := NewWorker(repo, Config{
		DataDir: dir,
	})

	ctx := context.Background()
	err := worker.ConvertOne(ctx, 1, "nonexistent")

	assert.Error(t, err)
	assert.Contains(t, err.Error(), "JSON file not found")
}

func TestTriggerConversion_FailedStatusUpdateError(t *testing.T) {
	dir := t.TempDir()
	// Don't create the JSON file - will fail and try to update status to "failed"

	repo := newErrorMockRepo()
	// Make status updates fail after the initial "converting" update
	repo.updateStatusErr = fmt.Errorf("status update failed")

	worker := NewWorker(repo, Config{
		DataDir: dir,
	})

	// TriggerConversion is async, just verify it doesn't panic
	worker.TriggerConversion(1, "nonexistent")

	// Give the goroutine time to run
	time.Sleep(100 * time.Millisecond)
}

func TestWorker_CleanupInterrupted(t *testing.T) {
	dir := t.TempDir()

	// Create partial output directories
	partial1 := filepath.Join(dir, "mission1")
	partial2 := filepath.Join(dir, "mission2")
	os.MkdirAll(filepath.Join(partial1, "chunks"), 0755)
	os.MkdirAll(filepath.Join(partial2, "chunks"), 0755)

	// Create mock repo with converting operations
	repo := newMockRepo()
	repo.byStatus["converting"] = []Operation{
		{ID: 1, Filename: "mission1"},
		{ID: 2, Filename: "mission2"},
	}
	repo.byStatus["failed"] = []Operation{
		{ID: 3, Filename: "mission3"},
	}

	worker := NewWorker(repo, Config{
		DataDir:       dir,
		StorageFormat: "protobuf",
		RetryFailed:   false,
	})

	ctx := context.Background()
	worker.cleanupInterrupted(ctx)

	// Verify partial directories removed
	_, err := os.Stat(partial1)
	assert.True(t, os.IsNotExist(err), "partial1 should be removed")
	_, err = os.Stat(partial2)
	assert.True(t, os.IsNotExist(err), "partial2 should be removed")

	// Verify converting reset to pending
	assert.Len(t, repo.byStatus["pending"], 2)
	assert.Len(t, repo.byStatus["converting"], 0)

	// Verify failed NOT reset (retryFailed=false)
	assert.Len(t, repo.byStatus["failed"], 1)
}

func TestWorker_CleanupInterrupted_RetryFailed(t *testing.T) {
	dir := t.TempDir()

	repo := newMockRepo()
	repo.byStatus["converting"] = []Operation{
		{ID: 1, Filename: "mission1"},
	}
	repo.byStatus["failed"] = []Operation{
		{ID: 2, Filename: "mission2"},
		{ID: 3, Filename: "mission3"},
	}

	worker := NewWorker(repo, Config{
		DataDir:       dir,
		StorageFormat: "protobuf",
		RetryFailed:   true, // Enable retry of failed
	})

	ctx := context.Background()
	worker.cleanupInterrupted(ctx)

	// Verify both converting and failed reset to pending
	assert.Len(t, repo.byStatus["pending"], 3)
	assert.Len(t, repo.byStatus["converting"], 0)
	assert.Len(t, repo.byStatus["failed"], 0)
}

func TestWorker_CleanupInterrupted_SelectByStatusError(t *testing.T) {
	dir := t.TempDir()

	repo := newErrorMockRepo()
	repo.selectByStatusErr = fmt.Errorf("database error")

	worker := NewWorker(repo, Config{
		DataDir:       dir,
		StorageFormat: "protobuf",
	})

	ctx := context.Background()
	// Should not panic, just log the error
	worker.cleanupInterrupted(ctx)
}

func TestWorker_CleanupInterrupted_ResetStatusError(t *testing.T) {
	dir := t.TempDir()

	repo := newErrorMockRepo()
	repo.byStatus["converting"] = []Operation{
		{ID: 1, Filename: "mission1"},
	}
	repo.resetConversionStatusErr = fmt.Errorf("database error")

	worker := NewWorker(repo, Config{
		DataDir:       dir,
		StorageFormat: "protobuf",
	})

	ctx := context.Background()
	// Should not panic, just log the error
	worker.cleanupInterrupted(ctx)
}

func TestWorker_CleanupInterrupted_ResetFailedError(t *testing.T) {
	dir := t.TempDir()

	repo := newErrorMockRepo()
	repo.byStatus["failed"] = []Operation{
		{ID: 1, Filename: "mission1"},
	}
	repo.resetConversionStatusErr = fmt.Errorf("database error")

	worker := NewWorker(repo, Config{
		DataDir:       dir,
		StorageFormat: "protobuf",
		RetryFailed:   true,
	})

	ctx := context.Background()
	// Should not panic, just log the error
	worker.cleanupInterrupted(ctx)
}
