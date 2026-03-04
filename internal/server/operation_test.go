package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMigration(t *testing.T) {
	tmp := os.TempDir()
	db := path.Join(tmp, "data.db")
	defer os.RemoveAll(db)

	_, err := NewRepoOperation(db)
	assert.NoError(t, err)
}

func TestMigrationV3StorageFormat(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")

	repo, err := NewRepoOperation(pathDB)
	assert.NoError(t, err)
	defer func() { assert.NoError(t, repo.db.Close()) }()

	// Verify columns exist
	var storageFormat, conversionStatus string
	err = repo.db.QueryRow("SELECT storage_format, conversion_status FROM operations LIMIT 1").Scan(&storageFormat, &conversionStatus)
	// Should get no rows error, not missing column error
	assert.ErrorIs(t, err, sql.ErrNoRows)
}

func TestMigrationV5NormalizeFilenames(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")

	// Create DB manually with legacy filenames (pre-v5)
	db, err := sql.Open("sqlite3", pathDB)
	require.NoError(t, err)

	_, err = db.Exec(`
		CREATE TABLE version (id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, db INTEGER);
		CREATE TABLE operations (
			id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
			world_name TEXT NOT NULL, mission_name TEXT NOT NULL, mission_duration INTEGER NOT NULL,
			filename TEXT NOT NULL, date TEXT NOT NULL, tag TEXT NOT NULL DEFAULT '',
			storage_format TEXT DEFAULT 'json', conversion_status TEXT DEFAULT 'completed',
			schema_version INTEGER DEFAULT 1
		);
		INSERT INTO version (db) VALUES (4);
		INSERT INTO operations (world_name, mission_name, mission_duration, filename, date)
			VALUES ('altis', 'M1', 3600, 'mission_one.json', '2026-01-01');
		INSERT INTO operations (world_name, mission_name, mission_duration, filename, date)
			VALUES ('altis', 'M2', 3600, 'mission_two.json.gz', '2026-01-02');
		INSERT INTO operations (world_name, mission_name, mission_duration, filename, date)
			VALUES ('altis', 'M3', 3600, 'mission_clean', '2026-01-03');
	`)
	require.NoError(t, err)
	require.NoError(t, db.Close())

	// Open via NewRepoOperation which runs migrations
	repo, err := NewRepoOperation(pathDB)
	require.NoError(t, err)
	defer func() { assert.NoError(t, repo.db.Close()) }()

	ctx := context.Background()
	ops, err := repo.Select(ctx, Filter{Older: "2099-12-31", Newer: "2000-01-01"})
	require.NoError(t, err)
	require.Len(t, ops, 3)

	// All filenames should be normalized (newest first by default)
	filenames := map[string]bool{}
	for _, op := range ops {
		filenames[op.Filename] = true
	}
	assert.True(t, filenames["mission_one"])
	assert.True(t, filenames["mission_two"])
	assert.True(t, filenames["mission_clean"])
}

func TestOperationStorageFormat(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")

	repo, err := NewRepoOperation(pathDB)
	assert.NoError(t, err)
	defer func() { assert.NoError(t, repo.db.Close()) }()

	ctx := context.Background()

	// Store operation with format
	op := &Operation{
		WorldName:        "altis",
		MissionName:      "Test Mission",
		MissionDuration:  3600,
		Filename:         "test_mission",
		Date:             "2026-01-30",
		Tag:              "coop",
		StorageFormat:    "protobuf",
		ConversionStatus: "completed",
	}
	err = repo.Store(ctx, op)
	assert.NoError(t, err)

	// Select and verify - use filter with date range that includes the stored operation
	ops, err := repo.Select(ctx, Filter{
		Older: "2099-12-31",
		Newer: "2000-01-01",
	})
	assert.NoError(t, err)
	assert.Len(t, ops, 1)
	assert.Equal(t, "protobuf", ops[0].StorageFormat)
	assert.Equal(t, "completed", ops[0].ConversionStatus)
}

