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

	"github.com/OCAP2/web/db/sqlgen"
	"github.com/jackc/pgx/v5"
	"github.com/labstack/echo/v4"
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
	db            *pgx.Conn
	query         *sqlgen.Queries
}

func NewHandler(
	e *echo.Echo,
	repoOperation *RepoOperation,
	repoMarker *RepoMarker,
	repoAmmo *RepoAmmo,
	setting Setting,
	db *pgx.Conn,
	query *sqlgen.Queries,
) {
	hdlr := Handler{
		repoOperation: repoOperation,
		repoMarker:    repoMarker,
		repoAmmo:      repoAmmo,
		setting:       setting,
		db:            db,
		query:         query,
	}

	e.Use(hdlr.errorHandler)

	e.GET(
		"/healthcheck",
		hdlr.HealthCheck,
	)
	e.GET(
		"/api/v1/operations",
		hdlr.GetOperations,
	)
	e.POST(
		"/api/v1/operations/add",
		hdlr.StoreOperation,
	)
	e.GET(
		"/api/v1/customize",
		hdlr.GetCustomize,
	)
	e.GET(
		"/api/version",
		hdlr.GetVersion,
	)
	e.GET(
		"/data/:name",
		hdlr.GetCapture,
		hdlr.cacheControl(CacheDuration),
	)
	e.GET(
		"/images/markers/:name/:color",
		hdlr.GetMarker,
		hdlr.cacheControl(CacheDuration),
	)
	e.GET(
		"/images/markers/magicons/:name",
		hdlr.GetAmmo,
		hdlr.cacheControl(CacheDuration),
	)
	e.GET(
		"/images/maps/*",
		hdlr.GetMapTitle,
		hdlr.cacheControl(CacheDuration),
	)
	e.GET(
		"/*",
		hdlr.GetStatic,
		hdlr.cacheControl(0),
	)

	// api v2
	e.GET(
		"/api/v2/worlds",
		hdlr.GetWorlds,
	)
	e.GET(
		"/api/v2/worlds/:id",
		hdlr.GetWorldById,
	)
	e.GET(
		"/api/v2/missions",
		hdlr.GetMissions,
	)
	e.GET(
		"/api/v2/missions/:id",
		hdlr.GetMissionById,
	)
	e.GET(
		"/api/v2/missions/:id/entities",
		hdlr.GetEntities,
	)
	e.GET(
		"/api/v2/missions/:id/soldier-detail/:ocapid",
		hdlr.GetSoldierDetailsByOcapId,
	)
	e.GET(
		"/api/v2/missions/:id/vehicle-detail/:ocapid",
		hdlr.GetVehicleDetailsByOcapId,
	)
	e.GET(
		"/api/v2/missions/:id/chat",
		hdlr.GetOtherChatEvents,
	)
	e.GET(
		"/api/v2/missions/:id/fps",
		hdlr.GetServerFpsEvents,
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

func (h *Handler) HealthCheck(c echo.Context) error {
	return c.NoContent(http.StatusOK)
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
	upath, err := url.PathUnescape(c.Param("*"))
	if err != nil {
		return err
	}
	upath = filepath.Join(h.setting.Maps, filepath.Clean("/"+upath))

	return c.File(upath)
}

func (h *Handler) GetStatic(c echo.Context) error {
	upath, err := url.PathUnescape(c.Param("*"))
	if err != nil {
		return err
	}
	upath = filepath.Join(h.setting.Static, filepath.Clean("/"+upath))

	return c.File(upath)
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

func (h *Handler) GetMissions(c echo.Context) error {
	var (
		ctx = c.Request().Context()
	)

	missions, err := h.query.GetMissions(ctx)
	if err != nil {
		return err
	}

	return c.JSON(http.StatusOK, missions)
}

func (h *Handler) GetMissionById(c echo.Context) error {
	var (
		ctx = c.Request().Context()
		r   = c.Request()
	)

	// mission id is a path param
	if c.Param("id") == "" {
		// accept query: ?id=1
		id := r.URL.Query().Get("id")
		if id == "" {
			return echo.ErrBadRequest
		}
		c.SetParamNames("id")
		c.SetParamValues(id)
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		return err
	}

	mission, err := h.query.GetMissionById(ctx, int32(id))
	if err != nil {
		return err
	}

	return c.JSON(http.StatusOK, mission)
}

func (h *Handler) GetWorlds(c echo.Context) error {
	var (
		ctx = c.Request().Context()
	)

	worlds, err := h.query.GetWorlds(ctx)
	if err != nil {
		return err
	}

	return c.JSON(http.StatusOK, worlds)
}

func (h *Handler) GetWorldById(c echo.Context) error {
	var (
		ctx = c.Request().Context()
		r   = c.Request()
	)

	// world id is a path param
	if c.Param("id") == "" {
		// accept query: ?id=1
		id := r.URL.Query().Get("id")
		if id == "" {
			return echo.ErrBadRequest
		}
		c.SetParamNames("id")
		c.SetParamValues(id)
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		return err
	}

	worlds, err := h.query.GetWorldById(ctx, int32(id))
	if err != nil {
		return err
	}

	return c.JSON(http.StatusOK, worlds)
}

func (h *Handler) getMissionIdQuery(
	missionId string,
) (
	missionIdInt32 int32,
	err error,
) {
	if missionId == "" {
		return 0, err
	}

	missionIdInt, err := strconv.Atoi(missionId)
	if err != nil {
		return 0, err
	}

	return int32(missionIdInt), nil
}

func (h *Handler) getFrameQuery(
	startFrame string,
	endFrame string,
) (
	startFrameInt32 int32,
	endFrameInt32 int32,
	err error,
) {

	var startFrameInt, endFrameInt int

	if startFrame != "" && endFrame != "" {
		startFrameInt, err = strconv.Atoi(startFrame)
		if err != nil {
			return 0, 0, err
		}
		endFrameInt, err = strconv.Atoi(endFrame)
		if err != nil {
			return 0, 0, err
		}
	} else {
		return 0, 0, echo.ErrBadRequest
	}

	return int32(startFrameInt), int32(endFrameInt), nil
}

func (h *Handler) GetEntities(c echo.Context) error {
	var (
		ctx = c.Request().Context()
	)

	missionId, err := h.getMissionIdQuery(c.Param("id"))
	if err != nil {
		return echo.ErrBadRequest
	}

	entities, err := h.query.GetEntities(ctx, missionId)
	if err != nil {
		return echo.ErrInternalServerError
	}

	return c.JSON(http.StatusOK, entities)
}

func (h *Handler) GetSoldierDetailsByOcapId(c echo.Context) error {
	var (
		ctx = c.Request().Context()
		r   = c.Request()
	)

	missionId, err := h.getMissionIdQuery(c.Param("id"))
	if err != nil {
		return echo.ErrBadRequest
	}

	ocapId, err := strconv.Atoi(c.Param("ocapid"))
	if err != nil {
		return echo.ErrBadRequest
	}

	params := sqlgen.GetSoldierByOcapIdParams{
		MissionID: missionId,
		OcapID:    int32(ocapId),
	}

	// look for startFrame and endFrame query params
	startFrame, endFrame, err := h.getFrameQuery(
		r.URL.Query().Get("startFrame"),
		r.URL.Query().Get("endFrame"),
	)
	if err != nil {
		fmt.Println(err)
		return echo.ErrBadRequest
	}

	outJson := map[string]interface{}{}

	soldier, err := h.query.GetSoldierByOcapId(ctx, params)
	if err != nil && err != pgx.ErrNoRows {
		fmt.Println(err)
		return echo.ErrInternalServerError
	}
	if err == pgx.ErrNoRows || !(soldier.ID > 0) {
		return echo.ErrNotFound
	}
	outJson["soldier"] = soldier

	states, err := h.query.GetSoldierStates(ctx, sqlgen.GetSoldierStatesParams{
		MissionID:  missionId,
		StartFrame: startFrame,
		EndFrame:   endFrame,
		OcapID:     int32(ocapId),
	})
	if err != nil {
		fmt.Println(err)
		return echo.ErrInternalServerError
	}
	if err == pgx.ErrNoRows {
		return echo.ErrNotFound
	} else {
		outJson["states"] = states
	}

	firedEvents, err := h.query.GetFiredEvents(ctx, sqlgen.GetFiredEventsParams{
		MissionID:  missionId,
		StartFrame: startFrame,
		EndFrame:   endFrame,
		OcapID:     int32(ocapId),
	})
	if err != nil {
		fmt.Println(err)
		return echo.ErrInternalServerError
	}
	if !firedEvents[0].ID.Valid {
		outJson["firedEvents"] = [][]byte{}
	} else {
		outJson["firedEvents"] = firedEvents
	}

	killEvents, err := h.query.GetKillEvents(ctx, sqlgen.GetKillEventsParams{
		MissionID:  missionId,
		StartFrame: startFrame,
		EndFrame:   endFrame,
		OcapID:     int32(ocapId),
	})
	if err != nil {
		fmt.Println(err)
		return echo.ErrInternalServerError
	}
	if !killEvents[0].ID.Valid {
		outJson["killEvents"] = [][]byte{}
	} else {
		outJson["killEvents"] = killEvents
	}

	hitEvents, err := h.query.GetHitEvents(ctx, sqlgen.GetHitEventsParams{
		MissionID:  missionId,
		StartFrame: startFrame,
		EndFrame:   endFrame,
		OcapID:     int32(ocapId),
	})
	if err != nil {
		fmt.Println(err)
		return echo.ErrInternalServerError
	}
	if !hitEvents[0].ID.Valid {
		outJson["hitEvents"] = [][]byte{}
	} else {
		outJson["hitEvents"] = hitEvents
	}

	chatEvents, err := h.query.GetChatEvents(ctx, sqlgen.GetChatEventsParams{
		MissionID:  missionId,
		StartFrame: startFrame,
		EndFrame:   endFrame,
		OcapID:     int32(ocapId),
	})
	if err != nil {
		fmt.Println(err)
		return echo.ErrInternalServerError
	}
	if !chatEvents[0].ID.Valid {
		outJson["chatEvents"] = [][]byte{}
	} else {
		outJson["chatEvents"] = chatEvents
	}

	radioEvents, err := h.query.GetRadioEvents(ctx, sqlgen.GetRadioEventsParams{
		MissionID:  missionId,
		StartFrame: startFrame,
		EndFrame:   endFrame,
		OcapID:     int32(ocapId),
	})
	if err != nil {
		fmt.Println(err)
		return echo.ErrInternalServerError
	}
	if !radioEvents[0].ID.Valid {
		outJson["radioEvents"] = [][]byte{}
	} else {
		outJson["radioEvents"] = radioEvents
	}

	return c.JSON(http.StatusOK, outJson)
}

func (h *Handler) GetVehicleDetailsByOcapId(c echo.Context) (err error) {
	var (
		ctx = c.Request().Context()
		r   = c.Request()
	)

	missionId, err := h.getMissionIdQuery(c.Param("id"))
	if err != nil {
		return echo.ErrBadRequest
	}

	ocapId, err := strconv.Atoi(c.Param("ocapid"))
	if err != nil {
		return echo.ErrBadRequest
	}

	params := sqlgen.GetVehicleByOcapIdParams{
		MissionID: missionId,
		OcapID:    int32(ocapId),
	}

	// look for startFrame and endFrame query params
	startFrame, endFrame, err := h.getFrameQuery(
		r.URL.Query().Get("startFrame"),
		r.URL.Query().Get("endFrame"),
	)
	if err != nil {
		fmt.Println(err)
		return echo.ErrBadRequest
	}

	outJson := map[string]interface{}{}

	vehicle, err := h.query.GetVehicleByOcapId(ctx, params)
	if err != nil && err != pgx.ErrNoRows {
		fmt.Println(err)
		return echo.ErrInternalServerError
	}
	if err == pgx.ErrNoRows || !(vehicle.ID > 0) {
		return echo.ErrNotFound
	}
	outJson["vehicle"] = vehicle

	states, err := h.query.GetVehicleStates(ctx, sqlgen.GetVehicleStatesParams{
		MissionID:  missionId,
		StartFrame: startFrame,
		EndFrame:   endFrame,
		OcapID:     int32(ocapId),
	})
	if err != nil {
		fmt.Println(err)
		return echo.ErrInternalServerError
	}
	if err == pgx.ErrNoRows {
		return echo.ErrNotFound
	} else {
		outJson["states"] = states
	}

	return c.JSON(http.StatusOK, outJson)
}

func (h *Handler) GetOtherChatEvents(c echo.Context) error {
	var (
		ctx = c.Request().Context()
	)

	missionId, err := h.getMissionIdQuery(c.Param("id"))
	if err != nil {
		return echo.ErrBadRequest
	}

	chatEvents, err := h.query.GetOtherChatEvents(ctx, sqlgen.GetOtherChatEventsParams{
		MissionID: missionId,
	})
	if err != nil {
		fmt.Println(err)
		return echo.ErrInternalServerError
	}
	if len(chatEvents) == 0 {
		return echo.ErrNotFound
	}

	return c.JSON(http.StatusOK, chatEvents)
}

func (h *Handler) GetServerFpsEvents(c echo.Context) error {
	var (
		ctx = c.Request().Context()
	)

	missionId, err := h.getMissionIdQuery(c.Param("id"))
	if err != nil {
		return echo.ErrBadRequest
	}

	fpsEvents, err := h.query.GetServerFpsEvents(ctx, missionId)

	if err != nil {
		fmt.Println(err)
		return echo.ErrInternalServerError
	}
	if len(fpsEvents) == 0 {
		return echo.ErrNotFound
	}

	return c.JSON(http.StatusOK, fpsEvents)
}
