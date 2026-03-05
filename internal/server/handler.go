package server

import (
	"bufio"
	"bytes"
	"errors"
	"compress/gzip"
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
	"sync"
	"time"

	"github.com/OCAP2/web/internal/maptool"
	"github.com/getkin/kin-openapi/openapi3"
	"github.com/go-fuego/fuego"
	"github.com/yohcop/openid-go"
)

// ContextNoBody is the Fuego context type used by typed handlers that take no request body.
type ContextNoBody = fuego.ContextNoBody

// OpenAPISecuritySchemes defines the security schemes for the OpenAPI spec.
var OpenAPISecuritySchemes = openapi3.SecuritySchemes{
	"bearerAuth": &openapi3.SecuritySchemeRef{
		Value: openapi3.NewSecurityScheme().
			WithType("http").
			WithScheme("bearer").
			WithBearerFormat("JWT").
			WithDescription("JWT token obtained via Steam OpenID login"),
	},
}

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
	jwt               *JWTManager
	conversionTrigger ConversionTrigger  // optional, nil if conversion disabled
	staticFS          fs.FS              // optional, nil disables static file serving
	maptoolMgr        *maptool.JobManager // optional, nil if maptool disabled
	maptoolCfg        *maptoolConfig      // optional, nil if maptool disabled
	openIDVerifier    openIDVerifier
	openIDCache       openid.DiscoveryCache
	openIDNonceStore  openid.NonceStore
	steamAPIBaseURL   string // override for testing; empty uses default

	spriteOnce    sync.Once
	spriteFiles   map[string][]byte
	spriteInitErr error
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

// WithMapTool enables the maptool integration
func WithMapTool(jm *maptool.JobManager, tools maptool.ToolSet, mapsDir string) HandlerOption {
	return func(h *Handler) {
		h.maptoolMgr = jm
		h.maptoolCfg = &maptoolConfig{tools: tools, mapsDir: mapsDir}
	}
}

// Response types for typed Fuego handlers
type HealthResponse struct {
	Status string `json:"status"`
}

type VersionResponse struct {
	BuildVersion string `json:"BuildVersion"`
	BuildCommit  string `json:"BuildCommit"`
	BuildDate    string `json:"BuildDate"`
}

