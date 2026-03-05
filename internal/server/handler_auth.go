package server

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

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
func bearerToken(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if after, ok := strings.CutPrefix(auth, "Bearer "); ok {
		return after
	}
	return ""
}

// SteamLogin redirects the user to Steam's OpenID login page.
func (h *Handler) SteamLogin(w http.ResponseWriter, r *http.Request) {
	nonce, err := randomHex(16)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     cookieNonce,
		Value:    nonce,
		MaxAge:   300,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Path:     "/",
	})

	prefix := strings.TrimRight(h.setting.PrefixURL, "/")
	host := requestHost(r)
	callbackURL := requestScheme(r) + "://" + host + prefix + "/api/v1/auth/steam/callback?nonce=" + nonce
	realm := requestScheme(r) + "://" + host + prefix + "/"

	redirectURL, err := openid.RedirectURL(steamOpenIDURL, callbackURL, realm)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	http.Redirect(w, r, redirectURL, http.StatusTemporaryRedirect)
}

// SteamCallback handles the return from Steam OpenID, verifies the response,
// checks the allowlist, issues a JWT, and redirects to the frontend.
func (h *Handler) SteamCallback(w http.ResponseWriter, r *http.Request) {
	// Verify nonce for CSRF protection
	cookie, err := r.Cookie(cookieNonce)
	if err != nil || cookie.Value == "" {
		http.Error(w, "missing auth nonce", http.StatusBadRequest)
		return
	}
	if r.URL.Query().Get("nonce") != cookie.Value {
		http.Error(w, "nonce mismatch", http.StatusBadRequest)
		return
	}

	// Clear nonce cookie
	http.SetCookie(w, &http.Cookie{
		Name:   cookieNonce,
		MaxAge: -1,
		Path:   "/",
	})

	// Verify OpenID response with Steam — use forwarded host so the URL
	// matches the return_to that was sent to Steam via the proxy.
	fullURL := requestScheme(r) + "://" + requestHost(r) + r.RequestURI
	claimedID, err := h.openIDVerifier.Verify(fullURL, h.openIDCache, h.openIDNonceStore)
	if err != nil {
		h.authRedirect(w, r, "auth_error=steam_error")
		return
	}

	// Extract Steam64 ID from claimed ID URL
	// Format: https://steamcommunity.com/openid/id/76561198012345678
	steamID := extractSteamID(claimedID)
	if steamID == "" {
		h.authRedirect(w, r, "auth_error=steam_error")
		return
	}

	// Determine role based on admin allowlist
	role := "viewer"
	if slices.Contains(h.setting.Auth.AdminSteamIDs, steamID) {
		role = "admin"
	}

	// Fetch Steam profile data if API key is configured
	claimOpts := []ClaimOption{WithRole(role)}
	if h.setting.Auth.SteamAPIKey != "" {
		baseURL := steamAPIBaseURL
		if h.steamAPIBaseURL != "" {
			baseURL = h.steamAPIBaseURL
		}
		if name, avatar, err := fetchSteamProfileFrom(baseURL, steamID, h.setting.Auth.SteamAPIKey); err == nil {
			claimOpts = append(claimOpts, WithSteamProfile(name, avatar))
		} else {
			log.Printf("WARN: failed to fetch Steam profile for %s: %v", steamID, err)
		}
	}

	// Create JWT with Steam ID as subject and optional profile data
	token, err := h.jwt.Create(steamID, claimOpts...)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	h.authRedirect(w, r, "auth_token="+token)
}

// authRedirect redirects to the frontend root, optionally appending a raw query string.
func (h *Handler) authRedirect(w http.ResponseWriter, r *http.Request, query string) {
	prefix := strings.TrimRight(h.setting.PrefixURL, "/")
	if prefix == "" {
		prefix = "/"
	} else {
		prefix += "/"
	}
	if query != "" {
		prefix += "?" + query
	}
	http.Redirect(w, r, prefix, http.StatusTemporaryRedirect)
}

// MeResponse describes the authentication status returned by GetMe.
type MeResponse struct {
	Authenticated bool   `json:"authenticated"`
	Role          string `json:"role,omitempty"`
	SteamID       string `json:"steamId,omitempty"`
	SteamName     string `json:"steamName,omitempty"`
	SteamAvatar   string `json:"steamAvatar,omitempty"`
}

// GetMe returns the current authentication status.
func (h *Handler) GetMe(c ContextNoBody) (MeResponse, error) {
	token := bearerToken(c.Request())
	if token == "" || h.jwt.Validate(token) != nil {
		return MeResponse{Authenticated: false}, nil
	}
	resp := MeResponse{Authenticated: true}
	if claims := h.jwt.Claims(token); claims != nil {
		resp.Role = claims.Role
		resp.SteamID = claims.Subject
		resp.SteamName = claims.SteamName
		resp.SteamAvatar = claims.SteamAvatar
	}
	return resp, nil
}

// Logout is a no-op for stateless JWT — the frontend discards the token.
func (h *Handler) Logout(c ContextNoBody) (any, error) {
	c.SetStatus(http.StatusNoContent)
	return nil, nil
}

// requireAdmin is middleware that checks for a valid JWT Bearer token with admin role.
func (h *Handler) requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := bearerToken(r)
		if token == "" || h.jwt.Validate(token) != nil {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		claims := h.jwt.Claims(token)
		if claims == nil || claims.Role != "admin" {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// extractSteamID extracts the Steam64 ID from a claimed OpenID URL.
func extractSteamID(claimedID string) string {
	const prefix = "https://steamcommunity.com/openid/id/"
	if after, ok := strings.CutPrefix(claimedID, prefix); ok && after != "" {
		return after
	}
	return ""
}

// requestHost returns the original client-facing host, respecting X-Forwarded-Host
// from reverse proxies (including Vite dev proxy).
func requestHost(r *http.Request) string {
	if fh := r.Header.Get("X-Forwarded-Host"); fh != "" {
		return fh
	}
	return r.Host
}

// requestScheme returns "https" or "http" based on the request.
func requestScheme(r *http.Request) string {
	if r.TLS != nil {
		return "https"
	}
	// Check common reverse proxy headers
	if r.Header.Get("X-Forwarded-Proto") == "https" {
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
		return "", "", fmt.Errorf("steam API error: status %d", resp.StatusCode)
	}

	var data steamProfileResponse
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return "", "", err
	}

	if len(data.Response.Players) == 0 {
		return "", "", fmt.Errorf("steam profile not found")
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
