package ocap

import (
	"github.com/OCAPv2/OCAP/src/config"
	"github.com/jmoiron/sqlx"
)

func (o *OCAP) connectDB() error {
	var err error
	o.db, err = sqlx.Connect("sqlite3", config.C.DB)
	return err
}

func (o *OCAP) initDB() error {
	// Create default database
	_, err := o.db.Exec(`
		CREATE TABLE IF NOT EXISTS version (
			id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
			db INTEGER
		);

		CREATE TABLE IF NOT EXISTS operations (
			id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
			world_name TEXT,
			mission_name TEXT,
			mission_duration INTEGER,
			filename TEXT,
			'date' TEXT ,
			'type' TEXT NOT NULL DEFAULT ''
		);
	`)
	if err != nil {
		return err
	}

	var versions []struct {
		DB int `db:"db"`
	}
	err = o.db.Select(
		&versions,
		`
		SELECT
			db
		FROM
			version
		`,
	)
	if err != nil {
		return err
	}

	version := 0
	if len(versions) == 0 {
		_, err = o.db.Exec(`
			INSERT INTO version (db) VALUES (1);
		`)
		if err != nil {
			return err
		}
	}

	if version <= 0 {
		_, err = o.db.Exec(`
			UPDATE operations SET type = 'PvE' WHERE type = 'pve';
			UPDATE operations SET type = 'TvT' WHERE type = 'tvt';
		`)
		if err != nil {
			return err
		}
	}

	return nil
}
