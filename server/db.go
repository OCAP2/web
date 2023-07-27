package server

import (
	"context"

	"github.com/OCAP2/web/db/sqlgen"
	"github.com/jackc/pgx/v5"
)

func GetDB(ctx context.Context, setting Setting) (*pgx.Conn, *sqlgen.Queries) {
	// database
	connStr := setting.Database.DSN
	if connStr == "" {
		panic("empty DSN")
	}
	db, err := pgx.Connect(ctx, connStr)
	if err != nil {
		panic(err)
	}
	queries := sqlgen.New(db)

	return db, queries
}