func TestGetTypes(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")

	repo, err := NewRepoOperation(pathDB)
	assert.NoError(t, err)
	defer func() { assert.NoError(t, repo.db.Close()) }()

	ctx := context.Background()

	// Store operations with different tags
	ops := []*Operation{
		{WorldName: "altis", MissionName: "M1", Filename: "m1", Date: "2026-01-01", Tag: "coop"},
		{WorldName: "altis", MissionName: "M2", Filename: "m2", Date: "2026-01-02", Tag: "tvt"},
		{WorldName: "altis", MissionName: "M3", Filename: "m3", Date: "2026-01-03", Tag: "coop"},
		{WorldName: "altis", MissionName: "M4", Filename: "m4", Date: "2026-01-04", Tag: "zeus"},
	}

	for _, op := range ops {
		err = repo.Store(ctx, op)
		assert.NoError(t, err)
	}

	tags, err := repo.GetTypes(ctx)
	assert.NoError(t, err)
	assert.Len(t, tags, 3)
	assert.Contains(t, tags, "coop")
	assert.Contains(t, tags, "tvt")
	assert.Contains(t, tags, "zeus")
}

func TestSelectAll(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")

	repo, err := NewRepoOperation(pathDB)
	assert.NoError(t, err)
	defer func() { assert.NoError(t, repo.db.Close()) }()

	ctx := context.Background()

	// Store multiple operations
	ops := []*Operation{
		{WorldName: "altis", MissionName: "Mission 1", Filename: "m1", Date: "2026-01-01", Tag: "coop"},
		{WorldName: "stratis", MissionName: "Mission 2", Filename: "m2", Date: "2026-01-02", Tag: "tvt"},
		{WorldName: "tanoa", MissionName: "Mission 3", Filename: "m3", Date: "2026-01-03", Tag: "zeus"},
	}

	for _, op := range ops {
		err = repo.Store(ctx, op)
		assert.NoError(t, err)
	}

	// SelectAll should return all operations
	result, err := repo.SelectAll(ctx)
	assert.NoError(t, err)
	assert.Len(t, result, 3)

	// Should be ordered by ID ASC
	assert.Equal(t, "Mission 1", result[0].MissionName)
	assert.Equal(t, "Mission 2", result[1].MissionName)
	assert.Equal(t, "Mission 3", result[2].MissionName)
}

func TestUpdateMissionDuration(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")

	repo, err := NewRepoOperation(pathDB)
	assert.NoError(t, err)
	defer func() { assert.NoError(t, repo.db.Close()) }()

	ctx := context.Background()

	// Store operation
	op := &Operation{
		WorldName:       "altis",
		MissionName:     "Duration Test",
		MissionDuration: 100,
		Filename:        "duration_test",
		Date:            "2026-01-30",
		Tag:             "coop",
	}
	err = repo.Store(ctx, op)
	assert.NoError(t, err)

	// Update duration
	err = repo.UpdateMissionDuration(ctx, op.ID, 3600.5)
	assert.NoError(t, err)

	// Verify update
	updated, err := repo.GetByID(ctx, "1")
	assert.NoError(t, err)
	assert.Equal(t, 3600.5, updated.MissionDuration)
}

func TestStoreDefaults(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")

	repo, err := NewRepoOperation(pathDB)
	assert.NoError(t, err)
	defer func() { assert.NoError(t, repo.db.Close()) }()

	ctx := context.Background()

	// Store operation without StorageFormat and ConversionStatus
	op := &Operation{
		WorldName:   "altis",
		MissionName: "Default Test",
		Filename:    "default_test",
		Date:        "2026-01-30",
		Tag:         "coop",
	}
	err = repo.Store(ctx, op)
	assert.NoError(t, err)

	// Verify defaults were applied
	result, err := repo.GetByID(ctx, "1")
	assert.NoError(t, err)
	assert.Equal(t, "json", result.StorageFormat)
	assert.Equal(t, "pending", result.ConversionStatus)
}

func TestSelectWithFilters(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")

	repo, err := NewRepoOperation(pathDB)
	assert.NoError(t, err)
	defer func() { assert.NoError(t, repo.db.Close()) }()

	ctx := context.Background()

	// Store operations with varied data
	ops := []*Operation{
		{WorldName: "altis", MissionName: "Alpha Strike", Filename: "alpha", Date: "2026-01-10", Tag: "coop"},
		{WorldName: "altis", MissionName: "Beta Force", Filename: "beta", Date: "2026-01-15", Tag: "tvt"},
		{WorldName: "stratis", MissionName: "Alpha Team", Filename: "alphat", Date: "2026-01-20", Tag: "coop"},
	}

	for _, op := range ops {
		err = repo.Store(ctx, op)
		assert.NoError(t, err)
	}

	t.Run("filter by name partial match", func(t *testing.T) {
		result, err := repo.Select(ctx, Filter{Name: "Alpha"})
		assert.NoError(t, err)
		assert.Len(t, result, 2)
	})

	t.Run("filter by tag", func(t *testing.T) {
		result, err := repo.Select(ctx, Filter{Tag: "coop"})
		assert.NoError(t, err)
		assert.Len(t, result, 2)
	})

	t.Run("filter by date range", func(t *testing.T) {
		result, err := repo.Select(ctx, Filter{
			Newer: "2026-01-12",
			Older: "2026-01-18",
		})
		assert.NoError(t, err)
		assert.Len(t, result, 1)
		assert.Equal(t, "Beta Force", result[0].MissionName)
	})

	t.Run("combined filters", func(t *testing.T) {
		result, err := repo.Select(ctx, Filter{
			Name: "Alpha",
			Tag:  "coop",
		})
		assert.NoError(t, err)
		assert.Len(t, result, 2)
	})

	t.Run("no matches", func(t *testing.T) {
		result, err := repo.Select(ctx, Filter{Name: "Nonexistent"})
		assert.NoError(t, err)
		assert.Len(t, result, 0)
	})
}

