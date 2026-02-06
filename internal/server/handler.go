package server

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/OCAP2/web/internal/storage"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
)

const CacheDuration = 7 * 24 * time.Hour

var (
	BuildVersion string
	BuildCommit  string
	BuildDate    string
)

// ConversionTrigger triggers async conversion of an operation
type ConversionTrigger interface {
	TriggerConversion(id int64, filename string)
}

type Handler struct {
	repoOperation       *RepoOperation
	repoMarker          *RepoMarker
	repoAmmo            *RepoAmmo
	setting             Setting
	conversionTrigger   ConversionTrigger // optional, nil if conversion disabled
}

// FormatInfo contains storage format details for a recording
type FormatInfo struct {
	Format            string `json:"format"`
	ChunkCount        int    `json:"chunkCount"`
	SupportsStreaming bool   `json:"supportsStreaming"`
	SchemaVersion     uint32 `json:"schemaVersion"`
}

// HandlerOption configures the Handler
type HandlerOption func(*Handler)

// WithConversionTrigger sets the conversion trigger for event-driven conversion
func WithConversionTrigger(trigger ConversionTrigger) HandlerOption {
	return func(h *Handler) {
		h.conversionTrigger = trigger
	}
}

func NewHandler(
	e *echo.Echo,
	repoOperation *RepoOperation,
	repoMarker *RepoMarker,
	repoAmmo *RepoAmmo,
	setting Setting,
	opts ...HandlerOption,
) {
	// Register storage engines
	storage.RegisterEngine(storage.NewJSONEngine(setting.Data))
	storage.RegisterEngine(storage.NewProtobufEngine(setting.Data))
	storage.RegisterEngine(storage.NewFlatBuffersEngine(setting.Data))

	hdlr := Handler{
		repoOperation: repoOperation,
		repoMarker:    repoMarker,
		repoAmmo:      repoAmmo,
		setting:       setting,
	}

	// Apply options
	for _, opt := range opts {
		opt(&hdlr)
	}

	e.Use(hdlr.errorHandler)

	// Healthcheck at root level for Docker/external monitoring
	e.GET("/healthcheck", hdlr.GetHealthcheck)

	prefixURL := strings.TrimRight(hdlr.setting.PrefixURL, "/")
	g := e.Group(prefixURL)

	g.GET(
		"/api/v1/operations",
		hdlr.GetOperations,
	)
	g.POST(
		"/api/v1/operations/add",
		hdlr.StoreOperation,
	)
	g.GET(
		"/api/v1/operations/:id/format",
		hdlr.GetOperationFormat,
	)
	g.GET(
		"/api/v1/operations/:id/manifest",
		hdlr.GetOperationManifest,
	)
	g.GET(
		"/api/v1/operations/:id/chunk/:index",
		hdlr.GetOperationChunk,
		hdlr.cacheControl(CacheDuration),
	)
	g.GET(
		"/api/v1/customize",
		hdlr.GetCustomize,
	)
	g.GET(
		"/api/version",
		hdlr.GetVersion,
	)
	g.GET(
		"/data/:name",
		hdlr.GetCapture,
		hdlr.cacheControl(CacheDuration),
	)
	g.GET(
		"/file/:name",
		hdlr.GetCaptureFile,
		hdlr.cacheControl(CacheDuration),
	)
	g.GET(
		"/images/markers/:name/:color",
		hdlr.GetMarker,
		hdlr.cacheControl(CacheDuration),
	)
	g.GET(
		"/images/markers/magicons/:name",
		hdlr.GetAmmo,
		hdlr.cacheControl(CacheDuration),
	)
	g.GET(
		"/images/maps/*",
		hdlr.GetMapTitle,
		hdlr.cacheControl(CacheDuration),
	)
	g.HEAD(
		"/images/maps/*",
		hdlr.GetMapTitle,
		hdlr.cacheControl(CacheDuration),
	)
	g.GET(
		"/*",
		hdlr.GetStatic,
		hdlr.cacheControl(0),
	)
	g.GET(
		"",
		hdlr.GetStatic,
		middleware.AddTrailingSlashWithConfig(middleware.TrailingSlashConfig{
			RedirectCode: http.StatusMovedPermanently,
		}),
	)
}

