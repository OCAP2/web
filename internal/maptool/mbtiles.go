package maptool

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	_ "github.com/mattn/go-sqlite3"
)

// TilesToMBTiles packs a TMS tile directory (z/x/y.png) into an MBTiles file.
// Both gdal2tiles --profile=mercator and MBTiles use TMS convention (Y=0 at south),
// so tiles are stored with Y as-is — no flip needed.
func TilesToMBTiles(tilesDir, mbtilesPath string) error {
	db, err := sql.Open("sqlite3", mbtilesPath)
	if err != nil {
		return fmt.Errorf("create mbtiles: %w", err)
	}
	defer db.Close()

	for _, stmt := range []string{
		`CREATE TABLE metadata (name TEXT, value TEXT)`,
		`CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB)`,
		`CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row)`,
	} {
		if _, err := db.Exec(stmt); err != nil {
			return fmt.Errorf("create schema: %w", err)
		}
	}

	for _, kv := range [][2]string{
		{"name", "topo"},
		{"format", "png"},
		{"type", "overlay"},
	} {
		if _, err := db.Exec("INSERT INTO metadata VALUES (?, ?)", kv[0], kv[1]); err != nil {
			return fmt.Errorf("write metadata: %w", err)
		}
	}

	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}

	stmt, err := tx.Prepare("INSERT INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)")
	if err != nil {
		tx.Rollback()
		return fmt.Errorf("prepare insert: %w", err)
	}
	defer stmt.Close()

	count := 0
	err = filepath.Walk(tilesDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || filepath.Ext(path) != ".png" {
			return err
		}

		rel, err := filepath.Rel(tilesDir, path)
		if err != nil {
			return nil
		}

		// Parse z/x/y.png
		parts := strings.Split(rel, string(filepath.Separator))
		if len(parts) != 3 {
			return nil
		}

		z, err1 := strconv.Atoi(parts[0])
		x, err2 := strconv.Atoi(parts[1])
		yStr := strings.TrimSuffix(parts[2], ".png")
		y, err3 := strconv.Atoi(yStr)
		if err1 != nil || err2 != nil || err3 != nil {
			return nil
		}

		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}

		if _, err := stmt.Exec(z, x, y, data); err != nil {
			return fmt.Errorf("insert tile z=%d x=%d y=%d: %w", z, x, y, err)
		}
		count++
		return nil
	})

	if err != nil {
		tx.Rollback()
		return fmt.Errorf("walk tiles: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit: %w", err)
	}

	return nil
}
