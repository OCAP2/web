package server

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	pb "github.com/OCAP2/web/proto"
	"github.com/OCAP2/web/server/storage"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"google.golang.org/protobuf/proto"
)

const CacheDuration = 7 * 24 * time.Hour

var (
	BuildCommit string
	BuildDate   string
)

type Handler struct {
	repoOperation *RepoOperation
	repoMarker    *RepoMarker
	repoAmmo      *RepoAmmo
	setting       Setting
}

// FormatInfo contains storage format details for a recording
type FormatInfo struct {
	Format            string `json:"format"`
	ChunkCount        int    `json:"chunkCount"`
	SupportsStreaming bool   `json:"supportsStreaming"`
}

func NewHandler(
	e *echo.Echo,
	repoOperation *RepoOperation,
	repoMarker *RepoMarker,
	repoAmmo *RepoAmmo,
	setting Setting,
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

	e.Use(hdlr.errorHandler)

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
		BuildCommit string
		BuildDate   string
	}{
		BuildCommit: BuildCommit,
		BuildDate:   BuildDate,
	}, "\t")
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

	return c.JSON(http.StatusOK, FormatInfo{
		Format:            format,
		ChunkCount:        chunkCount,
		SupportsStreaming: engine.SupportsStreaming(),
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

	manifest, err := engine.GetManifest(c.Request().Context(), op.Filename)
	if err != nil {
		return echo.NewHTTPError(http.StatusInternalServerError, "failed to load manifest")
	}

	// For protobuf format, serialize to binary
	if format == "protobuf" {
		pbManifest := manifestToProto(manifest)
		data, err := proto.Marshal(pbManifest)
		if err != nil {
			return echo.NewHTTPError(http.StatusInternalServerError, "failed to serialize manifest")
		}
		return c.Blob(http.StatusOK, "application/x-protobuf", data)
	}

	// For JSON format, return as JSON
	return c.JSON(http.StatusOK, manifest)
}

// manifestToProto converts storage.Manifest to proto.Manifest
func manifestToProto(m *storage.Manifest) *pb.Manifest {
	pbManifest := &pb.Manifest{
		Version:        m.Version,
		WorldName:      m.WorldName,
		MissionName:    m.MissionName,
		FrameCount:     m.FrameCount,
		ChunkSize:      m.ChunkSize,
		CaptureDelayMs: m.CaptureDelayMs,
		ChunkCount:     m.ChunkCount,
	}

	for _, ent := range m.Entities {
		pbManifest.Entities = append(pbManifest.Entities, &pb.EntityDef{
			Id:           ent.ID,
			Type:         stringToEntityType(ent.Type),
			Name:         ent.Name,
			Side:         stringToSide(ent.Side),
			GroupName:    ent.Group,
			Role:         ent.Role,
			StartFrame:   ent.StartFrame,
			EndFrame:     ent.EndFrame,
			IsPlayer:     ent.IsPlayer,
			VehicleClass: ent.VehicleClass,
		})
	}

	return pbManifest
}

func stringToEntityType(s string) pb.EntityType {
	switch s {
	case "unit":
		return pb.EntityType_ENTITY_TYPE_UNIT
	case "vehicle":
		return pb.EntityType_ENTITY_TYPE_VEHICLE
	default:
		return pb.EntityType_ENTITY_TYPE_UNKNOWN
	}
}

func stringToSide(s string) pb.Side {
	switch s {
	case "WEST":
		return pb.Side_SIDE_WEST
	case "EAST":
		return pb.Side_SIDE_EAST
	case "GUER":
		return pb.Side_SIDE_GUER
	case "CIV":
		return pb.Side_SIDE_CIV
	case "GLOBAL":
		return pb.Side_SIDE_GLOBAL
	default:
		return pb.Side_SIDE_UNKNOWN
	}
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

	return c.Stream(http.StatusOK, "application/x-protobuf", reader)
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

	writer, err := os.Create(filepath.Join(h.setting.Data, filename+".gz"))
	if err != nil {
		return err
	}

	if _, err = io.Copy(writer, file); err != nil {
		return err
	}

	return c.NoContent(http.StatusOK)
}

func (h *Handler) GetCapture(c echo.Context) error {
	name, err := url.PathUnescape(c.Param("name"))
	if err != nil {
		return err
	}

	upath := filepath.Join(h.setting.Data, filepath.Base(name+".gz"))

	c.Response().Header().Set("Content-Encoding", "gzip")
	c.Response().Header().Set("Content-Type", "application/json")

	return c.File(upath)
}

func (h *Handler) GetCaptureFile(c echo.Context) error {
	name, err := url.PathUnescape(c.Param("name"))
	if err != nil {
		return err
	}

	filename := filepath.Base(name + ".gz")

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

	cleanPath := filepath.Clean("/" + urlPath)
	if cleanPath != "/"+urlPath {
		return "", ErrInvalidPath
	}

	return cleanPath, nil
}
