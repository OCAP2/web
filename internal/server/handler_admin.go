package server

import (
	"net/http"
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

	updated, err := h.repoOperation.GetByID(c.Request().Context(), c.Param("id"))
	if err != nil {
		return err
	}

	return c.JSON(http.StatusOK, updated)
}