func TestGetByID_NotFound(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")

	repo, err := NewRepoOperation(pathDB)
	assert.NoError(t, err)
	defer func() { assert.NoError(t, repo.db.Close()) }()

	ctx := context.Background()

	// Try to get non-existent operation
	_, err = repo.GetByID(ctx, "999")
	assert.Error(t, err)
	assert.ErrorIs(t, err, sql.ErrNoRows)
}

func TestSelectPending(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")

	repo, err := NewRepoOperation(pathDB)
	assert.NoError(t, err)
	defer func() { assert.NoError(t, repo.db.Close()) }()

	ctx := context.Background()

	// Store operations with various statuses
	ops := []*Operation{
		{WorldName: "altis", MissionName: "Pending 1", Filename: "p1", Date: "2026-01-01", ConversionStatus: "pending"},
		{WorldName: "altis", MissionName: "Completed 1", Filename: "c1", Date: "2026-01-02", ConversionStatus: "completed"},
		{WorldName: "altis", MissionName: "Pending 2", Filename: "p2", Date: "2026-01-03", ConversionStatus: "pending"},
		{WorldName: "altis", MissionName: "Failed 1", Filename: "f1", Date: "2026-01-04", ConversionStatus: "failed"},
	}

	for _, op := range ops {
		err = repo.Store(ctx, op)
		assert.NoError(t, err)
	}

	// SelectPending with limit 1
	result, err := repo.SelectPending(ctx, 1)
	assert.NoError(t, err)
	assert.Len(t, result, 1)
	assert.Equal(t, "Pending 1", result[0].MissionName)

	// SelectPending with limit 10 (more than available)
	result, err = repo.SelectPending(ctx, 10)
	assert.NoError(t, err)
	assert.Len(t, result, 2)
	assert.Equal(t, "Pending 1", result[0].MissionName)
	assert.Equal(t, "Pending 2", result[1].MissionName)
}

func TestUpdateConversionStatus(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")

	repo, err := NewRepoOperation(pathDB)
	assert.NoError(t, err)
	defer func() { assert.NoError(t, repo.db.Close()) }()

	ctx := context.Background()

	// Store operation
	op := &Operation{
		WorldName:        "altis",
		MissionName:      "Status Test",
		Filename:         "status_test",
		Date:             "2026-01-30",
		ConversionStatus: "pending",
	}
	err = repo.Store(ctx, op)
	assert.NoError(t, err)

	// Update status
	err = repo.UpdateConversionStatus(ctx, op.ID, "completed")
	assert.NoError(t, err)

	// Verify update
	updated, err := repo.GetByID(ctx, "1")
	assert.NoError(t, err)
	assert.Equal(t, "completed", updated.ConversionStatus)
}

func TestUpdateStorageFormat(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")

	repo, err := NewRepoOperation(pathDB)
	assert.NoError(t, err)
	defer func() { assert.NoError(t, repo.db.Close()) }()

	ctx := context.Background()

	// Store operation
	op := &Operation{
		WorldName:     "altis",
		MissionName:   "Format Test",
		Filename:      "format_test",
		Date:          "2026-01-30",
		StorageFormat: "json",
	}
	err = repo.Store(ctx, op)
	assert.NoError(t, err)

	// Update format
	err = repo.UpdateStorageFormat(ctx, op.ID, "protobuf")
	assert.NoError(t, err)

	// Verify update
	updated, err := repo.GetByID(ctx, "1")
	assert.NoError(t, err)
	assert.Equal(t, "protobuf", updated.StorageFormat)
}

