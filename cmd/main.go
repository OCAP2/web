package main

import (
	"context"
	"io"
	"os"

	"github.com/OCAP2/web/server"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"

	_ "github.com/lib/pq"
)

func check(err error) {
	if err != nil {
		panic(err)
	}
}

func main() {
	setting, err := server.NewSetting()
	check(err)

	operation, err := server.NewRepoOperation(setting.DB)
	check(err)

	marker, err := server.NewRepoMarker(setting.Markers)
	check(err)

	ammo, err := server.NewRepoAmmo(setting.Ammo)
	check(err)

	db, query := server.GetDB(context.Background(), setting)

	e := echo.New()

	loggerConfig := middleware.DefaultLoggerConfig
	if setting.Logger {
		flog, err := os.OpenFile("ocap.log", os.O_RDWR|os.O_CREATE|os.O_APPEND, 0666)
		check(err)
		defer flog.Close()

		loggerConfig.Output = io.MultiWriter(os.Stdout, flog)
	}

	e.Use(
		middleware.LoggerWithConfig(loggerConfig),
	)
	e.Use(middleware.Gzip())
	server.NewHandler(e, operation, marker, ammo, setting, db, query)

	err = e.Start(setting.Listen)
	check(err)
}
