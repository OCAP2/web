package main

import (
	"github.com/OCAP2/web/server"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
)

func check(err error) {
	if err != nil {
		panic(err)
	}
}

func NoCache(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		c.Response().Header().Set("Cache-Control", "no-cache")
		return next(c)
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

	maps, err := server.NewRepoMap(setting.Maps, setting.MapsPool)
	check(err)

	e := echo.New()
	e.Use(
		middleware.Logger(),
		NoCache,
	)

	server.NewHandler(e, operation, marker, ammo, maps, setting)

	err = e.Start(setting.Listen)
	check(err)
}
