package server

import (
	"net/http"
	"strconv"

	"github.com/labstack/echo/v4"
)

// GetMarkerBlacklist returns the blacklisted player entity IDs for a recording.
func (h *Handler) GetMarkerBlacklist(c echo.Context) error {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return echo.ErrBadRequest
	}

	ids, err := h.repoOperation.GetBlacklist(c.Request().Context(), id)
	if err != nil {
		return err
	}

	return c.JSON(http.StatusOK, ids)
}

// AddMarkerBlacklist adds a player entity ID to the marker blacklist.
func (h *Handler) AddMarkerBlacklist(c echo.Context) error {
	id, playerID, err := parseBlacklistIDs(c)
	if err != nil {
		return err
	}

	if err := h.repoOperation.AddBlacklist(c.Request().Context(), id, playerID); err != nil {
		return err
	}

	return c.NoContent(http.StatusNoContent)
}

// RemoveMarkerBlacklist removes a player entity ID from the marker blacklist.
func (h *Handler) RemoveMarkerBlacklist(c echo.Context) error {
	id, playerID, err := parseBlacklistIDs(c)
	if err != nil {
		return err
	}

	if err := h.repoOperation.RemoveBlacklist(c.Request().Context(), id, playerID); err != nil {
		return err
	}

	return c.NoContent(http.StatusNoContent)
}

func parseBlacklistIDs(c echo.Context) (int64, int, error) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		return 0, 0, echo.ErrBadRequest
	}

	playerID, err := strconv.Atoi(c.Param("playerId"))
	if err != nil {
		return 0, 0, echo.ErrBadRequest
	}

	return id, playerID, nil
}
