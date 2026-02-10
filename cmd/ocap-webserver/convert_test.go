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
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

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

	// Create test database
	pathDB := filepath.Join(dir, "test.db")
	repo, err := server.NewRepoOperation(pathDB)
	require.NoError(t, err)


	err = convertSingleFile(ctx, repo, inputPath, dataDir, 300)
	require.NoError(t, err)

	// Verify output was created
	outputDir := filepath.Join(dataDir, "test_mission")
	_, err = os.Stat(filepath.Join(outputDir, "manifest.pb"))
	require.NoError(t, err)
}


func TestConvertSingleFile_WithDatabaseEntry(t *testing.T) {
	dir := t.TempDir()
	dataDir := filepath.Join(dir, "data")
	err := os.MkdirAll(dataDir, 0755)
	require.NoError(t, err)

	// Create test JSON input file
	inputPath := filepath.Join(dataDir, "db_test.json.gz")
	testJSON := `{
		"worldName": "altis",
		"missionName": "DB Entry Test",
		"endFrame": 5,
		"captureDelay": 1000,
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
	f, err := os.Create(inputPath)
	require.NoError(t, err)
	gw := gzip.NewWriter(f)
	_, err = gw.Write([]byte(testJSON))
	require.NoError(t, err)
	gw.Close()
	f.Close()

	ctx := context.Background()

	// Create test database with operation entry
	pathDB := filepath.Join(dir, "test.db")
	repo, err := server.NewRepoOperation(pathDB)
	require.NoError(t, err)

	// Store operation matching the filename
	op := &server.Operation{
		WorldName:        "Stratis",
		MissionName:      "Test Op",
		MissionDuration:  10,
		Filename:         "db_test",
		Date:             "2024-01-01",
		StorageFormat:    "json",
		ConversionStatus: "pending",
	}
	err = repo.Store(ctx, op)
	require.NoError(t, err)


	// Convert - should use worker path since operation exists
	err = convertSingleFile(ctx, repo, inputPath, dataDir, 300)
	require.NoError(t, err)

	// Verify output was created
	outputDir := filepath.Join(dataDir, "db_test")
	_, err = os.Stat(filepath.Join(outputDir, "manifest.pb"))
	require.NoError(t, err)

	// Verify database was updated
	result, err := repo.GetByFilename(ctx, "db_test")
	require.NoError(t, err)
	assert.Equal(t, "completed", result.ConversionStatus)
	assert.Equal(t, "protobuf", result.StorageFormat)
	assert.Greater(t, result.MissionDuration, float64(0))
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

	err = convertAll(ctx, repo, setting, 300)

	w.Close()
	os.Stdout = old

	require.NoError(t, err)
}

func TestConvertAll_WithOperations(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")
	dataDir := filepath.Join(dir, "data")
	err := os.MkdirAll(dataDir, 0755)
	require.NoError(t, err)

	repo, err := server.NewRepoOperation(pathDB)
	require.NoError(t, err)

	ctx := context.Background()

	// Create test JSON file
	testJSON := `{
		"worldName": "altis",
		"missionName": "Convert All Test",
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
	jsonPath := filepath.Join(dataDir, "test_op.json.gz")
	f, err := os.Create(jsonPath)
	require.NoError(t, err)
	gw := gzip.NewWriter(f)
	_, err = gw.Write([]byte(testJSON))
	require.NoError(t, err)
	gw.Close()
	f.Close()

	// Store operation in database
	op := &server.Operation{
		WorldName:        "altis",
		MissionName:      "Convert All Test",
		Filename:         "test_op",
		Date:             "2026-01-01",
		ConversionStatus: "pending",
	}
	err = repo.Store(ctx, op)
	require.NoError(t, err)

	setting := server.Setting{Data: dataDir}


	// Capture stdout
	old := os.Stdout
	_, w, _ := os.Pipe()
	os.Stdout = w

	err = convertAll(ctx, repo, setting, 300)

	w.Close()
	os.Stdout = old

	require.NoError(t, err)

	// Verify conversion was attempted
	updated, err := repo.GetByID(ctx, "1")
	require.NoError(t, err)
	assert.Equal(t, "completed", updated.ConversionStatus)
}

func TestConvertAll_WithFailedOperation(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")
	dataDir := filepath.Join(dir, "data")
	err := os.MkdirAll(dataDir, 0755)
	require.NoError(t, err)

	repo, err := server.NewRepoOperation(pathDB)
	require.NoError(t, err)

	ctx := context.Background()

	// Store operation without creating the JSON file (will fail conversion)
	op := &server.Operation{
		WorldName:        "altis",
		MissionName:      "Missing File Test",
		Filename:         "nonexistent",
		Date:             "2026-01-01",
		ConversionStatus: "pending",
	}
	err = repo.Store(ctx, op)
	require.NoError(t, err)

	setting := server.Setting{Data: dataDir}


	// Capture stdout
	old := os.Stdout
	_, w, _ := os.Pipe()
	os.Stdout = w

	err = convertAll(ctx, repo, setting, 300)

	w.Close()
	os.Stdout = old

	// Should not return error even if conversion fails
	require.NoError(t, err)

	// Verify status was updated to failed
	updated, err := repo.GetByID(ctx, "1")
	require.NoError(t, err)
	assert.Equal(t, "failed", updated.ConversionStatus)
}

// Verify *server.RepoOperation satisfies conversion.OperationRepo
var _ conversion.OperationRepo = (*server.RepoOperation)(nil)