func NewHandler(
	s *fuego.Server,
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

	hdlr.jwt = NewJWTManager(setting.Secret, setting.Auth.SessionTTL)
	hdlr.openIDCache = openid.NewSimpleDiscoveryCache()
	hdlr.openIDNonceStore = openid.NewSimpleNonceStore()
	hdlr.openIDVerifier = defaultOpenIDVerifier{}

	prefixURL := strings.TrimRight(hdlr.setting.PrefixURL, "/")
	g := fuego.Group(s, prefixURL)

	bearerAuth := openapi3.SecurityRequirement{"bearerAuth": {}}

	// Health & info
	fuego.Get(g, "/api/healthcheck", hdlr.GetHealthcheck, fuego.OptionTags("Health"))
	fuego.Get(g, "/api/version", hdlr.GetVersion, fuego.OptionTags("Health"))

	// Recordings (public read)
	fuego.Get(g, "/api/v1/operations", hdlr.GetOperations, fuego.OptionTags("Recordings"))
	fuego.Get(g, "/api/v1/operations/{id}", hdlr.GetOperation, fuego.OptionTags("Recordings"))
	fuego.Get(g, "/api/v1/operations/{id}/marker-blacklist", hdlr.GetMarkerBlacklist, fuego.OptionTags("Recordings"))
	fuego.PostStd(g, "/api/v1/operations/add", hdlr.StoreOperation, fuego.OptionTags("Recordings"))
	fuego.Get(g, "/api/v1/worlds", hdlr.GetWorlds, fuego.OptionTags("Recordings"))
	fuego.Get(g, "/api/v1/customize", hdlr.GetCustomize, fuego.OptionTags("Recordings"))
	fuego.GetStd(g, "/api/v1/stream", hdlr.HandleStream, fuego.OptionTags("Recordings"))

	// Assets (static file serving)
	cacheMiddleware := hdlr.cacheControl(CacheDuration)
	fuego.GetStd(g, "/data/{path...}", hdlr.GetData, fuego.OptionTags("Assets"), fuego.OptionMiddleware(cacheMiddleware))
	fuego.GetStd(g, "/images/markers/{name}/{color}", hdlr.GetMarker, fuego.OptionTags("Assets"), fuego.OptionMiddleware(cacheMiddleware))
	fuego.GetStd(g, "/images/markers/magicons/{name}", hdlr.GetAmmo, fuego.OptionTags("Assets"), fuego.OptionMiddleware(cacheMiddleware))
	fuego.GetStd(g, "/images/maps/fonts/{fontstack}/{range}", hdlr.GetFont, fuego.OptionTags("Assets"), fuego.OptionMiddleware(cacheMiddleware))
	fuego.GetStd(g, "/images/maps/sprites/{name}", hdlr.GetSprite, fuego.OptionTags("Assets"), fuego.OptionMiddleware(cacheMiddleware))
	fuego.GetStd(g, "/images/maps/{path...}", hdlr.GetMapTile, fuego.OptionTags("Assets"), fuego.OptionMiddleware(cacheMiddleware))

	// Auth
	fuego.GetStd(g, "/api/v1/auth/steam", hdlr.SteamLogin, fuego.OptionTags("Auth"))
	fuego.GetStd(g, "/api/v1/auth/steam/callback", hdlr.SteamCallback, fuego.OptionTags("Auth"))
	fuego.Get(g, "/api/v1/auth/me", hdlr.GetMe, fuego.OptionTags("Auth"))
	fuego.Post(g, "/api/v1/auth/logout", hdlr.Logout, fuego.OptionTags("Auth"), fuego.OptionSecurity(bearerAuth))

	// Admin (require JWT)
	admin := fuego.Group(g, "")
	fuego.Use(admin, hdlr.requireAdmin)
	fuego.Patch(admin, "/api/v1/operations/{id}", hdlr.EditOperation, fuego.OptionTags("Admin"), fuego.OptionSecurity(bearerAuth))
	fuego.Delete(admin, "/api/v1/operations/{id}", hdlr.DeleteOperation, fuego.OptionTags("Admin"), fuego.OptionSecurity(bearerAuth))
	fuego.Post(admin, "/api/v1/operations/{id}/retry", hdlr.RetryConversion, fuego.OptionTags("Admin"), fuego.OptionSecurity(bearerAuth))
	fuego.Put(admin, "/api/v1/operations/{id}/marker-blacklist/{playerId}", hdlr.AddMarkerBlacklist, fuego.OptionTags("Admin"), fuego.OptionSecurity(bearerAuth))
	fuego.Delete(admin, "/api/v1/operations/{id}/marker-blacklist/{playerId}", hdlr.RemoveMarkerBlacklist, fuego.OptionTags("Admin"), fuego.OptionSecurity(bearerAuth))

	// MapTool (require admin JWT; SSE endpoint handles its own auth via query param)
	if hdlr.maptoolMgr != nil {
		mt := fuego.Group(admin, "/api/v1/maptool")
		fuego.Get(mt, "/health", hdlr.getMapToolHealth, fuego.OptionTags("MapTool"), fuego.OptionSecurity(bearerAuth))
		fuego.Get(mt, "/tools", hdlr.getMapToolTools, fuego.OptionTags("MapTool"), fuego.OptionSecurity(bearerAuth))
		fuego.Get(mt, "/maps", hdlr.getMapToolMaps, fuego.OptionTags("MapTool"), fuego.OptionSecurity(bearerAuth))
		fuego.Delete(mt, "/maps/{name}", hdlr.deleteMapToolMap, fuego.OptionTags("MapTool"), fuego.OptionSecurity(bearerAuth))
		fuego.PostStd(mt, "/maps/import", hdlr.importMapToolZip, fuego.OptionTags("MapTool"), fuego.OptionSecurity(bearerAuth))
		fuego.Post(mt, "/maps/restyle", hdlr.restyleMapToolAll, fuego.OptionTags("MapTool"), fuego.OptionSecurity(bearerAuth))
		fuego.Get(mt, "/jobs", hdlr.getMapToolJobs, fuego.OptionTags("MapTool"), fuego.OptionSecurity(bearerAuth))
		fuego.Post(mt, "/jobs/{id}/cancel", hdlr.cancelMapToolJob, fuego.OptionTags("MapTool"), fuego.OptionSecurity(bearerAuth))
		// SSE endpoint — registered on the prefix group (not admin) so it can do its own auth via query token
		fuego.GetStd(g, "/api/v1/maptool/events", hdlr.mapToolEventStream, fuego.OptionTags("MapTool"), fuego.OptionSecurity(bearerAuth))
	}

	if hdlr.staticFS != nil {
		// Serve the SPA frontend with fallback to index.html for client-side routing
		staticHandler := spaFileServer(hdlr.staticFS, prefixURL)
		noCacheMiddleware := hdlr.cacheControl(0)
		fuego.Handle(g, "/{path...}", noCacheMiddleware(staticHandler))
	}
}

func (*Handler) cacheControl(duration time.Duration) func(http.Handler) http.Handler {
	var header string
	if duration < time.Second {
		header = "no-cache"
	} else {
		header = fmt.Sprintf("max-age=%.0f", duration.Seconds())
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cache-Control", header)
			next.ServeHTTP(w, r)
		})
	}
}

