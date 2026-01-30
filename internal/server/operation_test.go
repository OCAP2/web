package server

import (
	"context"
	"database/sql"
	"os"
	"path"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
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
	defer repo.db.Close()

	// Verify columns exist
	var storageFormat, conversionStatus string
	err = repo.db.QueryRow("SELECT storage_format, conversion_status FROM operations LIMIT 1").Scan(&storageFormat, &conversionStatus)
	// Should get no rows error, not missing column error
	assert.ErrorIs(t, err, sql.ErrNoRows)
}

func TestOperationStorageFormat(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")

	repo, err := NewRepoOperation(pathDB)
	assert.NoError(t, err)
	defer repo.db.Close()

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
	defer repo.db.Close()

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
	defer repo.db.Close()

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
	defer repo.db.Close()

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
	defer repo.db.Close()

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
	defer repo.db.Close()

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