func TestMigrationRerun(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")

	// Create and close first repo (runs migrations)
	repo1, err := NewRepoOperation(pathDB)
	assert.NoError(t, err)
	require.NoError(t, repo1.db.Close())

	// Create second repo on same DB (migrations should be idempotent)
	repo2, err := NewRepoOperation(pathDB)
	assert.NoError(t, err)
	defer func() { assert.NoError(t, repo2.db.Close()) }()

	// Verify version table has the correct latest version
	var version int
	err = repo2.db.QueryRow("SELECT db FROM version ORDER BY db DESC LIMIT 1").Scan(&version)
	assert.NoError(t, err)
	assert.Equal(t, 9, version)
}

func TestGetTypesEmpty(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")

	repo, err := NewRepoOperation(pathDB)
	assert.NoError(t, err)
	defer func() { assert.NoError(t, repo.db.Close()) }()

	ctx := context.Background()

	// GetTypes on empty database
	tags, err := repo.GetTypes(ctx)
	assert.NoError(t, err)
	assert.Empty(t, tags)
}

func TestSelectAllEmpty(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")

	repo, err := NewRepoOperation(pathDB)
	assert.NoError(t, err)
	defer func() { assert.NoError(t, repo.db.Close()) }()

	ctx := context.Background()

	// SelectAll on empty database
	result, err := repo.SelectAll(ctx)
	assert.NoError(t, err)
	assert.Empty(t, result)
}

func TestSelectPendingEmpty(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")

	repo, err := NewRepoOperation(pathDB)
	assert.NoError(t, err)
	defer func() { assert.NoError(t, repo.db.Close()) }()

	ctx := context.Background()

	// SelectPending on empty database
	result, err := repo.SelectPending(ctx, 10)
	assert.NoError(t, err)
	assert.Empty(t, result)
}

func TestGetByFilename(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")

	repo, err := NewRepoOperation(pathDB)
	assert.NoError(t, err)
	defer func() { assert.NoError(t, repo.db.Close()) }()

	ctx := context.Background()

	// Store an operation
	op := &Operation{
		WorldName:   "altis",
		MissionName: "test_mission",
		Filename:    "test_file.json",
		Date:        "2024-01-01",
	}
	err = repo.Store(ctx, op)
	assert.NoError(t, err)

	// Get by filename
	result, err := repo.GetByFilename(ctx, "test_file.json")
	assert.NoError(t, err)
	assert.NotNil(t, result)
	assert.Equal(t, "test_file.json", result.Filename)
	assert.Equal(t, "altis", result.WorldName)
}

func TestGetByFilename_NotFound(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")

	repo, err := NewRepoOperation(pathDB)
	assert.NoError(t, err)
	defer func() { assert.NoError(t, repo.db.Close()) }()

	ctx := context.Background()

	// Get non-existent filename
	result, err := repo.GetByFilename(ctx, "nonexistent.json")
	assert.Error(t, err)
	assert.Nil(t, result)
}

func TestUpdateSchemaVersion(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")

	repo, err := NewRepoOperation(pathDB)
	assert.NoError(t, err)
	defer func() { assert.NoError(t, repo.db.Close()) }()

	ctx := context.Background()

	// Store operation
	op := &Operation{
		WorldName:   "altis",
		MissionName: "test_mission",
		Filename:    "test_schema.json",
		Date:        "2024-01-01",
	}
	err = repo.Store(ctx, op)
	assert.NoError(t, err)

	// Update schema version
	err = repo.UpdateSchemaVersion(ctx, op.ID, 2)
	assert.NoError(t, err)

	// Verify
	result, err := repo.GetByID(ctx, "1")
	assert.NoError(t, err)
	assert.Equal(t, uint32(2), result.SchemaVersion)
}

func TestSelectByStatus(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")

	repo, err := NewRepoOperation(pathDB)
	assert.NoError(t, err)
	defer func() { assert.NoError(t, repo.db.Close()) }()

	ctx := context.Background()

	// Insert operations with different statuses
	ops := []*Operation{
		{WorldName: "altis", MissionName: "Converting 1", Filename: "c1", Date: "2026-01-01", ConversionStatus: "converting"},
		{WorldName: "altis", MissionName: "Completed 1", Filename: "c2", Date: "2026-01-02", ConversionStatus: "completed"},
		{WorldName: "altis", MissionName: "Converting 2", Filename: "c3", Date: "2026-01-03", ConversionStatus: "converting"},
		{WorldName: "altis", MissionName: "Failed 1", Filename: "f1", Date: "2026-01-04", ConversionStatus: "failed"},
	}
	for _, op := range ops {
		err := repo.Store(ctx, op)
		assert.NoError(t, err)
	}

	// Select by converting status
	converting, err := repo.SelectByStatus(ctx, "converting")
	assert.NoError(t, err)
	assert.Len(t, converting, 2)

	// Select by failed status
	failed, err := repo.SelectByStatus(ctx, "failed")
	assert.NoError(t, err)
	assert.Len(t, failed, 1)
}

