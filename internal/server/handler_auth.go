package server

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"net/url"
	"slices"
	"strings"

	"github.com/labstack/echo/v4"
	"github.com/yohcop/openid-go"
)

const (
	steamOpenIDURL = "https://steamcommunity.com/openid"
	nonceCookie    = "ocap_auth_nonce"
	tokenCookie    = "ocap_auth_token"
)

// openIDVerifier abstracts OpenID verification for testing.
type openIDVerifier interface {
	Verify(discoveryURL string, cache openid.DiscoveryCache, nonceStore openid.NonceStore) (string, error)
}

// defaultOpenIDVerifier uses the real openid-go library.
type defaultOpenIDVerifier struct{}

func (defaultOpenIDVerifier) Verify(discoveryURL string, cache openid.DiscoveryCache, nonceStore openid.NonceStore) (string, error) {
	return openid.Verify(discoveryURL, cache, nonceStore)
}

// bearerToken extracts the token from the Authorization: Bearer <token> header.
func bearerToken(c echo.Context) string {
	auth := c.Request().Header.Get("Authorization")
	if after, ok := strings.CutPrefix(auth, "Bearer "); ok {
		return after
	}
	return ""
}

// SteamLogin redirects the user to Steam's OpenID login page.
func (h *Handler) SteamLogin(c echo.Context) error {
	nonce, err := randomHex(16)
	if err != nil {
		return err
	}

	c.SetCookie(&http.Cookie{
		Name:     nonceCookie,
		Value:    nonce,
		MaxAge:   300,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Path:     "/",
	})

	prefix := strings.TrimRight(h.setting.PrefixURL, "/")
	callbackURL := requestScheme(c) + "://" + c.Request().Host + prefix + "/api/v1/auth/steam/callback?nonce=" + nonce
	realm := requestScheme(c) + "://" + c.Request().Host + prefix + "/"

	redirectURL, err := openid.RedirectURL(steamOpenIDURL, callbackURL, realm)
	if err != nil {
		return err
	}

	return c.Redirect(http.StatusTemporaryRedirect, redirectURL)
}

// SteamCallback handles the return from Steam OpenID, verifies the response,
// checks the allowlist, issues a JWT, and redirects to the frontend.
func (h *Handler) SteamCallback(c echo.Context) error {
	// Verify nonce for CSRF protection
	cookie, err := c.Cookie(nonceCookie)
	if err != nil || cookie.Value == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "missing auth nonce")
	}
	if c.QueryParam("nonce") != cookie.Value {
		return echo.NewHTTPError(http.StatusBadRequest, "nonce mismatch")
	}

	// Clear nonce cookie
	c.SetCookie(&http.Cookie{
		Name:   nonceCookie,
		MaxAge: -1,
		Path:   "/",
	})

	// Verify OpenID response with Steam
	fullURL := requestScheme(c) + "://" + c.Request().Host + c.Request().RequestURI
	claimedID, err := h.openIDVerifier.Verify(fullURL, h.openIDCache, h.openIDNonceStore)
	if err != nil {
		return h.authRedirect(c, "steam_error")
	}

	// Extract Steam64 ID from claimed ID URL
	// Format: https://steamcommunity.com/openid/id/76561198012345678
	steamID := extractSteamID(claimedID)
	if steamID == "" {
		return h.authRedirect(c, "steam_error")
	}

	// Check allowlist
	if !isSteamIDAllowed(steamID, h.setting.Admin.AllowedSteamIDs) {
		return h.authRedirect(c, "steam_denied")
	}

	// Create JWT with Steam ID as subject
	token, err := h.jwt.Create(steamID)
	if err != nil {
		return err
	}

	// Set short-lived cookie for frontend to pick up
	c.SetCookie(&http.Cookie{
		Name:     tokenCookie,
		Value:    token,
		MaxAge:   30,
		HttpOnly: false, // JS needs to read this
		SameSite: http.SameSiteLaxMode,
		Path:     "/",
	})

	return h.authRedirect(c, "")
}

// authRedirect redirects to the frontend root, optionally with an error query parameter.
func (h *Handler) authRedirect(c echo.Context, authError string) error {
	prefix := strings.TrimRight(h.setting.PrefixURL, "/")
	if prefix == "" {
		prefix = "/"
	} else {
		prefix += "/"
	}
	if authError != "" {
		prefix += "?auth_error=" + url.QueryEscape(authError)
	}
	return c.Redirect(http.StatusTemporaryRedirect, prefix)
}

// GetMe returns the current authentication status.
func (h *Handler) GetMe(c echo.Context) error {
	token := bearerToken(c)
	if token == "" || h.jwt.Validate(token) != nil {
		return c.JSON(http.StatusOK, map[string]any{"authenticated": false})
	}
	resp := map[string]any{"authenticated": true}
	if sub := h.jwt.Subject(token); sub != "" {
		resp["steamId"] = sub
	}
	return c.JSON(http.StatusOK, resp)
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

// extractSteamID extracts the Steam64 ID from a claimed OpenID URL.
func extractSteamID(claimedID string) string {
	const prefix = "https://steamcommunity.com/openid/id/"
	if after, ok := strings.CutPrefix(claimedID, prefix); ok && after != "" {
		return after
	}
	return ""
}

// isSteamIDAllowed checks if a Steam ID is in the allowlist.
func isSteamIDAllowed(steamID string, allowed []string) bool {
	return slices.Contains(allowed, steamID)
}

// requestScheme returns "https" or "http" based on the request.
func requestScheme(c echo.Context) string {
	if c.Scheme() == "https" {
		return "https"
	}
	// Check common reverse proxy headers
	if c.Request().Header.Get("X-Forwarded-Proto") == "https" {
		return "https"
	}
	return "http"
}

func randomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
