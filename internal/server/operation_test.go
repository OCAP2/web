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