func TestUpdateOperation(t *testing.T) {
	dir := t.TempDir()
	repo, err := NewRepoOperation(filepath.Join(dir, "test.db"))
	require.NoError(t, err)
	defer func() { assert.NoError(t, repo.db.Close()) }()

	ctx := t.Context()
	op := &Operation{
		WorldName: "altis", MissionName: "Original",
		MissionDuration: 300, Filename: "test", Date: "2026-01-01", Tag: "TvT",
	}
	require.NoError(t, repo.Store(ctx, op))

	err = repo.UpdateOperation(ctx, op.ID, "Renamed", "COOP", "2026-02-01", nil, nil)
	require.NoError(t, err)

	updated, err := repo.GetByID(ctx, fmt.Sprintf("%d", op.ID))
	require.NoError(t, err)
	assert.Equal(t, "Renamed", updated.MissionName)
	assert.Equal(t, "COOP", updated.Tag)
	assert.Equal(t, "2026-02-01", updated.Date)
}

func TestDeleteOperation(t *testing.T) {
	dir := t.TempDir()
	repo, err := NewRepoOperation(filepath.Join(dir, "test.db"))
	require.NoError(t, err)
	defer func() { assert.NoError(t, repo.db.Close()) }()

	ctx := t.Context()
	op := &Operation{
		WorldName: "altis", MissionName: "ToDelete",
		MissionDuration: 300, Filename: "to_delete", Date: "2026-01-01",
	}
	require.NoError(t, repo.Store(ctx, op))

	err = repo.Delete(ctx, op.ID)
	require.NoError(t, err)

	_, err = repo.GetByID(ctx, fmt.Sprintf("%d", op.ID))
	assert.Error(t, err) // Should not be found
}

func TestDeleteOperation_NotFound(t *testing.T) {
	dir := t.TempDir()
	repo, err := NewRepoOperation(filepath.Join(dir, "test.db"))
	require.NoError(t, err)
	defer func() { assert.NoError(t, repo.db.Close()) }()

	err = repo.Delete(t.Context(), 999)
	assert.ErrorIs(t, err, ErrNotFound)
}

func TestResetConversionStatus(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")

	repo, err := NewRepoOperation(pathDB)
	assert.NoError(t, err)
	defer func() { assert.NoError(t, repo.db.Close()) }()

	ctx := context.Background()

	// Insert operations with converting status
	ops := []*Operation{
		{WorldName: "altis", MissionName: "Converting 1", Filename: "c1", Date: "2026-01-01", ConversionStatus: "converting"},
		{WorldName: "altis", MissionName: "Completed 1", Filename: "c2", Date: "2026-01-02", ConversionStatus: "completed"},
		{WorldName: "altis", MissionName: "Converting 2", Filename: "c3", Date: "2026-01-03", ConversionStatus: "converting"},
	}
	for _, op := range ops {
		err := repo.Store(ctx, op)
		assert.NoError(t, err)
	}

	// Reset converting to pending
	count, err := repo.ResetConversionStatus(ctx, "converting", "pending")
	assert.NoError(t, err)
	assert.Equal(t, int64(2), count)

	// Verify reset
	pending, err := repo.SelectPending(ctx, 10)
	assert.NoError(t, err)
	assert.Len(t, pending, 2)

	// Verify completed unchanged
	completed, err := repo.SelectByStatus(ctx, "completed")
	assert.NoError(t, err)
	assert.Len(t, completed, 1)
}

