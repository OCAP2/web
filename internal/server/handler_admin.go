package server

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"

	"github.com/go-fuego/fuego"
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
func decodeEditRequest(r *http.Request) (editOperationRequest, error) {
	var req editOperationRequest

	// Decode into a raw map to detect key presence
	var rawMap map[string]json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&rawMap); err != nil {
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
func (h *Handler) EditOperation(c ContextNoBody) (*Operation, error) {
	id, err := strconv.ParseInt(c.PathParam("id"), 10, 64)
	if err != nil {
		return nil, fuego.BadRequestError{Err: err}
	}

	req, err := decodeEditRequest(c.Request())
	if err != nil {
		return nil, fuego.BadRequestError{Err: err}
	}

	// Fetch current to fill in any fields not provided
	current, err := h.repoOperation.GetByID(c.Context(), c.PathParam("id"))
	if err != nil {
		return nil, fuego.NotFoundError{Err: err}
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
			return nil, fuego.BadRequestError{Err: fmt.Errorf("invalid focusStart")}
		}
		focusStart = val
	}
	if req.hasFocusEnd {
		val, ok := parseFocusField(req.FocusEnd)
		if !ok {
			return nil, fuego.BadRequestError{Err: fmt.Errorf("invalid focusEnd")}
		}
		focusEnd = val
	}

	// Validate focus range: both must be present or both absent, and start < end
	if (focusStart == nil) != (focusEnd == nil) {
		return nil, fuego.BadRequestError{Err: fmt.Errorf("focusStart and focusEnd must both be present or both absent")}
	}
	if focusStart != nil && focusEnd != nil && *focusStart >= *focusEnd {
		return nil, fuego.BadRequestError{Err: fmt.Errorf("focusStart must be less than focusEnd")}
	}

	if err := h.repoOperation.UpdateOperation(c.Context(), id, name, tag, date, focusStart, focusEnd); err != nil {
		return nil, err
	}

	current.MissionName = name
	current.Tag = tag
	current.Date = date
	current.FocusStart = focusStart
	current.FocusEnd = focusEnd

	return current, nil
}

// RetryResponse is the response for a retry conversion request.
type RetryResponse struct {
	Status string `json:"status"`
}

// RetryConversion resets a failed operation to pending and removes partial output.
func (h *Handler) RetryConversion(c ContextNoBody) (RetryResponse, error) {
	id, err := strconv.ParseInt(c.PathParam("id"), 10, 64)
	if err != nil {
		return RetryResponse{}, fuego.BadRequestError{Err: err}
	}

	ctx := c.Context()
	op, err := h.repoOperation.GetByID(ctx, c.PathParam("id"))
	if err != nil {
		return RetryResponse{}, fuego.NotFoundError{Err: err}
	}

	if op.ConversionStatus != ConversionStatusFailed {
		return RetryResponse{}, fuego.ConflictError{Err: fmt.Errorf("operation is not in failed state")}
	}

	// Remove partial protobuf output
	pbDir := filepath.Join(h.setting.Data, op.Filename)
	os.RemoveAll(pbDir)

	// Reset to pending so the conversion worker picks it up
	if err := h.repoOperation.UpdateConversionStatus(ctx, id, ConversionStatusPending); err != nil {
		return RetryResponse{}, err
	}

	// Trigger immediate conversion if available
	if h.conversionTrigger != nil {
		h.conversionTrigger.TriggerConversion(id, op.Filename)
	}

	return RetryResponse{Status: ConversionStatusPending}, nil
}

// DeleteOperation removes an operation from DB and cleans up data files.
func (h *Handler) DeleteOperation(c ContextNoBody) (any, error) {
	id, err := strconv.ParseInt(c.PathParam("id"), 10, 64)
	if err != nil {
		return nil, fuego.BadRequestError{Err: err}
	}

	ctx := c.Context()
	op, err := h.repoOperation.GetByID(ctx, c.PathParam("id"))
	if err != nil {
		return nil, fuego.NotFoundError{Err: err}
	}

	// Delete DB record first
	if err := h.repoOperation.Delete(ctx, id); err != nil {
		return nil, err
	}

	// Clean up files (best-effort, don't fail the request)
	jsonGzPath := filepath.Join(h.setting.Data, op.Filename+".json.gz")
	if err := os.Remove(jsonGzPath); err != nil && !os.IsNotExist(err) {
		slog.Warn("failed to remove file", "path", jsonGzPath, "error", err)
	}

	pbDir := filepath.Join(h.setting.Data, op.Filename)
	if err := os.RemoveAll(pbDir); err != nil {
		slog.Warn("failed to remove directory", "path", pbDir, "error", err)
	}

	c.SetStatus(http.StatusNoContent)
	return nil, nil
}
