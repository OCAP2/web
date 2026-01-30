package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/OCAP2/web/internal/conversion"
	"github.com/OCAP2/web/internal/server"
	"github.com/OCAP2/web/internal/storage"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRepoAdapter_SelectPending(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")

	repo, err := server.NewRepoOperation(pathDB)
	require.NoError(t, err)

	ctx := context.Background()

	// Store some operations with different statuses
	ops := []*server.Operation{
		{WorldName: "altis", MissionName: "Pending 1", Filename: "p1", Date: "2026-01-01", ConversionStatus: "pending"},
		{WorldName: "altis", MissionName: "Completed", Filename: "c1", Date: "2026-01-02", ConversionStatus: "completed"},
		{WorldName: "altis", MissionName: "Pending 2", Filename: "p2", Date: "2026-01-03", ConversionStatus: "pending"},
	}
	for _, op := range ops {
		err = repo.Store(ctx, op)
		require.NoError(t, err)
	}

	adapter := &repoAdapter{repo: repo}

	// Test SelectPending
	pending, err := adapter.SelectPending(ctx, 10)
	require.NoError(t, err)
	assert.Len(t, pending, 2)

	// Verify conversion to conversion.Operation type
	assert.Equal(t, "p1", pending[0].Filename)
	assert.Equal(t, "p2", pending[1].Filename)
}

func TestRepoAdapter_UpdateConversionStatus(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")

	repo, err := server.NewRepoOperation(pathDB)
	require.NoError(t, err)

	ctx := context.Background()

	// Store an operation
	op := &server.Operation{
		WorldName:        "altis",
		MissionName:      "Test",
		Filename:         "test",
		Date:             "2026-01-01",
		ConversionStatus: "pending",
	}
	err = repo.Store(ctx, op)
	require.NoError(t, err)

	adapter := &repoAdapter{repo: repo}

	// Update status via adapter
	err = adapter.UpdateConversionStatus(ctx, op.ID, "completed")
	require.NoError(t, err)

	// Verify update
	updated, err := repo.GetByID(ctx, "1")
	require.NoError(t, err)
	assert.Equal(t, "completed", updated.ConversionStatus)
}

func TestRepoAdapter_UpdateStorageFormat(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")

	repo, err := server.NewRepoOperation(pathDB)
	require.NoError(t, err)

	ctx := context.Background()

	// Store an operation
	op := &server.Operation{
		WorldName:     "altis",
		MissionName:   "Test",
		Filename:      "test",
		Date:          "2026-01-01",
		StorageFormat: "json",
	}
	err = repo.Store(ctx, op)
	require.NoError(t, err)

	adapter := &repoAdapter{repo: repo}

	// Update format via adapter
	err = adapter.UpdateStorageFormat(ctx, op.ID, "protobuf")
	require.NoError(t, err)

	// Verify update
	updated, err := repo.GetByID(ctx, "1")
	require.NoError(t, err)
	assert.Equal(t, "protobuf", updated.StorageFormat)
}

func TestRepoAdapter_UpdateMissionDuration(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")

	repo, err := server.NewRepoOperation(pathDB)
	require.NoError(t, err)

	ctx := context.Background()

	// Store an operation
	op := &server.Operation{
		WorldName:       "altis",
		MissionName:     "Test",
		Filename:        "test",
		Date:            "2026-01-01",
		MissionDuration: 100,
	}
	err = repo.Store(ctx, op)
	require.NoError(t, err)

	adapter := &repoAdapter{repo: repo}

	// Update duration via adapter
	err = adapter.UpdateMissionDuration(ctx, op.ID, 3600.5)
	require.NoError(t, err)

	// Verify update
	updated, err := repo.GetByID(ctx, "1")
	require.NoError(t, err)
	assert.Equal(t, 3600.5, updated.MissionDuration)
}

