package server

import (
	"bufio"
	"compress/gzip"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
)

const CacheDuration = 7 * 24 * time.Hour

var (
	BuildVersion = "dev"
	BuildCommit  = "unknown"
	BuildDate    = "unknown"
)

// ConversionTrigger triggers async conversion of an operation
type ConversionTrigger interface {
	TriggerConversion(id int64, filename string)
}

type Handler struct {
	repoOperation     *RepoOperation
	repoMarker        *RepoMarker
	repoAmmo          *RepoAmmo
	setting           Setting
	conversionTrigger ConversionTrigger // optional, nil if conversion disabled
	staticFS          fs.FS             // optional, nil disables static file serving
}

// HandlerOption configures the Handler
type HandlerOption func(*Handler)

// WithConversionTrigger sets the conversion trigger for event-driven conversion
func WithConversionTrigger(trigger ConversionTrigger) HandlerOption {
	return func(h *Handler) {
		h.conversionTrigger = trigger
	}
}

// WithStaticFS sets the filesystem used to serve the frontend
func WithStaticFS(fsys fs.FS) HandlerOption {
	return func(h *Handler) {
		h.staticFS = fsys
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

	prefixURL := strings.TrimRight(hdlr.setting.PrefixURL, "/")
	g := e.Group(prefixURL)

	g.GET("/api/healthcheck", hdlr.GetHealthcheck)

	g.GET(
		"/api/v1/operations",
		hdlr.GetOperations,
	)
	g.GET(
		"/api/v1/operations/:id",
		hdlr.GetOperation,
	)
	g.POST(
		"/api/v1/operations/add",
		hdlr.StoreOperation,
	)
	g.GET(
		"/api/v1/customize",
		hdlr.GetCustomize,
	)
	g.GET(
		"/api/v1/stream",
		hdlr.HandleStream,
	)
	g.GET(
		"/api/version",
		hdlr.GetVersion,
	)
	g.GET(
		"/data/*",
		hdlr.GetData,
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
		"/images/maps/fonts/:fontstack/:range",
		hdlr.GetFont,
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
	if hdlr.staticFS != nil {
		// Serve the SPA frontend with fallback to index.html for client-side routing
		staticHandler := spaFileServer(hdlr.staticFS, prefixURL)
		g.GET("/*", echo.WrapHandler(staticHandler), hdlr.cacheControl(0))
		g.GET("", echo.WrapHandler(staticHandler), middleware.AddTrailingSlashWithConfig(middleware.TrailingSlashConfig{
			RedirectCode: http.StatusMovedPermanently,
		}))
	}
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

func (h *Handler) GetOperation(c echo.Context) error {
	ctx := c.Request().Context()
	id := c.Param("id")

	// Try by ID first, then by filename
	op, err := h.repoOperation.GetByID(ctx, id)
	if err != nil {
		op, err = h.repoOperation.GetByFilename(ctx, id)
		if err != nil {
			return echo.ErrNotFound
		}
	}

	return c.JSONPretty(http.StatusOK, op, "\t")
}

func (h *Handler) GetCustomize(c echo.Context) error {
	if !h.setting.Customize.Enabled {
		return c.NoContent(http.StatusNoContent)
	}
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

	// Peek at the first two bytes to detect gzip magic number (0x1f 0x8b)
	br := bufio.NewReader(file)
	header, err := br.Peek(2)
	if err != nil {
		return err
	}
	isGzipped := header[0] == 0x1f && header[1] == 0x8b

	outFile, err := os.Create(filepath.Join(h.setting.Data, filename+".json.gz"))
	if err != nil {
		return err
	}
	defer outFile.Close()

	if isGzipped {
		if _, err = io.Copy(outFile, br); err != nil {
			return err
		}
	} else {
		gw := gzip.NewWriter(outFile)
		if _, err = io.Copy(gw, br); err != nil {
			return err
		}
		if err = gw.Close(); err != nil {
			return err
		}
	}

	// Trigger conversion immediately if enabled (async, non-blocking).
	// When conversion is disabled, mark the operation as completed so
	// it is immediately available for playback in the UI.
	if h.conversionTrigger != nil {
		h.conversionTrigger.TriggerConversion(op.ID, op.Filename)
	} else {
		if err = h.repoOperation.UpdateConversionStatus(ctx, op.ID, ConversionStatusCompleted); err != nil {
			return err
		}
	}

	return c.NoContent(http.StatusOK)
}

func (h *Handler) GetData(c echo.Context) error {
	relativePath, err := paramPath(c, "*")
	if err != nil {
		return fmt.Errorf("clean path: %s: %w", err.Error(), ErrNotFound)
	}
	absolutePath := filepath.Join(h.setting.Data, relativePath)

	// For .json.gz files, check if the content is actually gzipped
	// before setting Content-Encoding. Legacy uploads may have stored
	// raw JSON with a .json.gz extension.
	if strings.HasSuffix(relativePath, ".json.gz") {
		f, err := os.Open(absolutePath)
		if err != nil {
			return echo.ErrNotFound
		}
		defer f.Close()
		var magic [2]byte
		_, err = io.ReadFull(f, magic[:])
		if err != nil {
			return echo.ErrNotFound
		}

		c.Response().Header().Set("Content-Type", "application/json")
		if magic[0] == 0x1f && magic[1] == 0x8b {
			c.Response().Header().Set("Content-Encoding", "gzip")
		}
		return c.File(absolutePath)
	}

	if _, err := os.Stat(absolutePath); err != nil {
		return echo.ErrNotFound
	}

	return c.File(absolutePath)
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

func (h *Handler) GetFont(c echo.Context) error {
	fontstack := filepath.Base(c.Param("fontstack"))
	rangeParam := filepath.Base(c.Param("range"))

	absolutePath := filepath.Join(h.setting.Fonts, fontstack, rangeParam)

	return c.File(absolutePath)
}

func (h *Handler) GetMapTitle(c echo.Context) error {
	relativePath, err := paramPath(c, "*")
	if err != nil {
		return fmt.Errorf("clean path: %s: %w", err.Error(), ErrNotFound)
	}

	absolutePath := filepath.Join(h.setting.Maps, relativePath)

	return c.File(absolutePath)
}

// spaFileServer returns an http.Handler that serves static files from fsys,
// falling back to index.html for paths that don't match a file (SPA routing).
func spaFileServer(fsys fs.FS, prefix string) http.Handler {
	handler := http.StripPrefix(prefix, http.FileServer(http.FS(fsys)))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Strip the prefix so the FS lookup starts at the root
		p := strings.TrimPrefix(r.URL.Path, prefix)
		p = strings.TrimPrefix(p, "/")

		// Serve existing files directly
		if p != "" {
			if _, err := fs.Stat(fsys, p); err == nil {
				handler.ServeHTTP(w, r)
				return
			}
		}

		// Fallback: serve index.html for SPA client-side routing.
		// Read directly to avoid http.FileServer's redirect of /index.html → /
		f, err := fsys.Open("index.html")
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer f.Close()

		stat, err := f.Stat()
		if err != nil {
			http.NotFound(w, r)
			return
		}

		http.ServeContent(w, r, "index.html", stat.ModTime(), f.(io.ReadSeeker))
	})
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
