package server

import (
	"errors"
	"io"
	"mime"
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
	setting       Setting
}

func NewHandler(
	e *echo.Echo,
	repoOperation *RepoOperation,
	repoMarker *RepoMarker,
	setting Setting,
) {
	hdlr := Handler{
		repoOperation: repoOperation,
		repoMarker:    repoMarker,
		setting:       setting,
	}

	e.GET("/api/v1/operations/get", hdlr.GetOperations)
	e.POST("/api/v1/operations/add", hdlr.StoreOperation)
	e.GET("/data/:name", hdlr.GetCapture)
	e.GET("/images/markers/:name/:color", hdlr.GetMarker)
	e.Static("/images/maps/", setting.Maps)
	e.Static("/", setting.Static)
	e.File("/favicon.ico", path.Join(setting.Static, "favicon.ico"))
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
		Type:        c.FormValue("type"),
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

	writer, err := os.Create(path.Join(h.setting.Data, path.Base(filename)))
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
		ext   = path.Ext(color)
		name  = c.Param("name")
	)

	pos := strings.IndexByte(color, '.')
	if pos != -1 {
		color = color[:pos]
	}

	img, err := h.repoMarker.Get(ctx, name, color)
	if errors.Is(err, ErrNotFound) {
		return c.NoContent(http.StatusNotFound)
	}
	if err != nil {
		return err
	}

	ct := mime.TypeByExtension(ext)

	return c.Stream(http.StatusOK, ct, img)
}
