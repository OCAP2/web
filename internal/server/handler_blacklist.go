package server

import (
	"fmt"
	"net/http"
	"strconv"

	"github.com/go-fuego/fuego"
)

// GetMarkerBlacklist returns the blacklisted player entity IDs for a recording.
func (h *Handler) GetMarkerBlacklist(c ContextNoBody) ([]int, error) {
	id, err := strconv.ParseInt(c.PathParam("id"), 10, 64)
	if err != nil {
		return nil, fuego.BadRequestError{Err: err, Detail: err.Error()}
	}

	ids, err := h.repoOperation.GetBlacklist(c.Context(), id)
	if err != nil {
		return nil, err
	}

	return ids, nil
}

// AddMarkerBlacklist adds a player entity ID to the marker blacklist.
func (h *Handler) AddMarkerBlacklist(c ContextNoBody) (any, error) {
	id, playerID, err := parseBlacklistIDs(c)
	if err != nil {
		return nil, err
	}

	if err := h.repoOperation.AddBlacklist(c.Context(), id, playerID); err != nil {
		return nil, err
	}

	c.SetStatus(http.StatusNoContent)
	return nil, nil
}

// RemoveMarkerBlacklist removes a player entity ID from the marker blacklist.
func (h *Handler) RemoveMarkerBlacklist(c ContextNoBody) (any, error) {
	id, playerID, err := parseBlacklistIDs(c)
	if err != nil {
		return nil, err
	}

	if err := h.repoOperation.RemoveBlacklist(c.Context(), id, playerID); err != nil {
		return nil, err
	}

	c.SetStatus(http.StatusNoContent)
	return nil, nil
}

func parseBlacklistIDs(c ContextNoBody) (int64, int, error) {
	id, err := strconv.ParseInt(c.PathParam("id"), 10, 64)
	if err != nil {
		return 0, 0, fuego.BadRequestError{Err: err, Detail: fmt.Sprintf("invalid id: %v", err)}
	}

	playerID, err := strconv.Atoi(c.PathParam("playerId"))
	if err != nil {
		return 0, 0, fuego.BadRequestError{Err: err, Detail: fmt.Sprintf("invalid playerId: %v", err)}
	}

	return id, playerID, nil
}
