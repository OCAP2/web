package server

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/yohcop/openid-go"
)

const (
	steamOpenIDURL = "https://steamcommunity.com/openid"
	cookieNonce    = "ocap_auth_nonce"
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
		Name:     cookieNonce,
		Value:    nonce,
		MaxAge:   300,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Path:     "/",
	})

	prefix := strings.TrimRight(h.setting.PrefixURL, "/")
	host := requestHost(c)
	callbackURL := requestScheme(c) + "://" + host + prefix + "/api/v1/auth/steam/callback?nonce=" + nonce
	realm := requestScheme(c) + "://" + host + prefix + "/"

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
	cookie, err := c.Cookie(cookieNonce)
	if err != nil || cookie.Value == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "missing auth nonce")
	}
	if c.QueryParam("nonce") != cookie.Value {
		return echo.NewHTTPError(http.StatusBadRequest, "nonce mismatch")
	}

	// Clear nonce cookie
	c.SetCookie(&http.Cookie{
		Name:   cookieNonce,
		MaxAge: -1,
		Path:   "/",
	})

	// Verify OpenID response with Steam — use forwarded host so the URL
	// matches the return_to that was sent to Steam via the proxy.
	fullURL := requestScheme(c) + "://" + requestHost(c) + c.Request().RequestURI
	claimedID, err := h.openIDVerifier.Verify(fullURL, h.openIDCache, h.openIDNonceStore)
	if err != nil {
		return h.authRedirect(c, "auth_error=steam_error")
	}

	// Extract Steam64 ID from claimed ID URL
	// Format: https://steamcommunity.com/openid/id/76561198012345678
	steamID := extractSteamID(claimedID)
	if steamID == "" {
		return h.authRedirect(c, "auth_error=steam_error")
	}

	// Check allowlist
	if !isSteamIDAllowed(steamID, h.setting.Admin.AllowedSteamIDs) {
		return h.authRedirect(c, "auth_error=steam_denied")
	}

	// Fetch Steam profile data if API key is configured
	var claimOpts []ClaimOption
	if h.setting.Admin.SteamAPIKey != "" {
		baseURL := steamAPIBaseURL
		if h.steamAPIBaseURL != "" {
			baseURL = h.steamAPIBaseURL
		}
		if name, avatar, err := fetchSteamProfileFrom(baseURL, steamID, h.setting.Admin.SteamAPIKey); err == nil {
			claimOpts = append(claimOpts, WithSteamProfile(name, avatar))
		} else {
			log.Printf("WARN: failed to fetch Steam profile for %s: %v", steamID, err)
		}
	}

	// Create JWT with Steam ID as subject and optional profile data
	token, err := h.jwt.Create(steamID, claimOpts...)
	if err != nil {
		return err
	}

	return h.authRedirect(c, "auth_token="+token)
}

// authRedirect redirects to the frontend root, optionally appending a raw query string.
func (h *Handler) authRedirect(c echo.Context, query string) error {
	prefix := strings.TrimRight(h.setting.PrefixURL, "/")
	if prefix == "" {
		prefix = "/"
	} else {
		prefix += "/"
	}
	if query != "" {
		prefix += "?" + query
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
	if claims := h.jwt.Claims(token); claims != nil {
		if claims.Subject != "" {
			resp["steamId"] = claims.Subject
		}
		if claims.SteamName != "" {
			resp["steamName"] = claims.SteamName
		}
		if claims.SteamAvatar != "" {
			resp["steamAvatar"] = claims.SteamAvatar
		}
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

// requestHost returns the original client-facing host, respecting X-Forwarded-Host
// from reverse proxies (including Vite dev proxy).
func requestHost(c echo.Context) string {
	if fh := c.Request().Header.Get("X-Forwarded-Host"); fh != "" {
		return fh
	}
	return c.Request().Host
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

// steamProfileResponse models the Steam Web API GetPlayerSummaries response.
type steamProfileResponse struct {
	Response struct {
		Players []struct {
			PersonaName string `json:"personaname"`
			AvatarURL   string `json:"avatarmedium"`
		} `json:"players"`
	} `json:"response"`
}

const steamAPIBaseURL = "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/"

// fetchSteamProfileFrom calls the Steam Web API to get the player's display name and avatar.
func fetchSteamProfileFrom(baseURL, steamID, apiKey string) (name, avatar string, err error) {
	u := baseURL + "?key=" + url.QueryEscape(apiKey) + "&steamids=" + url.QueryEscape(steamID)

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(u)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", "", echo.NewHTTPError(resp.StatusCode, "Steam API error")
	}

	var data steamProfileResponse
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return "", "", err
	}

	if len(data.Response.Players) == 0 {
		return "", "", echo.NewHTTPError(http.StatusNotFound, "Steam profile not found")
	}

	p := data.Response.Players[0]
	return p.PersonaName, p.AvatarURL, nil
}

func randomHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
