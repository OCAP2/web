package server

import (
	"errors"
	"io"
	"net/http"
	"os"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
)

type Handler struct {
	repoOperation *RepoOperation
	repoMarker    *RepoMarker
	repoAmmo      *RepoAmmo
	repoMap       *RepoMap
	setting       Setting
}

func NewHandler(
	e *echo.Echo,
	repoOperation *RepoOperation,
	repoMarker *RepoMarker,
	repoAmmo *RepoAmmo,
	repoMap *RepoMap,
	setting Setting,
) {
	hdlr := Handler{
		repoOperation: repoOperation,
		repoMarker:    repoMarker,
		repoAmmo:      repoAmmo,
		repoMap:       repoMap,
		setting:       setting,
	}

	e.Use(hdlr.errorHandler)

	e.GET("/api/v1/operations", hdlr.GetOperations)
	e.POST("/api/v1/operations/add", hdlr.StoreOperation)
	e.GET("/api/v1/customize", hdlr.GetCustomize)
	e.GET("/data/:name", hdlr.GetCapture)
	e.GET("/images/markers/:name/:color", hdlr.GetMarker)
	e.GET("/images/markers/magicons/:name", hdlr.GetAmmo)
	e.GET("/images/maps/:name/:z/:x/:y", hdlr.GetTitle)
	e.GET("/images/maps/:name", hdlr.GetMapInfo)
	e.Static("/", setting.Static)
	e.File("/favicon.ico", path.Join(setting.Static, "favicon.ico"))
}

func (h *Handler) errorHandler(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		err := next(c)
		if err != nil {
			switch true {
			case errors.Is(err, ErrNotFound):
				return c.NoContent(http.StatusNotFound)
			default:
				return err
			}
		}
		return nil
	}
}

func (h *Handler) GetOperations(c echo.Context) error {
	var (
		ctx    = c.Request().Context()
		filter = Filter{}
	)

	if err := c.Bind(&filter); err != nil {
		return err
	}

	ops, err := h.repoOperation.Select(ctx, filter)
	if err != nil {
		return err
	}

	return c.JSONPretty(http.StatusOK, ops, "\t")
}

func (h *Handler) GetCustomize(c echo.Context) error {
	return c.JSONPretty(http.StatusOK, h.setting.Customize, "\t")
}

func (h *Handler) StoreOperation(c echo.Context) error {
	var (
		ctx    = c.Request().Context()
		secret = c.FormValue("secret")
		err    error
	)

	if secret != h.setting.Secret {
		return echo.ErrForbidden
	}

	_, filename := path.Split(c.FormValue("filename"))

	op := Operation{
		WorldName:   c.FormValue("worldName"),
		MissionName: c.FormValue("missionName"),
		Filename:    filename,
		Date:        time.Now().Format("2006-01-02"),
		// Support old extension version tag or type
		Tag: c.FormValue("tag") + c.FormValue("type"),
	}
	op.MissionDuration, err = strconv.ParseFloat(c.FormValue("missionDuration"), 64)
	if err != nil {
		return err
	}

	if err = h.repoOperation.Store(ctx, &op); err != nil {
		return err
	}

	form, err := c.FormFile("file")
	if err != nil {
		return echo.ErrBadRequest
	}
	file, err := form.Open()
	if err != nil {
		return err
	}
	defer file.Close()

	writer, err := os.Create(path.Join(h.setting.Data, path.Base(filename)+".gz"))
	if err != nil {
		return err
	}

	if _, err = io.Copy(writer, file); err != nil {
		return err
	}

	return c.NoContent(http.StatusOK)
}

func (h *Handler) GetCapture(c echo.Context) error {
	name := path.Clean(c.Param("name"))

	upath := path.Join(h.setting.Data, name+".gz")

	c.Response().Header().Set("Content-Encoding", "gzip")
	c.Response().Header().Set("Content-Type", "application/json")

	return c.File(upath)
}

func (h *Handler) GetMarker(c echo.Context) error {
	var (
		ctx   = c.Request().Context()
		color = c.Param("color")
		name  = c.Param("name")
	)

	// Deprecated: support old version
	pos := strings.IndexByte(color, '.')
	if pos != -1 {
		color = color[:pos]
	}

	img, ct, err := h.repoMarker.Get(ctx, name, color)
	if err != nil {
		return err
	}

	return c.Stream(http.StatusOK, ct, img)
}

func (h *Handler) GetAmmo(c echo.Context) error {
	var (
		ctx  = c.Request().Context()
		name = removeExt(c.Param("name"))
	)

	// support format
	// gear_smokegrenade_white_ca.paa.png
	name = strings.Replace(name, ".paa", "", 1)

	upath, err := h.repoAmmo.GetPath(ctx, name)
	if err != nil {
		return err
	}

	return c.File(upath)
}

func (h *Handler) GetTitle(c echo.Context) error {
	var (
		ctx  = c.Request().Context()
		name = c.Param("name")
	)

	z, err := strconv.Atoi(c.Param("z"))
	if err != nil {
		return echo.ErrBadRequest
	}

	x, err := strconv.Atoi(c.Param("x"))
	if err != nil {
		return echo.ErrBadRequest
	}

	sy := strings.TrimSuffix(c.Param("y"), ".png")

	y, err := strconv.Atoi(sy)
	if err != nil {
		return echo.ErrBadRequest
	}

	title, err := h.repoMap.TitleMap(ctx, name, z, x, y)
	if err != nil {
		return err
	}
	defer title.Close()

	return c.Stream(http.StatusOK, "image/png", title)
}

func (h *Handler) GetMapInfo(c echo.Context) error {
	var (
		name = c.Param("name")
	)

	conf, err := h.repoMap.Config(name)
	if err != nil {
		return err
	}

	return c.Blob(http.StatusOK, "application/json", conf)
}

func removeExt(name string) string {
	pos := strings.IndexByte(name, '.')
	if pos != -1 {
		name = name[:pos]
	}
	return name
}
