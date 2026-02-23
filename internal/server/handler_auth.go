package server

import (
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
)

const sessionCookieName = "ocap_session"

type loginRequest struct {
	Secret string `json:"secret"`
}

// Login validates the server secret and creates a session cookie.
func (h *Handler) Login(c echo.Context) error {
	var req loginRequest
	if err := c.Bind(&req); err != nil {
		return echo.ErrBadRequest
	}

	if req.Secret != h.setting.Secret {
		return echo.ErrForbidden
	}

	token := h.sessions.Create()
	c.SetCookie(&http.Cookie{
		Name:     sessionCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(h.setting.Admin.SessionTTL.Seconds()),
	})

	return c.JSON(http.StatusOK, map[string]bool{"authenticated": true})
}

// GetMe returns the current authentication status.
func (h *Handler) GetMe(c echo.Context) error {
	cookie, err := c.Cookie(sessionCookieName)
	if err != nil || !h.sessions.Valid(cookie.Value) {
		return c.JSON(http.StatusOK, map[string]bool{"authenticated": false})
	}
	return c.JSON(http.StatusOK, map[string]bool{"authenticated": true})
}

// Logout destroys the session and clears the cookie.
func (h *Handler) Logout(c echo.Context) error {
	cookie, err := c.Cookie(sessionCookieName)
	if err == nil {
		h.sessions.Destroy(cookie.Value)
	}
	c.SetCookie(&http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		MaxAge:   -1,
		Expires:  time.Unix(0, 0),
	})
	return c.NoContent(http.StatusNoContent)
}

// requireAdmin is middleware that checks for a valid session cookie.
func (h *Handler) requireAdmin(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		cookie, err := c.Cookie(sessionCookieName)
		if err != nil || !h.sessions.Valid(cookie.Value) {
			return echo.ErrUnauthorized
		}
		return next(c)
	}
}
