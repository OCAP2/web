package server

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	_ "github.com/mattn/go-sqlite3"
)

type Operation struct {
	ID               int64   `json:"id"`
	WorldName        string  `json:"world_name"`
	MissionName      string  `json:"mission_name"`
	MissionDuration  float64 `json:"mission_duration"`
	Filename         string  `json:"filename"`
	Date             string  `json:"date"`
	Tag              string  `json:"tag"`
	StorageFormat    string  `json:"storageFormat"`
	ConversionStatus string  `json:"conversionStatus"`
	SchemaVersion    uint32  `json:"schemaVersion"`
	ChunkCount       int     `json:"chunkCount"`
}

type Filter struct {
	Name  string `query:"name"`
	Older string `query:"older"`
	Newer string `query:"newer"`
	Tag   string `query:"tag"`
}

type RepoOperation struct {
	db *sql.DB
}

func NewRepoOperation(pathDB string) (*RepoOperation, error) {
	db, err := sql.Open("sqlite3", pathDB)
	if err != nil {
		return nil, err
	}

	r := &RepoOperation{
		db: db,
	}

	if err := r.migration(); err != nil {
		return nil, err
	}

	return r, nil
}

func (r *RepoOperation) migration() (err error) {
	_, err = r.db.Exec(`
		CREATE TABLE IF NOT EXISTS version (
			id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
			db INTEGER
		);

		CREATE TABLE IF NOT EXISTS operations (
			id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
			world_name TEXT NOT NULL,
			mission_name TEXT NOT NULL,
			mission_duration INTEGER NOT NULL,
			filename TEXT NOT NULL,
			date TEXT NOT NULL,
			type TEXT NOT NULL DEFAULT ''
		)
	`)
	if err != nil {
		return fmt.Errorf("could be create table operation: %w", err)
	}

	var version int
	err = r.db.QueryRow(`SELECT db FROM version ORDER BY db DESC LIMIT 1`).Scan(&version)
	if errors.Is(err, sql.ErrNoRows) {
		version = 0
	} else if err != nil {
		return err
	}

	if version < 1 {
		_, err = r.db.Exec(`
			UPDATE operations SET type = 'PvE' WHERE type = 'pve';
			UPDATE operations SET type = 'TvT' WHERE type = 'tvt';
		`)
		if err != nil {
			return fmt.Errorf("merge db to v1 failed: %w", err)
		}

		_, err = r.db.Exec(`INSERT INTO version (db) VALUES (1)`)
		if err != nil {
			return fmt.Errorf("failed to increase version 1: %w", err)
		}
	}

	if version < 2 {
		_, err = r.db.Exec(`
			ALTER TABLE operations RENAME COLUMN type TO tag;
		`)
		if err != nil {
			return fmt.Errorf("merge db to v2 failed: %w", err)
		}

		_, err = r.db.Exec(`INSERT INTO version (db) VALUES (2)`)
		if err != nil {
			return fmt.Errorf("failed to increase version 2: %w", err)
		}
	}

	if version < 3 {
		_, err = r.db.Exec(`ALTER TABLE operations ADD COLUMN storage_format TEXT DEFAULT 'json'`)
		if err != nil {
			return fmt.Errorf("merge db to v3 failed (storage_format): %w", err)
		}

		_, err = r.db.Exec(`ALTER TABLE operations ADD COLUMN conversion_status TEXT DEFAULT 'completed'`)
		if err != nil {
			return fmt.Errorf("merge db to v3 failed (conversion_status): %w", err)
		}

		_, err = r.db.Exec(`INSERT INTO version (db) VALUES (3)`)
		if err != nil {
			return fmt.Errorf("failed to increase version 3: %w", err)
		}
	}

	if version < 4 {
		_, err = r.db.Exec(`ALTER TABLE operations ADD COLUMN schema_version INTEGER DEFAULT 1`)
		if err != nil {
			return fmt.Errorf("merge db to v4 failed (schema_version): %w", err)
		}

		_, err = r.db.Exec(`INSERT INTO version (db) VALUES (4)`)
		if err != nil {
			return fmt.Errorf("failed to increase version 4: %w", err)
		}
	}

	if version < 5 {
		// Strip legacy .json.gz and .json suffixes from filenames
		_, err = r.db.Exec(`
			UPDATE operations SET filename = REPLACE(filename, '.json.gz', '') WHERE filename LIKE '%.json.gz';
			UPDATE operations SET filename = REPLACE(filename, '.json', '') WHERE filename LIKE '%.json';
		`)
		if err != nil {
			return fmt.Errorf("merge db to v5 failed (normalize filenames): %w", err)
		}

		_, err = r.db.Exec(`INSERT INTO version (db) VALUES (5)`)
		if err != nil {
			return fmt.Errorf("failed to increase version 5: %w", err)
		}
	}

	if version < 6 {
		_, err = r.db.Exec(`ALTER TABLE operations ADD COLUMN chunk_count INTEGER DEFAULT 0`)
		if err != nil {
			return fmt.Errorf("merge db to v6 failed (chunk_count): %w", err)
		}

		_, err = r.db.Exec(`INSERT INTO version (db) VALUES (6)`)
		if err != nil {
			return fmt.Errorf("failed to increase version 6: %w", err)
		}
	}

	return nil
}

