package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	_ "github.com/mattn/go-sqlite3"
)

// Conversion status constants for operations.
const (
	ConversionStatusStreaming   = "streaming"
	ConversionStatusPending    = "pending"
	ConversionStatusConverting = "converting"
	ConversionStatusCompleted  = "completed"
	ConversionStatusFailed     = "failed"
)

// operationColumns is the canonical SELECT column list for the operations table.
// Every query that feeds into scan() must use this exact list.
const operationColumns = `id, world_name, mission_name, mission_duration, filename, date, tag, storage_format, conversion_status, schema_version, chunk_count, player_count, kill_count, side_composition, player_kill_count, focus_start, focus_end`

// SideCounts holds per-side breakdown of units, players, casualties, and kills.
type SideCounts struct {
	Players int `json:"players"`
	Units   int `json:"units"`
	Dead    int `json:"dead"`
	Kills   int `json:"kills"`
}

// SideComposition maps Arma side names (WEST, EAST, GUER, CIV) to player/unit counts.
type SideComposition map[string]SideCounts

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
	PlayerCount      int             `json:"player_count"`
	KillCount        int             `json:"kill_count"`
	SideComposition  SideComposition `json:"side_composition"`
	PlayerKillCount  int             `json:"player_kill_count"`
	FocusStart       *int64          `json:"focusStart"`
	FocusEnd         *int64          `json:"focusEnd"`
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

