package server

import (
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