func TestUpdateOperationStats(t *testing.T) {
	dir := t.TempDir()
	repo, err := NewRepoOperation(filepath.Join(dir, "test.db"))
	require.NoError(t, err)
	defer func() { assert.NoError(t, repo.db.Close()) }()

	ctx := t.Context()
	op := &Operation{
		WorldName: "altis", MissionName: "Stats Test",
		MissionDuration: 300, Filename: "stats_test", Date: "2026-01-01",
	}
	require.NoError(t, repo.Store(ctx, op))

	sides := SideComposition{
		"WEST": SideCounts{Players: 5, Units: 20, Dead: 2, Kills: 3},
		"EAST": SideCounts{Players: 3, Units: 15, Dead: 1, Kills: 1},
	}
	err = repo.UpdateOperationStats(ctx, op.ID, 8, 4, 3, sides)
	require.NoError(t, err)

	updated, err := repo.GetByID(ctx, fmt.Sprintf("%d", op.ID))
	require.NoError(t, err)
	assert.Equal(t, 8, updated.PlayerCount)
	assert.Equal(t, 4, updated.KillCount)
	assert.Equal(t, 3, updated.PlayerKillCount)
	assert.Equal(t, 5, updated.SideComposition["WEST"].Players)
	assert.Equal(t, 3, updated.SideComposition["EAST"].Players)
}

func TestSelectStatsBackfill(t *testing.T) {
	dir := t.TempDir()
	repo, err := NewRepoOperation(filepath.Join(dir, "test.db"))
	require.NoError(t, err)
	defer func() { assert.NoError(t, repo.db.Close()) }()

	ctx := t.Context()

	// completed, player_count=0 → should appear
	op1 := &Operation{
		WorldName: "altis", MissionName: "NeedsBackfill",
		Filename: "backfill1", Date: "2026-01-01",
		ConversionStatus: "completed", PlayerCount: 0,
	}
	require.NoError(t, repo.Store(ctx, op1))

	// completed, player_count>0 → should NOT appear
	op2 := &Operation{
		WorldName: "altis", MissionName: "HasStats",
		Filename: "has_stats", Date: "2026-01-02",
		ConversionStatus: "completed", PlayerCount: 5,
	}
	require.NoError(t, repo.Store(ctx, op2))

	// pending, player_count=0 → should NOT appear (not completed)
	op3 := &Operation{
		WorldName: "altis", MissionName: "StillPending",
		Filename: "pending1", Date: "2026-01-03",
		ConversionStatus: "pending", PlayerCount: 0,
	}
	require.NoError(t, repo.Store(ctx, op3))

	result, err := repo.SelectStatsBackfill(ctx)
	require.NoError(t, err)
	require.Len(t, result, 1)
	assert.Equal(t, "NeedsBackfill", result[0].MissionName)
}

func TestMarshalSideComposition(t *testing.T) {
	t.Run("nil returns empty JSON object", func(t *testing.T) {
		assert.Equal(t, "{}", marshalSideComposition(nil))
	})
	t.Run("empty map returns empty JSON object", func(t *testing.T) {
		assert.Equal(t, "{}", marshalSideComposition(SideComposition{}))
	})
	t.Run("valid map marshals correctly", func(t *testing.T) {
		sc := SideComposition{"WEST": SideCounts{Players: 2, Units: 10}}
		result := marshalSideComposition(sc)
		var parsed SideComposition
		err := json.Unmarshal([]byte(result), &parsed)
		require.NoError(t, err)
		assert.Equal(t, 2, parsed["WEST"].Players)
		assert.Equal(t, 10, parsed["WEST"].Units)
	})
}

func TestSelectByStatusEmpty(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")

	repo, err := NewRepoOperation(pathDB)
	assert.NoError(t, err)
	defer func() { assert.NoError(t, repo.db.Close()) }()

	ctx := context.Background()

	// Store one operation with "completed" status
	op := &Operation{
		WorldName: "altis", MissionName: "Completed", Filename: "c1",
		Date: "2026-01-01", ConversionStatus: "completed",
	}
	require.NoError(t, repo.Store(ctx, op))

	// Query for a status that has no matches
	result, err := repo.SelectByStatus(ctx, "failed")
	assert.NoError(t, err)
	assert.Empty(t, result)
}

func TestResetConversionStatus_NoMatches(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")

	repo, err := NewRepoOperation(pathDB)
	assert.NoError(t, err)
	defer func() { assert.NoError(t, repo.db.Close()) }()

	ctx := context.Background()

	// Store only completed operations
	op := &Operation{
		WorldName: "altis", MissionName: "Completed", Filename: "c1",
		Date: "2026-01-01", ConversionStatus: "completed",
	}
	require.NoError(t, repo.Store(ctx, op))

	// Reset "converting" to "pending" — no ops match
	count, err := repo.ResetConversionStatus(ctx, "converting", "pending")
	assert.NoError(t, err)
	assert.Equal(t, int64(0), count)
}