func (h *Handler) GetOperations(c ContextNoBody) ([]Operation, error) {
	ctx := c.Context()
	filter := Filter{
		Name:  c.QueryParam("name"),
		Older: c.QueryParam("older"),
		Newer: c.QueryParam("newer"),
		Tag:   c.QueryParam("tag"),
	}

	ops, err := h.repoOperation.Select(ctx, filter)
	if err != nil {
		return nil, err
	}

	return ops, nil
}

func (h *Handler) GetOperation(c ContextNoBody) (*Operation, error) {
	ctx := c.Context()
	id := c.PathParam("id")

	// Try by ID first, then by filename
	op, err := h.repoOperation.GetByID(ctx, id)
	if err != nil {
		op, err = h.repoOperation.GetByFilename(ctx, id)
		if err != nil {
			return nil, fuego.NotFoundError{Err: err}
		}
	}

	return op, nil
}

func (h *Handler) GetWorlds(c ContextNoBody) ([]WorldInfo, error) {
	worlds, err := ScanWorlds(h.setting.Maps)
	if err != nil {
		return nil, err
	}
	return worlds, nil
}

func (h *Handler) GetCustomize(c ContextNoBody) (*Customize, error) {
	if !h.setting.Customize.Enabled {
		c.SetStatus(http.StatusNoContent)
		return nil, nil
	}
	return &h.setting.Customize, nil
}

func (h *Handler) GetVersion(c ContextNoBody) (VersionResponse, error) {
	return VersionResponse{
		BuildVersion: BuildVersion,
		BuildCommit:  BuildCommit,
		BuildDate:    BuildDate,
	}, nil
}

func (*Handler) GetHealthcheck(c ContextNoBody) (HealthResponse, error) {
	return HealthResponse{Status: "ok"}, nil
}