// runMigration executes a set of SQL statements atomically within a transaction,
// then records the new version number.
func (r *RepoOperation) runMigration(version int, statements ...string) error {
	slog.Info("running database migration", "version", version)
	tx, err := r.db.Begin()
	if err != nil {
		return fmt.Errorf("begin v%d migration: %w", version, err)
	}
	defer tx.Rollback()

	for _, stmt := range statements {
		if _, err = tx.Exec(stmt); err != nil {
			return fmt.Errorf("v%d migration failed: %w", version, err)
		}
	}

	if _, err = tx.Exec(`INSERT INTO version (db) VALUES (?)`, version); err != nil {
		return fmt.Errorf("v%d set version: %w", version, err)
	}

	if err = tx.Commit(); err != nil {
		return err
	}
	slog.Info("database migration completed", "version", version)
	return nil
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
	slog.Info("database schema", "currentVersion", version)

	if version < 1 {
		if err = r.runMigration(1,
			`UPDATE operations SET type = 'PvE' WHERE type = 'pve'`,
			`UPDATE operations SET type = 'TvT' WHERE type = 'tvt'`,
		); err != nil {
			return err
		}
	}

	if version < 2 {
		if err = r.runMigration(2,
			`ALTER TABLE operations RENAME COLUMN type TO tag`,
		); err != nil {
			return err
		}
	}

	if version < 3 {
		if err = r.runMigration(3,
			`ALTER TABLE operations ADD COLUMN storage_format TEXT DEFAULT 'json'`,
			`ALTER TABLE operations ADD COLUMN conversion_status TEXT DEFAULT 'completed'`,
		); err != nil {
			return err
		}
	}

	if version < 4 {
		if err = r.runMigration(4,
			`ALTER TABLE operations ADD COLUMN schema_version INTEGER DEFAULT 1`,
		); err != nil {
			return err
		}
	}

	if version < 5 {
		if err = r.runMigration(5,
			`UPDATE operations SET filename = REPLACE(filename, '.json.gz', '') WHERE filename LIKE '%.json.gz'`,
			`UPDATE operations SET filename = REPLACE(filename, '.json', '') WHERE filename LIKE '%.json'`,
		); err != nil {
			return err
		}
	}

	if version < 6 {
		if err = r.runMigration(6,
			`ALTER TABLE operations ADD COLUMN chunk_count INTEGER DEFAULT 0`,
		); err != nil {
			return err
		}
	}

	if version < 7 {
		if err = r.runMigration(7,
			`ALTER TABLE operations ADD COLUMN player_count INTEGER DEFAULT 0`,
			`ALTER TABLE operations ADD COLUMN kill_count INTEGER DEFAULT 0`,
			`ALTER TABLE operations ADD COLUMN side_composition TEXT DEFAULT '{}'`,
			`ALTER TABLE operations ADD COLUMN player_kill_count INTEGER DEFAULT 0`,
		); err != nil {
			return err
		}
	}

	if version < 8 {
		if err = r.runMigration(8,
			`CREATE TABLE IF NOT EXISTS marker_blacklist (
				operation_id INTEGER NOT NULL,
				player_entity_id INTEGER NOT NULL,
				PRIMARY KEY (operation_id, player_entity_id)
			)`,
		); err != nil {
			return err
		}
	}

	if version < 9 {
		if err = r.runMigration(9,
			`ALTER TABLE operations ADD COLUMN focus_start INTEGER DEFAULT NULL`,
			`ALTER TABLE operations ADD COLUMN focus_end INTEGER DEFAULT NULL`,
		); err != nil {
			return err
		}
	}

	if version < 10 {
		if err = r.runMigration(10,
			`UPDATE operations SET world_name = LOWER(world_name) WHERE world_name != LOWER(world_name)`,
		); err != nil {
			return err
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
	operation.WorldName = strings.ToLower(operation.WorldName)
	storageFormat := operation.StorageFormat
	if storageFormat == "" {
		storageFormat = "json"
	}
	conversionStatus := operation.ConversionStatus
	if conversionStatus == "" {
		conversionStatus = ConversionStatusPending
	}
	schemaVersion := operation.SchemaVersion
	if schemaVersion == 0 {
		schemaVersion = 1
	}

	sideJSON := marshalSideComposition(operation.SideComposition)

	query := `
		INSERT INTO operations
			(world_name, mission_name, mission_duration, filename, date, tag, storage_format, conversion_status, schema_version, chunk_count, player_count, kill_count, side_composition, player_kill_count, focus_start, focus_end)
		VALUES
			($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
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
		operation.PlayerCount,
		operation.KillCount,
		sideJSON,
		operation.PlayerKillCount,
		operation.FocusStart,
		operation.FocusEnd,
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
			` + operationColumns + `
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
		o       = Operation{}
		ops     = []Operation{}
		sideRaw string
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
			&o.PlayerCount,
			&o.KillCount,
			&sideRaw,
			&o.PlayerKillCount,
			&o.FocusStart,
			&o.FocusEnd,
		)
		if err != nil {
			return nil, err
		}
		o.SideComposition = unmarshalSideComposition(sideRaw)
		ops = append(ops, o)
	}
	return ops, nil
}

// GetByID retrieves a single operation by its ID
func (r *RepoOperation) GetByID(ctx context.Context, id string) (*Operation, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT ` + operationColumns + `
		 FROM operations WHERE id = ?`, id)

	var op Operation
	var sideRaw string
	err := row.Scan(&op.ID, &op.WorldName, &op.MissionName, &op.MissionDuration,
		&op.Filename, &op.Date, &op.Tag, &op.StorageFormat, &op.ConversionStatus, &op.SchemaVersion, &op.ChunkCount,
		&op.PlayerCount, &op.KillCount, &sideRaw, &op.PlayerKillCount, &op.FocusStart, &op.FocusEnd)
	if err != nil {
		return nil, err
	}
	op.SideComposition = unmarshalSideComposition(sideRaw)
	return &op, nil
}

// GetByFilename retrieves a single operation by its filename
func (r *RepoOperation) GetByFilename(ctx context.Context, filename string) (*Operation, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT ` + operationColumns + `
		 FROM operations WHERE filename = ?`, filename)

	var op Operation
	var sideRaw string
	err := row.Scan(&op.ID, &op.WorldName, &op.MissionName, &op.MissionDuration,
		&op.Filename, &op.Date, &op.Tag, &op.StorageFormat, &op.ConversionStatus, &op.SchemaVersion, &op.ChunkCount,
		&op.PlayerCount, &op.KillCount, &sideRaw, &op.PlayerKillCount, &op.FocusStart, &op.FocusEnd)
	if err != nil {
		return nil, err
	}
	op.SideComposition = unmarshalSideComposition(sideRaw)
	return &op, nil
}

// SelectPending returns operations with pending conversion status
func (r *RepoOperation) SelectPending(ctx context.Context, limit int) ([]Operation, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT ` + operationColumns + `
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
		`SELECT ` + operationColumns + `
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
		`SELECT ` + operationColumns + `
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

// Delete removes an operation record from the database.
func (r *RepoOperation) Delete(ctx context.Context, id int64) error {
	result, err := r.db.ExecContext(ctx, `DELETE FROM operations WHERE id = ?`, id)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return ErrNotFound
	}
	return nil
}

// UpdateOperation updates the editable metadata fields of an operation.
func (r *RepoOperation) UpdateOperation(ctx context.Context, id int64, missionName, tag, date string, focusStart, focusEnd *int64) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE operations SET mission_name = ?, tag = ?, date = ?, focus_start = ?, focus_end = ? WHERE id = ?`,
		missionName, tag, date, focusStart, focusEnd, id)
	return err
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

// UpdateOperationStats updates player count, kill count, player kill count and side composition for an operation
func (r *RepoOperation) UpdateOperationStats(ctx context.Context, id int64, playerCount, killCount, playerKillCount int, sideComposition SideComposition) error {
	sideJSON := marshalSideComposition(sideComposition)
	_, err := r.db.ExecContext(ctx,
		`UPDATE operations SET player_count = ?, kill_count = ?, player_kill_count = ?, side_composition = ? WHERE id = ?`,
		playerCount, killCount, playerKillCount, sideJSON, id)
	return err
}

func marshalSideComposition(sc SideComposition) string {
	if len(sc) == 0 {
		return "{}"
	}
	data, err := json.Marshal(sc)
	if err != nil {
		return "{}"
	}
	return string(data)
}

func unmarshalSideComposition(raw string) SideComposition {
	if raw == "" || raw == "{}" {
		return nil
	}
	// Try new format first: {"WEST":{"players":2,"units":100}}
	var sc SideComposition
	if err := json.Unmarshal([]byte(raw), &sc); err == nil {
		return sc
	}
	// Fall back to old format: {"WEST":100}
	var legacy map[string]int
	if err := json.Unmarshal([]byte(raw), &legacy); err != nil {
		slog.Warn("failed to unmarshal side_composition", "raw", raw, "error", err)
		return nil
	}
	sc = make(SideComposition, len(legacy))
	for side, count := range legacy {
		sc[side] = SideCounts{Players: 0, Units: count}
	}
	return sc
}

// SelectStatsBackfill returns completed protobuf operations that have no stats yet
func (r *RepoOperation) SelectStatsBackfill(ctx context.Context) ([]Operation, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT ` + operationColumns + `
		 FROM operations
		 WHERE conversion_status = 'completed' AND player_count = 0
		 ORDER BY id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return r.scan(ctx, rows)
}