func (*Handler) cacheControl(duration time.Duration) echo.MiddlewareFunc {
	var header string
	if duration < time.Second {
		header = "no-cache"
	} else {
		header = fmt.Sprintf("max-age=%.0f", duration.Seconds())
	}
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			c.Response().Header().Set("Cache-Control", header)
			return next(c)
		}
	}
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

func (h *Handler) GetVersion(c echo.Context) error {
	return c.JSONPretty(http.StatusOK, struct {
		BuildVersion string
		BuildCommit  string
		BuildDate    string
	}{
		BuildVersion: BuildVersion,
		BuildCommit:  BuildCommit,
		BuildDate:    BuildDate,
	}, "\t")
}

func (*Handler) GetHealthcheck(c echo.Context) error {
	return c.JSON(http.StatusOK, map[string]string{"status": "ok"})
}

func (h *Handler) GetOperationFormat(c echo.Context) error {
	id := c.Param("id")

	op, err := h.repoOperation.GetByID(c.Request().Context(), id)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "operation not found")
	}

	// Get engine for this format
	format := op.StorageFormat
	if format == "" {
		format = "json"
	}

	engine, err := storage.GetEngine(format)
	if err != nil {
		// Fallback to json if unknown format
		engine, _ = storage.GetEngine("json")
		format = "json"
	}

	chunkCount, _ := engine.ChunkCount(c.Request().Context(), op.Filename)

	// Default schema version to 1 for legacy recordings
	schemaVersion := op.SchemaVersion
	if schemaVersion == 0 {
		schemaVersion = 1
	}

	return c.JSON(http.StatusOK, FormatInfo{
		Format:            format,
		ChunkCount:        chunkCount,
		SupportsStreaming: engine.SupportsStreaming(),
		SchemaVersion:     schemaVersion,
	})
}

func (h *Handler) GetOperationManifest(c echo.Context) error {
	id := c.Param("id")

	op, err := h.repoOperation.GetByID(c.Request().Context(), id)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "operation not found")
	}

	// Get engine for this format
	format := op.StorageFormat
	if format == "" {
		format = "json"
	}

	engine, err := storage.GetEngine(format)
	if err != nil {
		// Fallback to json if unknown format
		engine, _ = storage.GetEngine("json")
		format = "json"
	}

	// For binary formats (protobuf, flatbuffers), stream raw file
	if format == "protobuf" || format == "flatbuffers" {
		reader, err := engine.GetManifestReader(c.Request().Context(), op.Filename)
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, "failed to load manifest")
		}
		defer reader.Close()

		contentType := "application/x-protobuf"
		if format == "flatbuffers" {
			contentType = "application/x-flatbuffers"
		}
		return c.Stream(http.StatusOK, contentType, reader)
	}

	// For JSON format, return as JSON
	manifest, err := engine.GetManifest(c.Request().Context(), op.Filename)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to load manifest")
	}
	return c.JSON(http.StatusOK, manifest)
}

func (h *Handler) GetOperationChunk(c echo.Context) error {
	id := c.Param("id")
	indexStr := c.Param("index")

	// Parse chunk index
	chunkIndex, err := strconv.Atoi(indexStr)
	if err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid chunk index")
	}

	// Get operation by ID
	op, err := h.repoOperation.GetByID(c.Request().Context(), id)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "operation not found")
	}

	// Determine format (use "json" as fallback if StorageFormat is empty)
	format := op.StorageFormat
	if format == "" {
		format = "json"
	}

	// Get engine for this format
	engine, err := storage.GetEngine(format)
	if err != nil {
		// Fallback to json if unknown format
		engine, _ = storage.GetEngine("json")
	}

	// Get chunk reader for streaming
	reader, err := engine.GetChunkReader(c.Request().Context(), op.Filename, chunkIndex)
	if err != nil {
		return echo.NewHTTPError(http.StatusNotFound, "chunk not found")
	}
	defer reader.Close()

	// Set content type based on format
	contentType := "application/x-protobuf"
	if format == "flatbuffers" {
		contentType = "application/x-flatbuffers"
	}

	return c.Stream(http.StatusOK, contentType, reader)
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

	filename := filepath.Base(c.FormValue("filename"))
	filename = strings.TrimSuffix(filename, ".gz")
	filename = strings.TrimSuffix(filename, ".json")

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

	writer, err := os.Create(filepath.Join(h.setting.Data, filename+".json.gz"))
	if err != nil {
		return err
	}

	if _, err = io.Copy(writer, file); err != nil {
		return err
	}

	// Trigger conversion immediately if enabled (async, non-blocking)
	if h.conversionTrigger != nil {
		h.conversionTrigger.TriggerConversion(op.ID, op.Filename)
	}

	return c.NoContent(http.StatusOK)
}