func TestUpdateChunkCount(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")

	repo, err := NewRepoOperation(pathDB)
	require.NoError(t, err)
	defer func() { assert.NoError(t, repo.db.Close()) }()

	ctx := context.Background()

	op := &Operation{
		WorldName: "altis", MissionName: "Chunk Test", MissionDuration: 300,
		Filename: "chunk_test", Date: "2026-01-01",
	}
	require.NoError(t, repo.Store(ctx, op))

	// Update chunk count
	err = repo.UpdateChunkCount(ctx, op.ID, 42)
	require.NoError(t, err)

	// Verify
	updated, err := repo.GetByID(ctx, fmt.Sprintf("%d", op.ID))
	require.NoError(t, err)
	assert.Equal(t, 42, updated.ChunkCount)
}

func TestStoreWithAllFields(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")

	repo, err := NewRepoOperation(pathDB)
	require.NoError(t, err)
	defer func() { assert.NoError(t, repo.db.Close()) }()

	ctx := context.Background()

	sides := SideComposition{
		"WEST": SideCounts{Players: 10, Units: 40, Dead: 3, Kills: 5},
		"EAST": SideCounts{Players: 8, Units: 35, Dead: 2, Kills: 4},
	}
	op := &Operation{
		WorldName:        "stratis",
		MissionName:      "Full Fields Test",
		MissionDuration:  7200.5,
		Filename:         "full_fields",
		Date:             "2026-02-15",
		Tag:              "zeus",
		StorageFormat:    "protobuf",
		ConversionStatus: "completed",
		SchemaVersion:    2,
		ChunkCount:       15,
		PlayerCount:      18,
		KillCount:        9,
		PlayerKillCount:  7,
		SideComposition:  sides,
	}
	require.NoError(t, repo.Store(ctx, op))

	// Retrieve and verify all fields
	got, err := repo.GetByID(ctx, fmt.Sprintf("%d", op.ID))
	require.NoError(t, err)
	assert.Equal(t, "stratis", got.WorldName)
	assert.Equal(t, "Full Fields Test", got.MissionName)
	assert.Equal(t, 7200.5, got.MissionDuration)
	assert.Equal(t, "full_fields", got.Filename)
	assert.Equal(t, "2026-02-15", got.Date)
	assert.Equal(t, "zeus", got.Tag)
	assert.Equal(t, "protobuf", got.StorageFormat)
	assert.Equal(t, "completed", got.ConversionStatus)
	assert.Equal(t, uint32(2), got.SchemaVersion)
	assert.Equal(t, 15, got.ChunkCount)
	assert.Equal(t, 18, got.PlayerCount)
	assert.Equal(t, 9, got.KillCount)
	assert.Equal(t, 7, got.PlayerKillCount)
	require.NotNil(t, got.SideComposition)
	assert.Equal(t, 10, got.SideComposition["WEST"].Players)
	assert.Equal(t, 40, got.SideComposition["WEST"].Units)
	assert.Equal(t, 3, got.SideComposition["WEST"].Dead)
	assert.Equal(t, 5, got.SideComposition["WEST"].Kills)
	assert.Equal(t, 8, got.SideComposition["EAST"].Players)
	assert.Equal(t, 35, got.SideComposition["EAST"].Units)
}

func TestSelectDefaults(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")

	repo, err := NewRepoOperation(pathDB)
	require.NoError(t, err)
	defer func() { assert.NoError(t, repo.db.Close()) }()

	ctx := context.Background()

	op := &Operation{
		WorldName: "altis", MissionName: "Default Filter",
		MissionDuration: 600, Filename: "default_filter",
		Date: "2026-01-15", Tag: "coop",
	}
	require.NoError(t, repo.Store(ctx, op))

	// Select with empty filter — should use default date range and return the op
	result, err := repo.Select(ctx, Filter{})
	require.NoError(t, err)
	require.Len(t, result, 1)
	assert.Equal(t, "Default Filter", result[0].MissionName)
}

