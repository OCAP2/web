package server

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	_ "github.com/mattn/go-sqlite3"
)

type Operation struct {
	ID              int64   `json:"id"`
	WorldName       string  `json:"world_name"`
	MissionName     string  `json:"mission_name"`
	MissionDuration float64 `json:"mission_duration"`
	Filename        string  `json:"filename"`
	Date            string  `json:"date"`
	Type            string  `json:"type"`
}

type Filter struct {
	Name  string `query:"name"`
	Older string `query:"older"`
	Newer string `query:"newer"`
	Type  string `query:"type"`
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

	if err := r.magration(); err != nil {
		return nil, err
	}

	return r, nil
}

func (r *RepoOperation) magration() (err error) {
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
	err = r.db.QueryRow(`SELECT db FROM version ORDER BY db ASC LIMIT 1`).Scan(&version)
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
			return err
		}

		_, err = r.db.Exec(`INSERT INTO version (db) VALUES (1)`)
		if err != nil {
			return err
		}
	}

	return nil
}

func (r *RepoOperation) GetTypes(ctx context.Context) ([]string, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT DISTINCT type FROM operations
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var (
		t     string
		types = []string{}
	)
	for rows.Next() {
		rows.Scan(&t)
		types = append(types, t)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return types, nil
}

func (r *RepoOperation) Store(ctx context.Context, operation *Operation) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO operations
			(world_name, mission_name, mission_duration, filename, date, type)
		VALUES
			($1, $2, $3, $4, $5, $6)
	`)
	if err != nil {
		return err
	}
	return nil
}

func (r *RepoOperation) Select(ctx context.Context, filter Filter) ([]Operation, error) {
	query := `
		SELECT
			*
		FROM
			operations
		WHERE
			mission_name LIKE "%" || $2 || "%"
			AND date <= $3
			AND date >= $4
			AND type LIKE "%" || $1;
	`
	rows, err := r.db.QueryContext(
		ctx,
		query,
		filter.Name,
		filter.Older,
		filter.Newer,
		filter.Type,
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
			&o.Type,
		)
		if err != nil {
			return nil, err
		}
		ops = append(ops, o)
	}
	return ops, nil
}