func (h *Handler) GetCapture(c echo.Context) error {
	name, err := url.PathUnescape(c.Param("name"))
	if err != nil {
		return err
	}

	upath := filepath.Join(h.setting.Data, filepath.Base(name+".json.gz"))

	c.Response().Header().Set("Content-Encoding", "gzip")
	c.Response().Header().Set("Content-Type", "application/json")

	return c.File(upath)
}

func (h *Handler) GetCaptureFile(c echo.Context) error {
	name, err := url.PathUnescape(c.Param("name"))
	if err != nil {
		return err
	}

	filename := filepath.Base(name + ".json.gz")

	c.Response().Header().Set("Content-Disposition", "attachment;filename=\""+filename+"\"")

	return c.Attachment(filepath.Join(h.setting.Data, filename), filename)
}

func (h *Handler) GetMarker(c echo.Context) error {
	var (
		ctx   = c.Request().Context()
		color = c.Param("color")
	)

	name, err := url.PathUnescape(c.Param("name"))
	if err != nil {
		return err
	}

	// Deprecated: support old version
	pos := strings.IndexByte(color, '.')
	if pos != -1 {
		color = color[:pos]
	}

	img, ct, err := h.repoMarker.Get(ctx, filepath.Base(name), color)
	if err != nil {
		return err
	}

	return c.Stream(http.StatusOK, ct, img)
}

func (h *Handler) GetMapTitle(c echo.Context) error {
	relativePath, err := paramPath(c, "*")
	if err != nil {
		return fmt.Errorf("clean path: %s: %w", err.Error(), ErrNotFound)
	}

	absolutePath := filepath.Join(h.setting.Maps, relativePath)

	return c.File(absolutePath)
}

func (h *Handler) GetStatic(c echo.Context) error {
	relativePath, err := paramPath(c, "*")
	if err != nil {
		return fmt.Errorf("clean path: %s: %w", err.Error(), ErrNotFound)
	}

	absolutePath := filepath.Join(h.setting.Static, relativePath)

	// Serve index.html for directory requests
	if info, statErr := os.Stat(absolutePath); statErr == nil && info.IsDir() {
		absolutePath = filepath.Join(absolutePath, "index.html")
	}

	return c.File(absolutePath)
}

func (h *Handler) GetAmmo(c echo.Context) error {
	var (
		ctx  = c.Request().Context()
		name = c.Param("name")
	)

	name, err := url.PathUnescape(name)
	if err != nil {
		return err
	}

	// remote extension
	pos := strings.IndexByte(name, '.')
	if pos != -1 {
		name = name[:pos]
	}

	// support format
	// gear_smokegrenade_white_ca.paa.png
	name = strings.Replace(name, ".paa", "", 1)

	upath, err := h.repoAmmo.GetPath(ctx, filepath.Base(name))
	if err != nil {
		return err
	}

	return c.File(upath)
}

func paramPath(c echo.Context, param string) (string, error) {
	urlPath, err := url.PathUnescape(c.Param(param))
	if err != nil {
		return "", fmt.Errorf("path unescape: %w", err)
	}

	// Use path.Clean (not filepath.Clean) for URL paths - URLs always use forward slashes
	cleanPath := path.Clean("/" + urlPath)
	if cleanPath != "/"+urlPath {
		return "", ErrInvalidPath
	}

	return cleanPath, nil
}
