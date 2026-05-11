package server

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/go-fuego/fuego"
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

	// In steamAllowlist mode, check if the user is allowed (admins always bypass)
	if h.setting.Auth.Mode == "steamAllowlist" && role != "admin" {
		allowed, err := h.repoOperation.IsOnAllowlist(r.Context(), steamID)
		if err != nil {
			log.Printf("WARN: allowlist check failed for %s: %v", steamID, err)
			h.authRedirect(w, r, "auth_error=steam_error")
			return
		}
		if !allowed {
			h.authRedirect(w, r, "auth_error=not_allowed")
			return
		}
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

// PasswordLogin validates a shared password and issues a viewer JWT.
func (h *Handler) PasswordLogin(w http.ResponseWriter, r *http.Request) {
	if h.setting.Auth.Mode != "password" {
		http.Error(w, "password login not enabled", http.StatusNotFound)
		return
	}

	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	if req.Password == "" || subtle.ConstantTimeCompare([]byte(req.Password), []byte(h.setting.Auth.Password)) != 1 {
		http.Error(w, "invalid password", http.StatusUnauthorized)
		return
	}

	token, err := h.jwt.Create("password", WithRole("viewer"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"token": token})
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

// AuthConfigResponse describes the authentication configuration returned by GetAuthConfig.
type AuthConfigResponse struct {
	Mode string `json:"mode"`
}

// GetAuthConfig returns the current authentication mode so the frontend
// can show the appropriate login controls.
func (h *Handler) GetAuthConfig(c ContextNoBody) (AuthConfigResponse, error) {
	return AuthConfigResponse{Mode: h.setting.Auth.Mode}, nil
}

// AdminAuthConfigResponse exposes read-only auth configuration to admins
// for display in the admin UI. Sensitive values (password, raw API key)
// are not included — only their presence.
type AdminAuthConfigResponse struct {
	Mode                 string   `json:"mode"`
	AdminSteamIDs        []string `json:"adminSteamIds"`
	SteamAPIKeyConfigured bool    `json:"steamApiKeyConfigured"`
	SessionTTL           string   `json:"sessionTtl"`
}

// GetAdminAuthConfig returns the read-only auth configuration for the
// admin UI. Requires admin role.
func (h *Handler) GetAdminAuthConfig(c ContextNoBody) (AdminAuthConfigResponse, error) {
	ids := h.setting.Auth.AdminSteamIDs
	if ids == nil {
		ids = []string{}
	}
	return AdminAuthConfigResponse{
		Mode:                  h.setting.Auth.Mode,
		AdminSteamIDs:         ids,
		SteamAPIKeyConfigured: h.setting.Auth.SteamAPIKey != "",
		SessionTTL:            h.setting.Auth.SessionTTL.String(),
	}, nil
}

// Logout is a no-op for stateless JWT — the frontend discards the token.
func (h *Handler) Logout(c ContextNoBody) (any, error) {
	c.SetStatus(http.StatusNoContent)
	return nil, nil
}

// requireViewer is middleware that enforces site-wide access control.
// In "public" mode it passes all requests through. In all other modes
// it requires a valid JWT with any role (viewer or admin).
func (h *Handler) requireViewer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if h.setting.Auth.Mode == "public" {
			next.ServeHTTP(w, r)
			return
		}
		token := bearerToken(r)
		if token == "" || h.jwt.Validate(token) != nil {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// requireAdmin is middleware that checks for a valid JWT Bearer token with admin role.
func (h *Handler) requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := bearerToken(r)
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

// AllowlistResponse contains the Steam IDs on the allowlist.
type AllowlistResponse struct {
	SteamIDs []string `json:"steamIds"`
}

// GetAllowlist returns all Steam IDs on the allowlist.
func (h *Handler) GetAllowlist(c ContextNoBody) (AllowlistResponse, error) {
	ids, err := h.repoOperation.GetAllowlist(c.Context())
	if err != nil {
		return AllowlistResponse{}, err
	}
	return AllowlistResponse{SteamIDs: ids}, nil
}

// AddToAllowlist adds a Steam ID to the allowlist.
func (h *Handler) AddToAllowlist(c ContextNoBody) (any, error) {
	steamID := c.PathParam("steamId")
	if steamID == "" {
		return nil, fuego.BadRequestError{Detail: "steamId is required"}
	}
	if err := h.repoOperation.AddToAllowlist(c.Context(), steamID); err != nil {
		return nil, err
	}
	c.SetStatus(http.StatusNoContent)
	return nil, nil
}

// RemoveFromAllowlist removes a Steam ID from the allowlist.
func (h *Handler) RemoveFromAllowlist(c ContextNoBody) (any, error) {
	steamID := c.PathParam("steamId")
	if steamID == "" {
		return nil, fuego.BadRequestError{Detail: "steamId is required"}
	}
	if err := h.repoOperation.RemoveFromAllowlist(c.Context(), steamID); err != nil {
		return nil, err
	}
	c.SetStatus(http.StatusNoContent)
	return nil, nil
}
