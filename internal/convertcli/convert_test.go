package convertcli

import (
	"bytes"
	"compress/gzip"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/OCAP2/web/internal/conversion"
	"github.com/OCAP2/web/internal/server"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// testDeps builds a deps struct for use in unit tests.
// It ignores the dbPath passed to newRepo and always returns the provided repo.
// stdout and stderr are captured in the returned buffers.
func testDeps(t *testing.T, repo *server.RepoOperation, dataDir string) (deps, *bytes.Buffer, *bytes.Buffer) {
	t.Helper()
	var stdout, stderr bytes.Buffer
	return deps{
		loadSettings: func() (server.Setting, error) {
			return server.Setting{DB: "ignored", Data: dataDir}, nil
		},
		newRepo: func(_ string) (*server.RepoOperation, error) {
			return repo, nil
		},
		stdout: &stdout,
		stderr: &stderr,
	}, &stdout, &stderr
}

// newTempRepo creates a fresh RepoOperation backed by a temp SQLite DB.
func newTempRepo(t *testing.T) (*server.RepoOperation, string) {
	t.Helper()
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")
	repo, err := server.NewRepoOperation(pathDB)
	require.NoError(t, err)
	return repo, dir
}

// writeGzipJSON writes a gzipped JSON file at path with the provided content.
func writeGzipJSON(t *testing.T, path, content string) {
	t.Helper()
	f, err := os.Create(path)
	require.NoError(t, err)
	gw := gzip.NewWriter(f)
	_, err = gw.Write([]byte(content))
	require.NoError(t, err)
	require.NoError(t, gw.Close())
	require.NoError(t, f.Close())
}

const simpleTestJSON = `{
	"worldName": "altis",
	"missionName": "Test Mission",
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

// ---------------------------------------------------------------------------
// Existing tests (updated to pass io.Writer to showConversionStatus)
// ---------------------------------------------------------------------------

func TestShowConversionStatus(t *testing.T) {
	repo, _ := newTempRepo(t)
	ctx := context.Background()

	ops := []*server.Operation{
		{WorldName: "altis", MissionName: "Mission Alpha", Filename: "alpha", Date: "2026-01-01", StorageFormat: "json", ConversionStatus: "completed"},
		{WorldName: "stratis", MissionName: "Mission Beta", Filename: "beta", Date: "2026-01-02", StorageFormat: "protobuf", ConversionStatus: "pending"},
	}
	for _, op := range ops {
		require.NoError(t, repo.Store(ctx, op))
	}

	var buf bytes.Buffer
	err := showConversionStatus(ctx, repo, &buf)
	require.NoError(t, err)

	output := buf.String()
	assert.Contains(t, output, "Mission Alpha")
	assert.Contains(t, output, "Mission Beta")
	assert.Contains(t, output, "json")
	assert.Contains(t, output, "protobuf")
	assert.Contains(t, output, "completed")
	assert.Contains(t, output, "pending")
}

func TestShowConversionStatus_LongName(t *testing.T) {
	repo, _ := newTempRepo(t)
	ctx := context.Background()

	op := &server.Operation{
		WorldName:        "altis",
		MissionName:      "This Is A Very Long Mission Name That Exceeds The Display Limit",
		Filename:         "longname",
		Date:             "2026-01-01",
		StorageFormat:    "json",
		ConversionStatus: "completed",
	}
	require.NoError(t, repo.Store(ctx, op))

	var buf bytes.Buffer
	err := showConversionStatus(ctx, repo, &buf)
	require.NoError(t, err)

	assert.Contains(t, buf.String(), "..")
}

func TestConvertSingleFile(t *testing.T) {
	dir := t.TempDir()
	dataDir := filepath.Join(dir, "data")
	require.NoError(t, os.MkdirAll(dataDir, 0755))

	inputPath := filepath.Join(dir, "test_mission.json.gz")
	writeGzipJSON(t, inputPath, simpleTestJSON)

	ctx := context.Background()
	pathDB := filepath.Join(dir, "test.db")
	repo, err := server.NewRepoOperation(pathDB)
	require.NoError(t, err)

	err = convertSingleFile(ctx, repo, inputPath, dataDir, 300)
	require.NoError(t, err)

	outputDir := filepath.Join(dataDir, "test_mission")
	_, err = os.Stat(filepath.Join(outputDir, "manifest.pb"))
	require.NoError(t, err)
}

func TestConvertSingleFile_WithDatabaseEntry(t *testing.T) {
	dir := t.TempDir()
	dataDir := filepath.Join(dir, "data")
	require.NoError(t, os.MkdirAll(dataDir, 0755))

	inputPath := filepath.Join(dataDir, "db_test.json.gz")
	writeGzipJSON(t, inputPath, `{
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
	}`)

	ctx := context.Background()
	pathDB := filepath.Join(dir, "test.db")
	repo, err := server.NewRepoOperation(pathDB)
	require.NoError(t, err)

	op := &server.Operation{
		WorldName:        "Stratis",
		MissionName:      "Test Op",
		MissionDuration:  10,
		Filename:         "db_test",
		Date:             "2024-01-01",
		StorageFormat:    "json",
		ConversionStatus: "pending",
	}
	require.NoError(t, repo.Store(ctx, op))

	err = convertSingleFile(ctx, repo, inputPath, dataDir, 300)
	require.NoError(t, err)

	outputDir := filepath.Join(dataDir, "db_test")
	_, err = os.Stat(filepath.Join(outputDir, "manifest.pb"))
	require.NoError(t, err)

	result, err := repo.GetByFilename(ctx, "db_test")
	require.NoError(t, err)
	assert.Equal(t, "completed", result.ConversionStatus)
	assert.Equal(t, "protobuf", result.StorageFormat)
	assert.Greater(t, result.MissionDuration, float64(0))
}

func TestConvertAll_Empty(t *testing.T) {
	repo, dir := newTempRepo(t)
	ctx := context.Background()
	setting := server.Setting{Data: dir}

	err := convertAll(ctx, repo, setting, 300)
	require.NoError(t, err)
}

func TestConvertAll_WithOperations(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")
	dataDir := filepath.Join(dir, "data")
	require.NoError(t, os.MkdirAll(dataDir, 0755))

	repo, err := server.NewRepoOperation(pathDB)
	require.NoError(t, err)

	ctx := context.Background()

	jsonPath := filepath.Join(dataDir, "test_op.json.gz")
	writeGzipJSON(t, jsonPath, simpleTestJSON)

	op := &server.Operation{
		WorldName:        "altis",
		MissionName:      "Convert All Test",
		Filename:         "test_op",
		Date:             "2026-01-01",
		ConversionStatus: "pending",
	}
	require.NoError(t, repo.Store(ctx, op))

	setting := server.Setting{Data: dataDir}
	err = convertAll(ctx, repo, setting, 300)
	require.NoError(t, err)

	updated, err := repo.GetByID(ctx, "1")
	require.NoError(t, err)
	assert.Equal(t, "completed", updated.ConversionStatus)
}

func TestConvertAll_WithFailedOperation(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")
	dataDir := filepath.Join(dir, "data")
	require.NoError(t, os.MkdirAll(dataDir, 0755))

	repo, err := server.NewRepoOperation(pathDB)
	require.NoError(t, err)

	ctx := context.Background()

	op := &server.Operation{
		WorldName:        "altis",
		MissionName:      "Missing File Test",
		Filename:         "nonexistent",
		Date:             "2026-01-01",
		ConversionStatus: "pending",
	}
	require.NoError(t, repo.Store(ctx, op))

	setting := server.Setting{Data: dataDir}
	err = convertAll(ctx, repo, setting, 300)
	require.NoError(t, err)

	updated, err := repo.GetByID(ctx, "1")
	require.NoError(t, err)
	assert.Equal(t, "failed", updated.ConversionStatus)
}

// ---------------------------------------------------------------------------
// New Run dispatch tests
// ---------------------------------------------------------------------------

func TestRun_StatusFlag(t *testing.T) {
	repo, _ := newTempRepo(t)
	ctx := context.Background()

	op := &server.Operation{
		WorldName:        "altis",
		MissionName:      "Status Test Mission",
		Filename:         "status_test",
		Date:             "2026-01-01",
		StorageFormat:    "json",
		ConversionStatus: "pending",
	}
	require.NoError(t, repo.Store(ctx, op))

	d, stdout, _ := testDeps(t, repo, t.TempDir())
	code := run([]string{"--status"}, d)

	assert.Equal(t, 0, code)
	assert.Contains(t, stdout.String(), "Status Test Mission")
}

func TestRun_SetFormat_RequiresID(t *testing.T) {
	repo, _ := newTempRepo(t)
	d, _, stderr := testDeps(t, repo, t.TempDir())

	code := run([]string{"--set-format", "protobuf"}, d)

	assert.Equal(t, 1, code)
	assert.Contains(t, stderr.String(), "--id")
}

func TestRun_SetFormatHappyPath(t *testing.T) {
	repo, _ := newTempRepo(t)
	ctx := context.Background()

	op := &server.Operation{
		WorldName:        "altis",
		MissionName:      "Format Test",
		Filename:         "format_test",
		Date:             "2026-01-01",
		StorageFormat:    "json",
		ConversionStatus: "pending",
	}
	require.NoError(t, repo.Store(ctx, op))

	d, stdout, _ := testDeps(t, repo, t.TempDir())
	code := run([]string{"--set-format", "protobuf", "--id", "1"}, d)

	assert.Equal(t, 0, code)

	updated, err := repo.GetByFilename(ctx, "format_test")
	require.NoError(t, err)
	assert.Equal(t, "protobuf", updated.StorageFormat)

	// stdout should show status table
	assert.Contains(t, stdout.String(), "Format Test")
}

func TestRun_InputFile_Standalone(t *testing.T) {
	dir := t.TempDir()
	dataDir := filepath.Join(dir, "data")
	require.NoError(t, os.MkdirAll(dataDir, 0755))

	inputPath := filepath.Join(dir, "fixture_mission.json.gz")
	writeGzipJSON(t, inputPath, simpleTestJSON)

	repo, _ := newTempRepo(t)
	d, _, _ := testDeps(t, repo, dataDir)

	code := run([]string{"--input", inputPath}, d)
	assert.Equal(t, 0, code)

	_, err := os.Stat(filepath.Join(dataDir, "fixture_mission", "manifest.pb"))
	assert.NoError(t, err)
}

func TestRun_All_NoOperations(t *testing.T) {
	repo, dataDir := newTempRepo(t)
	d, stdout, stderr := testDeps(t, repo, dataDir)

	code := run([]string{"--all"}, d)

	assert.Equal(t, 0, code)
	assert.NotContains(t, stdout.String(), "error")
	assert.NotContains(t, stderr.String(), "error")
}

func TestRun_DefaultPrintsUsage(t *testing.T) {
	repo, _ := newTempRepo(t)
	d, _, stderr := testDeps(t, repo, t.TempDir())

	code := run([]string{}, d)

	assert.Equal(t, 0, code)
	assert.Contains(t, stderr.String(), "Usage:")
	assert.Contains(t, stderr.String(), "convert")
}

func TestRun_SettingsLoadError(t *testing.T) {
	var stdout, stderr bytes.Buffer
	d := deps{
		loadSettings: func() (server.Setting, error) {
			return server.Setting{}, errors.New("settings file not found")
		},
		newRepo: func(_ string) (*server.RepoOperation, error) {
			return nil, nil
		},
		stdout: &stdout,
		stderr: &stderr,
	}

	code := run([]string{"--status"}, d)

	assert.Equal(t, 2, code)
	assert.Contains(t, stderr.String(), "settings")
}

func TestRun_RepoCreationError(t *testing.T) {
	var stdout, stderr bytes.Buffer
	d := deps{
		loadSettings: func() (server.Setting, error) {
			return server.Setting{DB: "test.db", Data: "data"}, nil
		},
		newRepo: func(_ string) (*server.RepoOperation, error) {
			return nil, errors.New("cannot open database")
		},
		stdout: &stdout,
		stderr: &stderr,
	}

	code := run([]string{"--status"}, d)

	assert.Equal(t, 2, code)
	// stderr should mention "operation" or "repo"
	stderrStr := stderr.String()
	assert.True(t,
		strings.Contains(stderrStr, "operation") || strings.Contains(stderrStr, "repo"),
		"expected stderr to contain 'operation' or 'repo', got: %q", stderrStr,
	)
}

func TestRun_BadFlag(t *testing.T) {
	repo, _ := newTempRepo(t)
	d, _, _ := testDeps(t, repo, t.TempDir())

	code := run([]string{"--nope"}, d)

	assert.Equal(t, 2, code)
}

func TestRun_InputFile_Error(t *testing.T) {
	// Provide a path that doesn't exist so convertSingleFile returns an error
	repo, dataDir := newTempRepo(t)
	d, _, stderr := testDeps(t, repo, dataDir)

	code := run([]string{"--input", "/nonexistent/path/missing.json.gz"}, d)

	assert.Equal(t, 1, code)
	assert.Contains(t, stderr.String(), "error")
}

func TestRun_All_WithError(t *testing.T) {
	// An operation with a missing file causes convertAll to log errors but still return nil.
	// We verify exit 0 for that case (convertAll swallows per-op errors).
	dir := t.TempDir()
	dataDir := filepath.Join(dir, "data")
	require.NoError(t, os.MkdirAll(dataDir, 0755))

	repo, _ := newTempRepo(t)
	ctx := context.Background()

	op := &server.Operation{
		WorldName:        "altis",
		MissionName:      "Missing File Op",
		Filename:         "missing_op",
		Date:             "2026-01-01",
		ConversionStatus: "pending",
	}
	require.NoError(t, repo.Store(ctx, op))

	d, _, _ := testDeps(t, repo, dataDir)
	code := run([]string{"--all"}, d)

	assert.Equal(t, 0, code)
}

// Verify *server.RepoOperation satisfies conversion.OperationRepo
var _ conversion.OperationRepo = (*server.RepoOperation)(nil)