func TestShowConversionStatus(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")

	repo, err := server.NewRepoOperation(pathDB)
	require.NoError(t, err)

	ctx := context.Background()

	// Store some operations
	ops := []*server.Operation{
		{WorldName: "altis", MissionName: "Mission Alpha", Filename: "alpha", Date: "2026-01-01", StorageFormat: "json", ConversionStatus: "completed"},
		{WorldName: "stratis", MissionName: "Mission Beta", Filename: "beta", Date: "2026-01-02", StorageFormat: "protobuf", ConversionStatus: "pending"},
	}
	for _, op := range ops {
		err = repo.Store(ctx, op)
		require.NoError(t, err)
	}

	// Capture stdout
	old := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w

	err = showConversionStatus(ctx, repo)
	require.NoError(t, err)

	w.Close()
	os.Stdout = old

	var buf bytes.Buffer
	buf.ReadFrom(r)
	output := buf.String()

	// Verify output contains expected data
	assert.Contains(t, output, "Mission Alpha")
	assert.Contains(t, output, "Mission Beta")
	assert.Contains(t, output, "json")
	assert.Contains(t, output, "protobuf")
	assert.Contains(t, output, "completed")
	assert.Contains(t, output, "pending")
}

func TestShowConversionStatus_LongName(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")

	repo, err := server.NewRepoOperation(pathDB)
	require.NoError(t, err)

	ctx := context.Background()

	// Store operation with very long name (should be truncated)
	op := &server.Operation{
		WorldName:        "altis",
		MissionName:      "This Is A Very Long Mission Name That Exceeds The Display Limit",
		Filename:         "longname",
		Date:             "2026-01-01",
		StorageFormat:    "json",
		ConversionStatus: "completed",
	}
	err = repo.Store(ctx, op)
	require.NoError(t, err)

	// Capture stdout
	old := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w

	err = showConversionStatus(ctx, repo)
	require.NoError(t, err)

	w.Close()
	os.Stdout = old

	var buf bytes.Buffer
	buf.ReadFrom(r)
	output := buf.String()

	// Name should be truncated with ".."
	assert.Contains(t, output, "..")
}

func TestConvertSingleFile(t *testing.T) {
	dir := t.TempDir()
	dataDir := filepath.Join(dir, "data")
	err := os.MkdirAll(dataDir, 0755)
	require.NoError(t, err)

	// Create test JSON file
	inputPath := filepath.Join(dir, "test_mission.json.gz")
	testJSON := `{
		"worldName": "altis",
		"missionName": "Single File Test",
		"endFrame": 5,
		"captureDelay": 1,
		"entities": [
			{
				"id": 0,
				"type": "unit",
				"name": "Player1",
				"side": "WEST",
				"startFrameNum": 0,
				"positions": [
					[[100, 200], 45, 1, 0, "Player1", 1],
					[[101, 201], 46, 1, 0, "Player1", 1],
					[[102, 202], 47, 1, 0, "Player1", 1],
					[[103, 203], 48, 1, 0, "Player1", 1],
					[[104, 204], 49, 1, 0, "Player1", 1]
				]
			}
		],
		"events": [],
		"Markers": []
	}`

	// Write gzipped JSON
	f, err := os.Create(inputPath)
	require.NoError(t, err)
	gw := gzip.NewWriter(f)
	_, err = gw.Write([]byte(testJSON))
	require.NoError(t, err)
	gw.Close()
	f.Close()

	ctx := context.Background()

	// Register engines
	storage.RegisterEngine(storage.NewProtobufEngine(dataDir))

	err = convertSingleFile(ctx, inputPath, dataDir, 300, "protobuf")
	require.NoError(t, err)

	// Verify output was created
	outputDir := filepath.Join(dataDir, "test_mission")
	_, err = os.Stat(filepath.Join(outputDir, "manifest.pb"))
	require.NoError(t, err)
}

func TestConvertSingleFile_InvalidFormat(t *testing.T) {
	dir := t.TempDir()
	inputPath := filepath.Join(dir, "test.json.gz")

	// Create empty file
	f, _ := os.Create(inputPath)
	f.Close()

	ctx := context.Background()

	err := convertSingleFile(ctx, inputPath, dir, 300, "invalid_format")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unknown format")
}

func TestConvertAll_Empty(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")

	repo, err := server.NewRepoOperation(pathDB)
	require.NoError(t, err)

	ctx := context.Background()
	setting := server.Setting{Data: dir}

	// Capture stdout
	old := os.Stdout
	_, w, _ := os.Pipe()
	os.Stdout = w

	err = convertAll(ctx, repo, setting, 300, "protobuf")

	w.Close()
	os.Stdout = old

	require.NoError(t, err)
}

// Verify repoAdapter implements conversion.OperationRepo
var _ conversion.OperationRepo = (*repoAdapter)(nil)
