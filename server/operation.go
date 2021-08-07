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
	Tag             string  `json:"tag"`
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
			INSERT INTO version (db) VALUES (1);
		`)
		if err != nil {
			return fmt.Errorf("failed to increase version 1: %w", err)
		}
	}

	if version < 2 {
		_, err = r.db.Exec(`
			ALTER TABLE operations RENAME COLUMN type TO tag;
			INSERT INTO version (db) VALUES (2);
		`)
		if err != nil {
			return fmt.Errorf("failed to increase version 2: %w", err)
		}
	}

	if version < 3 {
		_, err = r.db.Exec(`
			-- fix datatypes
			CREATE TABLE operations_dg_tmp (
				id INTEGER NOT NULL PRIMARY KEY autoincrement,
				world_name TEXT,
				mission_name TEXT,
				mission_duration INTEGER,
				filename TEXT NOT NULL,
				date DATE NOT NULL,
				tag TEXT DEFAULT '' NOT NULL
			);
			
			INSERT INTO operations_dg_tmp(id, world_name, mission_name, mission_duration, filename, date, tag)
			SELECT id, world_name, mission_name, mission_duration, filename, date, tag FROM operations;
			
			DROP TABLE operations;
			
			ALTER TABLE operations_dg_tmp rename to operations;

			INSERT INTO version (db) VALUES (3);
		`)
		if err != nil {
			return fmt.Errorf("failed to increase version 3: %w", err)
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
	query := `
		INSERT INTO operations
			(world_name, mission_name, mission_duration, filename, date, tag)
		VALUES
			($1, $2, $3, $4, $5, $6)
	`
	_, err := r.db.ExecContext(
		ctx,
		query,
		operation.WorldName,
		operation.MissionName,
		operation.MissionDuration,
		operation.Filename,
		operation.Date,
		operation.Tag,
	)
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
			filename LIKE "%s" || $1 || "%"
			AND date BETWEEN $2 AND $3
			AND ($4 = "" OR tag = $4);
	`
	rows, err := r.db.QueryContext(
		ctx,
		query,
		filter.Name,
		filter.Newer,
		filter.Older,
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
		)
		if err != nil {
			return nil, err
		}
		ops = append(ops, o)
	}
	return ops, nil
}