func (h *Handler) StoreOperation(w http.ResponseWriter, r *http.Request) {
	var (
		ctx    = r.Context()
		secret = r.FormValue("secret")
		err    error
	)

	if secret != h.setting.Secret {
		// Fall back to JWT Bearer token auth (admin UI uploads)
		if token := bearerToken(r); token == "" || h.jwt.Validate(token) != nil {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}
	}

	filename := filepath.Base(r.FormValue("filename"))
	filename = strings.TrimSuffix(filename, ".gz")
	filename = strings.TrimSuffix(filename, ".json")

	op := Operation{
		WorldName:   r.FormValue("worldName"),
		MissionName: r.FormValue("missionName"),
		Filename:    filename,
		Date:        time.Now().Format("2006-01-02"),
		// Support old extension version tag or type
		Tag: r.FormValue("tag") + r.FormValue("type"),
	}
	op.MissionDuration, err = strconv.ParseFloat(r.FormValue("missionDuration"), 64)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if fs := r.FormValue("focusStart"); fs != "" {
		v, err := strconv.ParseInt(fs, 10, 64)
		if err != nil {
			http.Error(w, "Bad Request", http.StatusBadRequest)
			return
		}
		op.FocusStart = &v
	}
	if fe := r.FormValue("focusEnd"); fe != "" {
		v, err := strconv.ParseInt(fe, 10, 64)
		if err != nil {
			http.Error(w, "Bad Request", http.StatusBadRequest)
			return
		}
		op.FocusEnd = &v
	}

	// Validate focus range: both must be present or both absent, and start < end
	if (op.FocusStart == nil) != (op.FocusEnd == nil) {
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}
	if op.FocusStart != nil && op.FocusEnd != nil && *op.FocusStart >= *op.FocusEnd {
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}

	if err = h.repoOperation.Store(ctx, &op); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	form, _, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "Bad Request", http.StatusBadRequest)
		return
	}
	defer form.Close()

	// Peek at the first two bytes to detect gzip magic number (0x1f 0x8b)
	br := bufio.NewReader(form)
	header, err := br.Peek(2)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	isGzipped := header[0] == 0x1f && header[1] == 0x8b

	outFile, err := os.Create(filepath.Join(h.setting.Data, filename+".json.gz"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer outFile.Close()

	if isGzipped {
		if _, err = io.Copy(outFile, br); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	} else {
		gw := gzip.NewWriter(outFile)
		if _, err = io.Copy(gw, br); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if err = gw.Close(); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}

	// Trigger conversion immediately if enabled (async, non-blocking).
	// When conversion is disabled, mark the operation as completed so
	// it is immediately available for playback in the UI.
	if h.conversionTrigger != nil {
		h.conversionTrigger.TriggerConversion(op.ID, op.Filename)
	} else {
		if err = h.repoOperation.UpdateConversionStatus(ctx, op.ID, ConversionStatusCompleted); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}

	w.WriteHeader(http.StatusOK)
}

func (h *Handler) GetData(w http.ResponseWriter, r *http.Request) {
	relativePath, err := paramPathFromRequest(r, "path")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	absolutePath := filepath.Join(h.setting.Data, relativePath)

	// For .json.gz files, check if the content is actually gzipped
	// before setting Content-Encoding. Legacy uploads may have stored
	// raw JSON with a .json.gz extension.
	if strings.HasSuffix(relativePath, ".json.gz") {
		f, err := os.Open(absolutePath)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer f.Close()
		var magic [2]byte
		_, err = io.ReadFull(f, magic[:])
		if err != nil {
			http.NotFound(w, r)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		if magic[0] == 0x1f && magic[1] == 0x8b {
			w.Header().Set("Content-Encoding", "gzip")
		}
		http.ServeFile(w, r, absolutePath)
		return
	}

	if _, err := os.Stat(absolutePath); err != nil {
		http.NotFound(w, r)
		return
	}

	http.ServeFile(w, r, absolutePath)
}

func (h *Handler) GetMarker(w http.ResponseWriter, r *http.Request) {
	var (
		ctx   = r.Context()
		color = r.PathValue("color")
	)

	name, err := url.PathUnescape(r.PathValue("name"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Deprecated: support old version
	pos := strings.IndexByte(color, '.')
	if pos != -1 {
		color = color[:pos]
	}

	img, ct, err := h.repoMarker.Get(ctx, filepath.Base(name), color)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			http.NotFound(w, r)
		} else {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
		return
	}

	w.Header().Set("Content-Type", ct)
	io.Copy(w, img)
}

func (h *Handler) GetSprite(w http.ResponseWriter, r *http.Request) {
	h.spriteOnce.Do(func() {
		h.spriteFiles, h.spriteInitErr = maptool.GenerateSpriteBytes()
	})
	if h.spriteInitErr != nil {
		http.Error(w, fmt.Sprintf("generate sprites: %v", h.spriteInitErr), http.StatusInternalServerError)
		return
	}

	name := r.PathValue("name")
	data, ok := h.spriteFiles[name]
	if !ok {
		http.NotFound(w, r)
		return
	}

	ct := "application/json"
	if strings.HasSuffix(name, ".png") {
		ct = "image/png"
	}
	w.Header().Set("Content-Type", ct)
	w.Write(data)
}

func (h *Handler) GetFont(w http.ResponseWriter, r *http.Request) {
	fontstack := filepath.Base(r.PathValue("fontstack"))
	rangeParam := filepath.Base(r.PathValue("range"))

	absolutePath := filepath.Join(h.setting.Fonts, fontstack, rangeParam)

	http.ServeFile(w, r, absolutePath)
}

func (h *Handler) GetMapTile(w http.ResponseWriter, r *http.Request) {
	relativePath, err := paramPathFromRequest(r, "path")
	if err != nil {
		http.NotFound(w, r)
		return
	}

	absolutePath := filepath.Join(h.setting.Maps, relativePath)

	http.ServeFile(w, r, absolutePath)
}

// spaFileServer returns an http.Handler that serves static files from fsys,
// falling back to index.html for paths that don't match a file (SPA routing).
// The prefix is injected into index.html as window.__BASE_PATH__ so the
// frontend SPA can discover its base URL at runtime.
func spaFileServer(fsys fs.FS, prefix string) http.Handler {
	handler := http.StripPrefix(prefix, http.FileServer(http.FS(fsys)))

	// Pre-read index.html and inject the base path script tag once at startup.
	var indexContent []byte
	var indexModTime time.Time
	if f, err := fsys.Open("index.html"); err == nil {
		defer f.Close()
		if stat, err := f.Stat(); err == nil {
			indexModTime = stat.ModTime()
		}
		if raw, err := io.ReadAll(f); err == nil {
			base := prefix + "/"
			inject := fmt.Sprintf(`<base href=%q /><script>window.__BASE_PATH__=%q;</script>`, base, prefix)
			// Inject right after <head> so <base> is parsed before any relative URLs
			indexContent = bytes.Replace(raw, []byte("<head>"), []byte("<head>"+inject), 1)
		}
	}

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

		// Fallback: serve index.html (with injected base path) for SPA routing.
		if indexContent == nil {
			http.NotFound(w, r)
			return
		}
		http.ServeContent(w, r, "index.html", indexModTime, bytes.NewReader(indexContent))
	})
}

func (h *Handler) GetAmmo(w http.ResponseWriter, r *http.Request) {
	var (
		ctx  = r.Context()
		name = r.PathValue("name")
	)

	name, err := url.PathUnescape(name)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
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
		if errors.Is(err, ErrNotFound) {
			http.NotFound(w, r)
		} else {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
		return
	}

	http.ServeFile(w, r, upath)
}

func paramPathFromRequest(r *http.Request, param string) (string, error) {
	urlPath, err := url.PathUnescape(r.PathValue(param))
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