// TestDBClosedErrors verifies that all repo functions return errors when the DB is closed.
// This covers the error return paths of many functions at once.
func TestDBClosedErrors(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")

	repo, err := NewRepoOperation(pathDB)
	require.NoError(t, err)

	ctx := context.Background()

	// Store an operation before closing
	op := &Operation{
		WorldName: "altis", MissionName: "Test",
		MissionDuration: 300, Filename: "test_closed",
		Date: "2026-01-01", Tag: "coop",
	}
	require.NoError(t, repo.Store(ctx, op))

	// Close the DB
	require.NoError(t, repo.db.Close())

	t.Run("SelectPending", func(t *testing.T) {
		_, err := repo.SelectPending(ctx, 10)
		assert.Error(t, err)
	})
	t.Run("SelectAll", func(t *testing.T) {
		_, err := repo.SelectAll(ctx)
		assert.Error(t, err)
	})
	t.Run("SelectByStatus", func(t *testing.T) {
		_, err := repo.SelectByStatus(ctx, "completed")
		assert.Error(t, err)
	})
	t.Run("SelectStatsBackfill", func(t *testing.T) {
		_, err := repo.SelectStatsBackfill(ctx)
		assert.Error(t, err)
	})
	t.Run("GetTypes", func(t *testing.T) {
		_, err := repo.GetTypes(ctx)
		assert.Error(t, err)
	})
	t.Run("Select", func(t *testing.T) {
		_, err := repo.Select(ctx, Filter{})
		assert.Error(t, err)
	})
	t.Run("GetByID", func(t *testing.T) {
		_, err := repo.GetByID(ctx, "1")
		assert.Error(t, err)
	})
	t.Run("GetByFilename", func(t *testing.T) {
		_, err := repo.GetByFilename(ctx, "test_closed")
		assert.Error(t, err)
	})
	t.Run("Store", func(t *testing.T) {
		err := repo.Store(ctx, &Operation{
			WorldName: "x", MissionName: "x", Filename: "x", Date: "x",
		})
		assert.Error(t, err)
	})
	t.Run("Delete", func(t *testing.T) {
		err := repo.Delete(ctx, 1)
		assert.Error(t, err)
	})
	t.Run("ResetConversionStatus", func(t *testing.T) {
		_, err := repo.ResetConversionStatus(ctx, "a", "b")
		assert.Error(t, err)
	})
	t.Run("UpdateOperation", func(t *testing.T) {
		err := repo.UpdateOperation(ctx, 1, "x", "x", "x", nil, nil)
		assert.Error(t, err)
	})
	t.Run("UpdateConversionStatus", func(t *testing.T) {
		err := repo.UpdateConversionStatus(ctx, 1, "x")
		assert.Error(t, err)
	})
	t.Run("UpdateOperationStats", func(t *testing.T) {
		err := repo.UpdateOperationStats(ctx, 1, 0, 0, 0, nil)
		assert.Error(t, err)
	})
	t.Run("GetBlacklist", func(t *testing.T) {
		_, err := repo.GetBlacklist(ctx, 1)
		assert.Error(t, err)
	})
	t.Run("AddBlacklist", func(t *testing.T) {
		err := repo.AddBlacklist(ctx, 1, 42)
		assert.Error(t, err)
	})
	t.Run("RemoveBlacklist", func(t *testing.T) {
		err := repo.RemoveBlacklist(ctx, 1, 42)
		assert.Error(t, err)
	})
}

func TestNewRepoOperation_InvalidPath(t *testing.T) {
	// Use a path that can't be created
	_, err := NewRepoOperation("/proc/nonexistent/test.db")
	assert.Error(t, err)
}

func TestUnmarshalSideComposition(t *testing.T) {
	t.Run("empty string returns nil", func(t *testing.T) {
		assert.Nil(t, unmarshalSideComposition(""))
	})
	t.Run("empty JSON object returns nil", func(t *testing.T) {
		assert.Nil(t, unmarshalSideComposition("{}"))
	})
	t.Run("new format parses correctly", func(t *testing.T) {
		raw := `{"WEST":{"players":2,"units":100,"dead":1,"kills":3}}`
		sc := unmarshalSideComposition(raw)
		require.NotNil(t, sc)
		assert.Equal(t, 2, sc["WEST"].Players)
		assert.Equal(t, 100, sc["WEST"].Units)
		assert.Equal(t, 1, sc["WEST"].Dead)
		assert.Equal(t, 3, sc["WEST"].Kills)
	})
	t.Run("legacy format parses correctly", func(t *testing.T) {
		raw := `{"WEST":100,"EAST":50}`
		sc := unmarshalSideComposition(raw)
		require.NotNil(t, sc)
		assert.Equal(t, 0, sc["WEST"].Players)
		assert.Equal(t, 100, sc["WEST"].Units)
		assert.Equal(t, 50, sc["EAST"].Units)
	})
	t.Run("invalid JSON returns nil", func(t *testing.T) {
		assert.Nil(t, unmarshalSideComposition("not json"))
	})
}
