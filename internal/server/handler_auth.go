package server

import (
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"
)

type loginRequest struct {
	Secret string `json:"secret"`
}

// bearerToken extracts the token from the Authorization: Bearer <token> header.
func bearerToken(c echo.Context) string {
	auth := c.Request().Header.Get("Authorization")
	if after, ok := strings.CutPrefix(auth, "Bearer "); ok {
		return after
	}
	return ""
}

// Login validates the server secret and returns a JWT token.
func (h *Handler) Login(c echo.Context) error {
	var req loginRequest
	if err := c.Bind(&req); err != nil {
		return echo.ErrBadRequest
	}

	if req.Secret != h.setting.Secret {
		return echo.ErrForbidden
	}

	token, err := h.jwt.Create()
	if err != nil {
		return err
	}

	return c.JSON(http.StatusOK, map[string]any{
		"authenticated": true,
		"token":         token,
	})
}

// GetMe returns the current authentication status.
func (h *Handler) GetMe(c echo.Context) error {
	token := bearerToken(c)
	if token == "" || h.jwt.Validate(token) != nil {
		return c.JSON(http.StatusOK, map[string]bool{"authenticated": false})
	}
	return c.JSON(http.StatusOK, map[string]bool{"authenticated": true})
}

// Logout is a no-op for stateless JWT — the frontend discards the token.
func (h *Handler) Logout(c echo.Context) error {
	return c.NoContent(http.StatusNoContent)
}

// requireAdmin is middleware that checks for a valid JWT Bearer token.
func (h *Handler) requireAdmin(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		token := bearerToken(c)
		if token == "" || h.jwt.Validate(token) != nil {
			return echo.ErrUnauthorized
		}
		return next(c)
	}
}
