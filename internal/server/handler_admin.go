package server

import (
	"encoding/json"
	"fmt"
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

	// Focus range fields use json.RawMessage to distinguish
	// "field absent" (don't change) from "field is null" (clear value).
	// Populated manually from raw JSON; not decoded by struct tags.
	FocusStart json.RawMessage `json:"-"`
	FocusEnd   json.RawMessage `json:"-"`

	hasFocusStart bool
	hasFocusEnd   bool
}

// parseFocusField parses a nullable int64 from a json.RawMessage that is known to be present.
// Returns nil for JSON null, or the parsed int64 value.
func parseFocusField(raw json.RawMessage) (*int64, bool) {
	if string(raw) == "null" {
		return nil, true // explicitly null — clear the value
	}
	var v int64
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, false
	}
	return &v, true
}

// decodeEditRequest decodes the JSON body into an editOperationRequest,
// tracking whether focusStart/focusEnd keys were present.
func decodeEditRequest(c echo.Context) (editOperationRequest, error) {
	var req editOperationRequest

	// Decode into a raw map to detect key presence
	var rawMap map[string]json.RawMessage
	if err := json.NewDecoder(c.Request().Body).Decode(&rawMap); err != nil {
		return req, err
	}

	// Decode standard string fields from the raw map
	if v, ok := rawMap["missionName"]; ok {
		if err := json.Unmarshal(v, &req.MissionName); err != nil {
			return req, fmt.Errorf("invalid missionName: %w", err)
		}
	}
	if v, ok := rawMap["tag"]; ok {
		if err := json.Unmarshal(v, &req.Tag); err != nil {
			return req, fmt.Errorf("invalid tag: %w", err)
		}
	}
	if v, ok := rawMap["date"]; ok {
		if err := json.Unmarshal(v, &req.Date); err != nil {
			return req, fmt.Errorf("invalid date: %w", err)
		}
	}

	// Track focus field presence (key exists in JSON, even if value is null)
	if v, ok := rawMap["focusStart"]; ok {
		req.FocusStart = v
		req.hasFocusStart = true
	}
	if v, ok := rawMap["focusEnd"]; ok {
		req.FocusEnd = v
		req.hasFocusEnd = true
	}

	return req, nil
}

// EditOperation updates the editable metadata of an operation.
func (h *Handler) EditOperation(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return echo.ErrBadRequest
	}

	req, err := decodeEditRequest(c)
	if err != nil {
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

	// Focus range: only update if the field was present in the JSON body
	focusStart := current.FocusStart
	focusEnd := current.FocusEnd
	if req.hasFocusStart {
		val, ok := parseFocusField(req.FocusStart)
		if !ok {
			return echo.ErrBadRequest
		}
		focusStart = val
	}
	if req.hasFocusEnd {
		val, ok := parseFocusField(req.FocusEnd)
		if !ok {
			return echo.ErrBadRequest
		}
		focusEnd = val
	}

	// Validate focus range: both must be present or both absent, and start < end
	if (focusStart == nil) != (focusEnd == nil) {
		return echo.ErrBadRequest
	}
	if focusStart != nil && focusEnd != nil && *focusStart >= *focusEnd {
		return echo.ErrBadRequest
	}

	if err := h.repoOperation.UpdateOperation(c.Request().Context(), id, name, tag, date, focusStart, focusEnd); err != nil {
		return err
	}

	current.MissionName = name
	current.Tag = tag
	current.Date = date
	current.FocusStart = focusStart
	current.FocusEnd = focusEnd

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