func (r *RepoOperation) GetTypes(ctx context.Context) ([]string, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT DISTINCT tag FROM operations
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var (
		t    string
		tags = []string{}
	)
	for rows.Next() {
		rows.Scan(&t)
		tags = append(tags, t)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return tags, nil
}

func (r *RepoOperation) Store(ctx context.Context, operation *Operation) error {
	storageFormat := operation.StorageFormat
	if storageFormat == "" {
		storageFormat = "json"
	}
	conversionStatus := operation.ConversionStatus
	if conversionStatus == "" {
		conversionStatus = "pending"
	}
	schemaVersion := operation.SchemaVersion
	if schemaVersion == 0 {
		schemaVersion = 1
	}

	query := `
		INSERT INTO operations
			(world_name, mission_name, mission_duration, filename, date, tag, storage_format, conversion_status, schema_version, chunk_count)
		VALUES
			($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
	`
	result, err := r.db.ExecContext(
		ctx,
		query,
		operation.WorldName,
		operation.MissionName,
		operation.MissionDuration,
		operation.Filename,
		operation.Date,
		operation.Tag,
		storageFormat,
		conversionStatus,
		schemaVersion,
		operation.ChunkCount,
	)
	if err != nil {
		return err
	}

	// Set the auto-generated ID on the operation
	id, err := result.LastInsertId()
	if err != nil {
		return err
	}
	operation.ID = id

	return nil
}

func (r *RepoOperation) Select(ctx context.Context, filter Filter) ([]Operation, error) {
	// Set defaults for date filters
	older := filter.Older
	if older == "" {
		older = "9999-12-31"
	}
	newer := filter.Newer
	if newer == "" {
		newer = "0000-01-01"
	}

	query := `
		SELECT
			id, world_name, mission_name, mission_duration, filename, date, tag, storage_format, conversion_status, schema_version, chunk_count
		FROM
			operations
		WHERE
			mission_name LIKE '%' || $1 || '%'
			AND date <= $2
			AND date >= $3
			AND tag LIKE '%' || $4 || '%'
	`
	rows, err := r.db.QueryContext(
		ctx,
		query,
		filter.Name,
		older,
		newer,
		filter.Tag,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return r.scan(ctx, rows)
}

func (*RepoOperation) scan(ctx context.Context, rows *sql.Rows) ([]Operation, error) {
	var (
		o   = Operation{}
		ops = []Operation{}
	)
	for rows.Next() {
		err := rows.Scan(
			&o.ID,
			&o.WorldName,
			&o.MissionName,
			&o.MissionDuration,
			&o.Filename,
			&o.Date,
			&o.Tag,
			&o.StorageFormat,
			&o.ConversionStatus,
			&o.SchemaVersion,
			&o.ChunkCount,
		)
		if err != nil {
			return nil, err
		}
		ops = append(ops, o)
	}
	return ops, nil
}

// GetByID retrieves a single operation by its ID
func (r *RepoOperation) GetByID(ctx context.Context, id string) (*Operation, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT id, world_name, mission_name, mission_duration, filename, date, tag, storage_format, conversion_status, schema_version, chunk_count
		 FROM operations WHERE id = ?`, id)

	var op Operation
	err := row.Scan(&op.ID, &op.WorldName, &op.MissionName, &op.MissionDuration,
		&op.Filename, &op.Date, &op.Tag, &op.StorageFormat, &op.ConversionStatus, &op.SchemaVersion, &op.ChunkCount)
	if err != nil {
		return nil, err
	}
	return &op, nil
}

// GetByFilename retrieves a single operation by its filename
func (r *RepoOperation) GetByFilename(ctx context.Context, filename string) (*Operation, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT id, world_name, mission_name, mission_duration, filename, date, tag, storage_format, conversion_status, schema_version, chunk_count
		 FROM operations WHERE filename = ?`, filename)

	var op Operation
	err := row.Scan(&op.ID, &op.WorldName, &op.MissionName, &op.MissionDuration,
		&op.Filename, &op.Date, &op.Tag, &op.StorageFormat, &op.ConversionStatus, &op.SchemaVersion, &op.ChunkCount)
	if err != nil {
		return nil, err
	}
	return &op, nil
}

// SelectPending returns operations with pending conversion status
func (r *RepoOperation) SelectPending(ctx context.Context, limit int) ([]Operation, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, world_name, mission_name, mission_duration, filename, date, tag, storage_format, conversion_status, schema_version, chunk_count
		 FROM operations
		 WHERE conversion_status = 'pending'
		 ORDER BY id ASC
		 LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return r.scan(ctx, rows)
}

// SelectAll returns all operations for conversion
func (r *RepoOperation) SelectAll(ctx context.Context) ([]Operation, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, world_name, mission_name, mission_duration, filename, date, tag, storage_format, conversion_status, schema_version, chunk_count
		 FROM operations
		 ORDER BY id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return r.scan(ctx, rows)
}

// SelectByStatus returns operations with a specific conversion status
func (r *RepoOperation) SelectByStatus(ctx context.Context, status string) ([]Operation, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, world_name, mission_name, mission_duration, filename, date, tag, storage_format, conversion_status, schema_version, chunk_count
		 FROM operations
		 WHERE conversion_status = ?
		 ORDER BY id ASC`, status)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return r.scan(ctx, rows)
}

// ResetConversionStatus resets all operations with fromStatus to toStatus
func (r *RepoOperation) ResetConversionStatus(ctx context.Context, fromStatus, toStatus string) (int64, error) {
	result, err := r.db.ExecContext(ctx,
		`UPDATE operations SET conversion_status = ? WHERE conversion_status = ?`, toStatus, fromStatus)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

// UpdateConversionStatus updates the conversion status for an operation
func (r *RepoOperation) UpdateConversionStatus(ctx context.Context, id int64, status string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE operations SET conversion_status = ? WHERE id = ?`, status, id)
	return err
}

// UpdateStorageFormat updates the storage format for an operation
func (r *RepoOperation) UpdateStorageFormat(ctx context.Context, id int64, format string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE operations SET storage_format = ? WHERE id = ?`, format, id)
	return err
}

// UpdateSchemaVersion updates the schema version for an operation
func (r *RepoOperation) UpdateSchemaVersion(ctx context.Context, id int64, version uint32) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE operations SET schema_version = ? WHERE id = ?`, version, id)
	return err
}

// UpdateMissionDuration updates the mission duration for an operation
func (r *RepoOperation) UpdateMissionDuration(ctx context.Context, id int64, duration float64) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE operations SET mission_duration = ? WHERE id = ?`, duration, id)
	return err
}

// UpdateChunkCount updates the chunk count for an operation
func (r *RepoOperation) UpdateChunkCount(ctx context.Context, id int64, count int) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE operations SET chunk_count = ? WHERE id = ?`, count, id)
	return err
}

