package server

import (
	"net/http"
	"os"
	"path/filepath"
	"strconv"

	"github.com/labstack/echo/v4"
)

type editOperationRequest struct {
	MissionName string `json:"missionName"`
	Tag         string `json:"tag"`
	Date        string `json:"date"`
}

// EditOperation updates the editable metadata of an operation.
func (h *Handler) EditOperation(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return echo.ErrBadRequest
	}

	var req editOperationRequest
	if err := c.Bind(&req); err != nil {
		return echo.ErrBadRequest
	}

	// Fetch current to fill in any fields not provided
	current, err := h.repoOperation.GetByID(c.Request().Context(), c.Param("id"))
	if err != nil {
		return echo.ErrNotFound
	}

	name := req.MissionName
	if name == "" {
		name = current.MissionName
	}
	tag := req.Tag
	date := req.Date
	if date == "" {
		date = current.Date
	}

	if err := h.repoOperation.UpdateOperation(c.Request().Context(), id, name, tag, date); err != nil {
		return err
	}

	current.MissionName = name
	current.Tag = tag
	current.Date = date

	return c.JSON(http.StatusOK, current)
}

// RetryConversion resets a failed operation to pending and removes partial output.
func (h *Handler) RetryConversion(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return echo.ErrBadRequest
	}

	ctx := c.Request().Context()
	op, err := h.repoOperation.GetByID(ctx, c.Param("id"))
	if err != nil {
		return echo.ErrNotFound
	}

	if op.ConversionStatus != ConversionStatusFailed {
		return echo.NewHTTPError(http.StatusConflict, "operation is not in failed state")
	}

	// Remove partial protobuf output
	pbDir := filepath.Join(h.setting.Data, op.Filename)
	os.RemoveAll(pbDir)

	// Reset to pending so the conversion worker picks it up
	if err := h.repoOperation.UpdateConversionStatus(ctx, id, ConversionStatusPending); err != nil {
		return err
	}

	// Trigger immediate conversion if available
	if h.conversionTrigger != nil {
		h.conversionTrigger.TriggerConversion(id, op.Filename)
	}

	return c.JSON(http.StatusOK, map[string]string{"status": ConversionStatusPending})
}

// DeleteOperation removes an operation from DB and cleans up data files.
func (h *Handler) DeleteOperation(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return echo.ErrBadRequest
	}

	ctx := c.Request().Context()
	op, err := h.repoOperation.GetByID(ctx, c.Param("id"))
	if err != nil {
		return echo.ErrNotFound
	}

	// Delete DB record first
	if err := h.repoOperation.Delete(ctx, id); err != nil {
		return err
	}

	// Clean up files (best-effort, don't fail the request)
	jsonGzPath := filepath.Join(h.setting.Data, op.Filename+".json.gz")
	if err := os.Remove(jsonGzPath); err != nil && !os.IsNotExist(err) {
		c.Logger().Warnf("failed to remove %s: %v", jsonGzPath, err)
	}

	pbDir := filepath.Join(h.setting.Data, op.Filename)
	if err := os.RemoveAll(pbDir); err != nil {
		c.Logger().Warnf("failed to remove %s: %v", pbDir, err)
	}

	return c.NoContent(http.StatusNoContent)
}
