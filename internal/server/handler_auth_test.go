package server

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/yohcop/openid-go"

	"github.com/go-fuego/fuego"
)

// mockVerifier implements openIDVerifier for testing.
type mockVerifier struct {
	claimedID string
	err       error
}

func (m mockVerifier) Verify(string, openid.DiscoveryCache, openid.NonceStore) (string, error) {
	return m.claimedID, m.err
}

func newSteamAuthHandler(adminIDs []string) Handler {
	return Handler{
		setting: Setting{
			Secret: "test-secret",
			Auth: Auth{
				SessionTTL:    time.Hour,
				AdminSteamIDs: adminIDs,
			},
		},
		jwt:              NewJWTManager("test-secret", time.Hour),
		openIDCache:      openid.NewSimpleDiscoveryCache(),
		openIDNonceStore: openid.NewSimpleNonceStore(),
		openIDVerifier:   mockVerifier{claimedID: "https://steamcommunity.com/openid/id/76561198012345678"},
	}
}

func TestSteamLogin_Redirects(t *testing.T) {
	hdlr := newSteamAuthHandler([]string{"76561198012345678"})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/steam", nil)
	rec := httptest.NewRecorder()

	hdlr.SteamLogin(rec, req)
	assert.Equal(t, http.StatusTemporaryRedirect, rec.Code)

	loc := rec.Header().Get("Location")
	assert.Contains(t, loc, "steamcommunity.com/openid")

	// Should set nonce cookie
	cookies := rec.Result().Cookies()
	var foundNonce bool
	for _, ck := range cookies {
		if ck.Name == cookieNonce {
			foundNonce = true
			assert.True(t, ck.HttpOnly)
			assert.NotEmpty(t, ck.Value)
		}
	}
	assert.True(t, foundNonce, "nonce cookie should be set")
}

func TestSteamCallback_MissingNonce(t *testing.T) {
	hdlr := newSteamAuthHandler([]string{"76561198012345678"})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/steam/callback?nonce=abc", nil)
	// No cookie set
	rec := httptest.NewRecorder()

	hdlr.SteamCallback(rec, req)
	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestSteamCallback_EmptyNonceCookie(t *testing.T) {
	hdlr := newSteamAuthHandler([]string{"76561198012345678"})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/steam/callback?nonce=abc", nil)
	req.AddCookie(&http.Cookie{Name: cookieNonce, Value: ""})
	rec := httptest.NewRecorder()

	hdlr.SteamCallback(rec, req)
	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "missing auth nonce")
}

func TestSteamCallback_NonceMismatch(t *testing.T) {
	hdlr := newSteamAuthHandler([]string{"76561198012345678"})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/steam/callback?nonce=abc", nil)
	req.AddCookie(&http.Cookie{Name: cookieNonce, Value: "xyz"})
	rec := httptest.NewRecorder()

	hdlr.SteamCallback(rec, req)
	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestSteamCallback_AdminGetsAdminRole(t *testing.T) {
	hdlr := newSteamAuthHandler([]string{"76561198012345678"})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/steam/callback?nonce=abc", nil)
	req.AddCookie(&http.Cookie{Name: cookieNonce, Value: "abc"})
	rec := httptest.NewRecorder()

	hdlr.SteamCallback(rec, req)
	assert.Equal(t, http.StatusTemporaryRedirect, rec.Code)

	loc := rec.Header().Get("Location")
	assert.Contains(t, loc, "auth_token=")

	u, err := url.Parse(loc)
	require.NoError(t, err)
	tokenValue := u.Query().Get("auth_token")

	claims := hdlr.jwt.Claims(tokenValue)
	require.NotNil(t, claims)
	assert.Equal(t, "76561198012345678", claims.Subject)
	assert.Equal(t, "admin", claims.Role)
}

func TestSteamCallback_NonAdminGetsViewerRole(t *testing.T) {
	hdlr := newSteamAuthHandler([]string{"76561198099999999"}) // different ID than the mock verifier
	hdlr.openIDVerifier = mockVerifier{claimedID: "https://steamcommunity.com/openid/id/76561198012345678"}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/steam/callback?nonce=abc", nil)
	req.AddCookie(&http.Cookie{Name: cookieNonce, Value: "abc"})
	rec := httptest.NewRecorder()

	hdlr.SteamCallback(rec, req)
	assert.Equal(t, http.StatusTemporaryRedirect, rec.Code)

	loc := rec.Header().Get("Location")
	assert.Contains(t, loc, "auth_token=")
	assert.NotContains(t, loc, "auth_error")

	u, err := url.Parse(loc)
	require.NoError(t, err)
	tokenValue := u.Query().Get("auth_token")

	claims := hdlr.jwt.Claims(tokenValue)
	require.NotNil(t, claims)
	assert.Equal(t, "76561198012345678", claims.Subject)
	assert.Equal(t, "viewer", claims.Role)
}

func TestGetMe_WithSteamID(t *testing.T) {
	hdlr := newSteamAuthHandler(nil)
	token, err := hdlr.jwt.Create("76561198012345678")
	require.NoError(t, err)

	ctx := fuego.NewMockContextNoBody()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	ctx.SetRequest(req)

	resp, err := hdlr.GetMe(ctx)
	require.NoError(t, err)
	assert.True(t, resp.Authenticated)
	assert.Equal(t, "76561198012345678", resp.SteamID)
}

func TestGetMe_WithSteamProfile(t *testing.T) {
	hdlr := newSteamAuthHandler(nil)
	token, err := hdlr.jwt.Create("76561198012345678", WithSteamProfile("TestPlayer", "https://avatars.steamstatic.com/test.jpg"))
	require.NoError(t, err)

	ctx := fuego.NewMockContextNoBody()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	ctx.SetRequest(req)

	resp, err := hdlr.GetMe(ctx)
	require.NoError(t, err)
	assert.True(t, resp.Authenticated)
	assert.Equal(t, "TestPlayer", resp.SteamName)
	assert.Equal(t, "https://avatars.steamstatic.com/test.jpg", resp.SteamAvatar)
}

func TestGetMe_NotAuthenticated(t *testing.T) {
	hdlr := newSteamAuthHandler(nil)

	ctx := fuego.NewMockContextNoBody()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	ctx.SetRequest(req)

	resp, err := hdlr.GetMe(ctx)
	require.NoError(t, err)
	assert.False(t, resp.Authenticated)
}

func TestLogout(t *testing.T) {
	hdlr := newSteamAuthHandler(nil)

	ctx := fuego.NewMockContextNoBody()

	_, err := hdlr.Logout(ctx)
	require.NoError(t, err)
}

func TestExtractSteamID(t *testing.T) {
	assert.Equal(t, "76561198012345678", extractSteamID("https://steamcommunity.com/openid/id/76561198012345678"))
	assert.Equal(t, "", extractSteamID("https://example.com/openid/id/76561198012345678"))
	assert.Equal(t, "", extractSteamID(""))
	assert.Equal(t, "", extractSteamID("https://steamcommunity.com/openid/id/"))
}

func TestGetMe_WithSteamID_NoProfile(t *testing.T) {
	hdlr := newSteamAuthHandler(nil)
	token, err := hdlr.jwt.Create("76561198012345678")
	require.NoError(t, err)

	ctx := fuego.NewMockContextNoBody()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	ctx.SetRequest(req)

	resp, err := hdlr.GetMe(ctx)
	require.NoError(t, err)
	assert.Equal(t, "76561198012345678", resp.SteamID)
	assert.Empty(t, resp.SteamName)
	assert.Empty(t, resp.SteamAvatar)
}

func TestFetchSteamProfile_Success(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "TESTKEY", r.URL.Query().Get("key"))
		assert.Equal(t, "76561198012345678", r.URL.Query().Get("steamids"))
		json.NewEncoder(w).Encode(steamProfileResponse{
			Response: struct {
				Players []struct {
					PersonaName string `json:"personaname"`
					AvatarURL   string `json:"avatarmedium"`
				} `json:"players"`
			}{
				Players: []struct {
					PersonaName string `json:"personaname"`
					AvatarURL   string `json:"avatarmedium"`
				}{
					{PersonaName: "TestPlayer", AvatarURL: "https://avatars.steamstatic.com/abc.jpg"},
				},
			},
		})
	}))
	defer srv.Close()

	name, avatar, err := fetchSteamProfileFrom(srv.URL, "76561198012345678", "TESTKEY")
	require.NoError(t, err)
	assert.Equal(t, "TestPlayer", name)
	assert.Equal(t, "https://avatars.steamstatic.com/abc.jpg", avatar)
}

func TestFetchSteamProfile_EmptyPlayers(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(w, `{"response":{"players":[]}}`)
	}))
	defer srv.Close()

	_, _, err := fetchSteamProfileFrom(srv.URL, "76561198012345678", "TESTKEY")
	assert.Error(t, err)
}

func TestFetchSteamProfile_HTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer srv.Close()

	_, _, err := fetchSteamProfileFrom(srv.URL, "76561198012345678", "BADKEY")
	assert.Error(t, err)
}

func TestFetchSteamProfile_InvalidJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(w, `not json`)
	}))
	defer srv.Close()

	_, _, err := fetchSteamProfileFrom(srv.URL, "76561198012345678", "TESTKEY")
	assert.Error(t, err)
}

func TestFetchSteamProfile_ConnectionError(t *testing.T) {
	_, _, err := fetchSteamProfileFrom("http://127.0.0.1:1/", "76561198012345678", "TESTKEY")
	assert.Error(t, err)
}

func TestRequestHost_WithForwardedHost(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-Forwarded-Host", "proxy.example.com")

	assert.Equal(t, "proxy.example.com", requestHost(req))
}

func TestRequestHost_WithoutForwardedHost(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "http://direct.example.com/", nil)

	assert.Equal(t, "direct.example.com", requestHost(req))
}

func TestRequestScheme_Default(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "http://example.com/", nil)

	assert.Equal(t, "http", requestScheme(req))
}

func TestRequestScheme_ForwardedProto(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "http://example.com/", nil)
	req.Header.Set("X-Forwarded-Proto", "https")

	assert.Equal(t, "https", requestScheme(req))
}

func TestAuthRedirect_WithPrefix(t *testing.T) {
	hdlr := newSteamAuthHandler(nil)
	hdlr.setting.PrefixURL = "/ocap/"

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()

	hdlr.authRedirect(rec, req, "")
	assert.Equal(t, http.StatusTemporaryRedirect, rec.Code)
	assert.Equal(t, "/ocap/", rec.Header().Get("Location"))
}

func TestAuthRedirect_WithPrefixAndError(t *testing.T) {
	hdlr := newSteamAuthHandler(nil)
	hdlr.setting.PrefixURL = "/ocap/"

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()

	hdlr.authRedirect(rec, req, "auth_error=steam_denied")
	assert.Equal(t, "/ocap/?auth_error=steam_denied", rec.Header().Get("Location"))
}

func TestSteamCallback_VerifyError(t *testing.T) {
	hdlr := newSteamAuthHandler([]string{"76561198012345678"})
	hdlr.openIDVerifier = mockVerifier{err: fmt.Errorf("verify failed")}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/steam/callback?nonce=abc", nil)
	req.AddCookie(&http.Cookie{Name: cookieNonce, Value: "abc"})
	rec := httptest.NewRecorder()

	hdlr.SteamCallback(rec, req)
	assert.Equal(t, http.StatusTemporaryRedirect, rec.Code)
	assert.Contains(t, rec.Header().Get("Location"), "auth_error=steam_error")
}

func TestSteamCallback_InvalidClaimedID(t *testing.T) {
	hdlr := newSteamAuthHandler([]string{"76561198012345678"})
	hdlr.openIDVerifier = mockVerifier{claimedID: "https://example.com/not-steam"}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/steam/callback?nonce=abc", nil)
	req.AddCookie(&http.Cookie{Name: cookieNonce, Value: "abc"})
	rec := httptest.NewRecorder()

	hdlr.SteamCallback(rec, req)
	assert.Equal(t, http.StatusTemporaryRedirect, rec.Code)
	assert.Contains(t, rec.Header().Get("Location"), "auth_error=steam_error")
}

func TestRequestScheme_HTTPS(t *testing.T) {
	// httptest.NewRequest with https:// URL sets TLS field on the request
	req := httptest.NewRequest(http.MethodGet, "https://example.com/", nil)

	assert.Equal(t, "https", requestScheme(req))
}

func TestSteamLogin_WithXForwardedProto(t *testing.T) {
	hdlr := newSteamAuthHandler([]string{"76561198012345678"})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/steam", nil)
	req.Header.Set("X-Forwarded-Proto", "https")
	req.Host = "proxy.example.com"
	rec := httptest.NewRecorder()

	hdlr.SteamLogin(rec, req)
	assert.Equal(t, http.StatusTemporaryRedirect, rec.Code)

	loc := rec.Header().Get("Location")
	assert.Contains(t, loc, "steamcommunity.com/openid")

	// The redirect URL sent to Steam should use https scheme
	u, err := url.Parse(loc)
	require.NoError(t, err)
	returnTo := u.Query().Get("openid.return_to")
	assert.True(t, strings.HasPrefix(returnTo, "https://"), "return_to should use https, got: %s", returnTo)
}

func TestRandomHex(t *testing.T) {
	result, err := randomHex(16)
	require.NoError(t, err)
	assert.Len(t, result, 32) // 16 bytes = 32 hex chars

	// Verify it's valid hex
	_, err = hex.DecodeString(result)
	require.NoError(t, err)

	// Two calls should return different values
	result2, err := randomHex(16)
	require.NoError(t, err)
	assert.NotEqual(t, result, result2)
}

func TestSteamCallback_EmptyAdminList_GetsViewerRole(t *testing.T) {
	hdlr := newSteamAuthHandler([]string{}) // empty admin list

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/steam/callback?nonce=abc", nil)
	req.AddCookie(&http.Cookie{Name: cookieNonce, Value: "abc"})
	rec := httptest.NewRecorder()

	hdlr.SteamCallback(rec, req)
	assert.Equal(t, http.StatusTemporaryRedirect, rec.Code)

	loc := rec.Header().Get("Location")
	assert.Contains(t, loc, "auth_token=")

	u, err := url.Parse(loc)
	require.NoError(t, err)
	tokenValue := u.Query().Get("auth_token")

	claims := hdlr.jwt.Claims(tokenValue)
	require.NotNil(t, claims)
	assert.Equal(t, "viewer", claims.Role)
}

func TestSteamCallback_SteamAPIError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	hdlr := newSteamAuthHandler([]string{"76561198012345678"})
	hdlr.setting.Auth.SteamAPIKey = "TESTKEY"
	hdlr.steamAPIBaseURL = srv.URL

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/steam/callback?nonce=abc", nil)
	req.AddCookie(&http.Cookie{Name: cookieNonce, Value: "abc"})
	rec := httptest.NewRecorder()

	hdlr.SteamCallback(rec, req)
	assert.Equal(t, http.StatusTemporaryRedirect, rec.Code)

	// Should still get auth_token (just no profile data)
	loc := rec.Header().Get("Location")
	assert.Contains(t, loc, "auth_token=")

	u, err := url.Parse(loc)
	require.NoError(t, err)
	tokenValue := u.Query().Get("auth_token")
	claims := hdlr.jwt.Claims(tokenValue)
	require.NotNil(t, claims)
	assert.Equal(t, "admin", claims.Role)
}

func TestSteamCallback_WithSteamAPIKey(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		json.NewEncoder(w).Encode(steamProfileResponse{
			Response: struct {
				Players []struct {
					PersonaName string `json:"personaname"`
					AvatarURL   string `json:"avatarmedium"`
				} `json:"players"`
			}{
				Players: []struct {
					PersonaName string `json:"personaname"`
					AvatarURL   string `json:"avatarmedium"`
				}{
					{PersonaName: "TestPlayer", AvatarURL: "https://avatars.steamstatic.com/abc.jpg"},
				},
			},
		})
	}))
	defer srv.Close()

	hdlr := newSteamAuthHandler([]string{"76561198012345678"})
	hdlr.setting.Auth.SteamAPIKey = "TESTKEY"
	hdlr.steamAPIBaseURL = srv.URL

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/steam/callback?nonce=abc", nil)
	req.AddCookie(&http.Cookie{Name: cookieNonce, Value: "abc"})
	rec := httptest.NewRecorder()

	hdlr.SteamCallback(rec, req)
	assert.Equal(t, http.StatusTemporaryRedirect, rec.Code)

	// Extract token from redirect URL and verify profile claims
	loc := rec.Header().Get("Location")
	u, err := url.Parse(loc)
	require.NoError(t, err)
	tokenValue := u.Query().Get("auth_token")
	require.NotEmpty(t, tokenValue)

	claims := hdlr.jwt.Claims(tokenValue)
	require.NotNil(t, claims)
	assert.Equal(t, "76561198012345678", claims.Subject)
	assert.Equal(t, "admin", claims.Role)
	assert.Equal(t, "TestPlayer", claims.SteamName)
	assert.Equal(t, "https://avatars.steamstatic.com/abc.jpg", claims.SteamAvatar)
}

func TestRequireAdmin_RejectsViewerRole(t *testing.T) {
	hdlr := newSteamAuthHandler(nil)
	token, err := hdlr.jwt.Create("76561198012345678", WithRole("viewer"))
	require.NoError(t, err)

	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true })

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()

	hdlr.requireAdmin(next).ServeHTTP(rec, req)
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.False(t, called)
}

func TestRequireAdmin_AllowsAdminRole(t *testing.T) {
	hdlr := newSteamAuthHandler(nil)
	token, err := hdlr.jwt.Create("76561198012345678", WithRole("admin"))
	require.NoError(t, err)

	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true })

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()

	hdlr.requireAdmin(next).ServeHTTP(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.True(t, called)
}

func TestRequireViewer_PublicMode_AllowsUnauthenticated(t *testing.T) {
	hdlr := newSteamAuthHandler(nil)
	hdlr.setting.Auth.Mode = "public"

	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true })

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()

	hdlr.requireViewer(next).ServeHTTP(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.True(t, called)
}

func TestRequireViewer_NonPublic_RejectsUnauthenticated(t *testing.T) {
	hdlr := newSteamAuthHandler(nil)
	hdlr.setting.Auth.Mode = "steam"

	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true })

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()

	hdlr.requireViewer(next).ServeHTTP(rec, req)
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.False(t, called)
}

func TestRequireViewer_NonPublic_AllowsViewerRole(t *testing.T) {
	hdlr := newSteamAuthHandler(nil)
	hdlr.setting.Auth.Mode = "steam"
	token, err := hdlr.jwt.Create("76561198012345678", WithRole("viewer"))
	require.NoError(t, err)

	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true })

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()

	hdlr.requireViewer(next).ServeHTTP(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.True(t, called)
}

func TestRequireViewer_NonPublic_AllowsAdminRole(t *testing.T) {
	hdlr := newSteamAuthHandler(nil)
	hdlr.setting.Auth.Mode = "steam"
	token, err := hdlr.jwt.Create("76561198012345678", WithRole("admin"))
	require.NoError(t, err)

	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true })

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()

	hdlr.requireViewer(next).ServeHTTP(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.True(t, called)
}

func TestGetMe_ReturnsRole(t *testing.T) {
	hdlr := newSteamAuthHandler(nil)
	token, err := hdlr.jwt.Create("76561198012345678", WithRole("viewer"))
	require.NoError(t, err)

	ctx := fuego.NewMockContextNoBody()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	ctx.SetRequest(req)

	resp, err := hdlr.GetMe(ctx)
	require.NoError(t, err)
	assert.True(t, resp.Authenticated)
	assert.Equal(t, "viewer", resp.Role)
}

func newPasswordAuthHandler(password string) Handler {
	return Handler{
		setting: Setting{
			Secret: "test-secret",
			Auth: Auth{
				Mode:       "password",
				SessionTTL: time.Hour,
				Password:   password,
			},
		},
		jwt: NewJWTManager("test-secret", time.Hour),
	}
}

func TestPasswordLogin_CorrectPassword(t *testing.T) {
	hdlr := newPasswordAuthHandler("s3cret")

	body := strings.NewReader(`{"password":"s3cret"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/password", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	hdlr.PasswordLogin(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "application/json", rec.Header().Get("Content-Type"))

	var resp map[string]string
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&resp))
	require.NotEmpty(t, resp["token"])

	claims := hdlr.jwt.Claims(resp["token"])
	require.NotNil(t, claims)
	assert.Equal(t, "viewer", claims.Role)
	assert.Equal(t, "password", claims.Subject)
}

func TestPasswordLogin_WrongPassword(t *testing.T) {
	hdlr := newPasswordAuthHandler("s3cret")

	body := strings.NewReader(`{"password":"wrong"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/password", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	hdlr.PasswordLogin(rec, req)
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestPasswordLogin_EmptyPassword(t *testing.T) {
	hdlr := newPasswordAuthHandler("s3cret")

	body := strings.NewReader(`{"password":""}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/password", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	hdlr.PasswordLogin(rec, req)
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestPasswordLogin_InvalidJSON(t *testing.T) {
	hdlr := newPasswordAuthHandler("s3cret")

	body := strings.NewReader(`not json`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/password", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	hdlr.PasswordLogin(rec, req)
	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestPasswordLogin_MissingBody(t *testing.T) {
	hdlr := newPasswordAuthHandler("s3cret")

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/password", nil)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	hdlr.PasswordLogin(rec, req)
	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestPasswordLogin_WrongMode(t *testing.T) {
	hdlr := Handler{
		setting: Setting{
			Secret: "test-secret",
			Auth:   Auth{Mode: "steam", SessionTTL: time.Hour, Password: "s3cret"},
		},
		jwt: NewJWTManager("test-secret", time.Hour),
	}
	body := strings.NewReader(`{"password":"s3cret"}`)
	req := httptest.NewRequest("POST", "/api/v1/auth/password", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	hdlr.PasswordLogin(rec, req)
	assert.Equal(t, http.StatusNotFound, rec.Code)
}

// --- GetAuthConfig tests ---

func TestGetAuthConfig_ReturnsPublicMode(t *testing.T) {
	hdlr := Handler{
		setting: Setting{Auth: Auth{Mode: "public"}},
	}

	ctx := fuego.NewMockContextNoBody()
	resp, err := hdlr.GetAuthConfig(ctx)
	require.NoError(t, err)
	assert.Equal(t, "public", resp.Mode)
}

func TestGetAuthConfig_ReturnsPasswordMode(t *testing.T) {
	hdlr := Handler{
		setting: Setting{Auth: Auth{Mode: "password"}},
	}

	ctx := fuego.NewMockContextNoBody()
	resp, err := hdlr.GetAuthConfig(ctx)
	require.NoError(t, err)
	assert.Equal(t, "password", resp.Mode)
}

func TestGetAuthConfig_ReturnsSteamMode(t *testing.T) {
	hdlr := Handler{
		setting: Setting{Auth: Auth{Mode: "steam"}},
	}

	ctx := fuego.NewMockContextNoBody()
	resp, err := hdlr.GetAuthConfig(ctx)
	require.NoError(t, err)
	assert.Equal(t, "steam", resp.Mode)
}

func TestGetAuthConfig_ReturnsEmptyWhenNotSet(t *testing.T) {
	hdlr := Handler{
		setting: Setting{},
	}

	ctx := fuego.NewMockContextNoBody()
	resp, err := hdlr.GetAuthConfig(ctx)
	require.NoError(t, err)
	assert.Equal(t, "", resp.Mode)
}

// --- Allowlist CRUD tests ---

func newAllowlistAuthHandler(t *testing.T, adminIDs []string) Handler {
	t.Helper()
	repo, err := NewRepoOperation(filepath.Join(t.TempDir(), "test.db"))
	require.NoError(t, err)
	t.Cleanup(func() { repo.db.Close() })
	return Handler{
		repoOperation: repo,
		setting: Setting{
			Secret: "test-secret",
			Auth: Auth{
				Mode:          "steamAllowlist",
				SessionTTL:    time.Hour,
				AdminSteamIDs: adminIDs,
			},
		},
		jwt:              NewJWTManager("test-secret", time.Hour),
		openIDCache:      openid.NewSimpleDiscoveryCache(),
		openIDNonceStore: openid.NewSimpleNonceStore(),
		openIDVerifier:   mockVerifier{claimedID: "https://steamcommunity.com/openid/id/76561198012345678"},
	}
}

func TestAllowlistCRUD(t *testing.T) {
	hdlr := newAllowlistAuthHandler(t, nil)
	ctx := context.Background()

	// Empty allowlist
	ids, err := hdlr.repoOperation.GetAllowlist(ctx)
	require.NoError(t, err)
	assert.Empty(t, ids)

	// Add a Steam ID
	err = hdlr.repoOperation.AddToAllowlist(ctx, "76561198012345678")
	require.NoError(t, err)

	// Verify it's there
	ids, err = hdlr.repoOperation.GetAllowlist(ctx)
	require.NoError(t, err)
	assert.Equal(t, []string{"76561198012345678"}, ids)

	// Add again (idempotent)
	err = hdlr.repoOperation.AddToAllowlist(ctx, "76561198012345678")
	require.NoError(t, err)

	ids, err = hdlr.repoOperation.GetAllowlist(ctx)
	require.NoError(t, err)
	assert.Equal(t, []string{"76561198012345678"}, ids)

	// IsOnAllowlist
	on, err := hdlr.repoOperation.IsOnAllowlist(ctx, "76561198012345678")
	require.NoError(t, err)
	assert.True(t, on)

	on, err = hdlr.repoOperation.IsOnAllowlist(ctx, "76561198099999999")
	require.NoError(t, err)
	assert.False(t, on)

	// Remove
	err = hdlr.repoOperation.RemoveFromAllowlist(ctx, "76561198012345678")
	require.NoError(t, err)

	ids, err = hdlr.repoOperation.GetAllowlist(ctx)
	require.NoError(t, err)
	assert.Empty(t, ids)
}

func TestGetAllowlist_Handler(t *testing.T) {
	hdlr := newAllowlistAuthHandler(t, nil)
	ctx := context.Background()

	// Seed data
	require.NoError(t, hdlr.repoOperation.AddToAllowlist(ctx, "76561198012345678"))
	require.NoError(t, hdlr.repoOperation.AddToAllowlist(ctx, "76561198099999999"))

	mockCtx := fuego.NewMockContextNoBody()
	resp, err := hdlr.GetAllowlist(mockCtx)
	require.NoError(t, err)
	assert.Equal(t, []string{"76561198012345678", "76561198099999999"}, resp.SteamIDs)
}

func TestAddToAllowlist_Handler(t *testing.T) {
	hdlr := newAllowlistAuthHandler(t, nil)

	mockCtx := fuego.NewMockContextNoBody()
	mockCtx.PathParams = map[string]string{"steamId": "76561198012345678"}

	_, err := hdlr.AddToAllowlist(mockCtx)
	require.NoError(t, err)

	// Verify it was added
	ids, err := hdlr.repoOperation.GetAllowlist(context.Background())
	require.NoError(t, err)
	assert.Equal(t, []string{"76561198012345678"}, ids)
}

func TestAddToAllowlist_Handler_MissingSteamID(t *testing.T) {
	hdlr := newAllowlistAuthHandler(t, nil)
	mockCtx := fuego.NewMockContextNoBody()
	mockCtx.PathParams = map[string]string{}

	_, err := hdlr.AddToAllowlist(mockCtx)
	require.Error(t, err)
	var bad fuego.BadRequestError
	require.ErrorAs(t, err, &bad)
	assert.Contains(t, bad.Detail, "steamId is required")
}

func TestRemoveFromAllowlist_Handler_MissingSteamID(t *testing.T) {
	hdlr := newAllowlistAuthHandler(t, nil)
	mockCtx := fuego.NewMockContextNoBody()
	mockCtx.PathParams = map[string]string{}

	_, err := hdlr.RemoveFromAllowlist(mockCtx)
	require.Error(t, err)
	var bad fuego.BadRequestError
	require.ErrorAs(t, err, &bad)
	assert.Contains(t, bad.Detail, "steamId is required")
}

func TestGetAdminAuthConfig_FullyPopulated(t *testing.T) {
	hdlr := Handler{
		setting: Setting{
			Auth: Auth{
				Mode:          "steamAllowlist",
				SessionTTL:    24 * time.Hour,
				AdminSteamIDs: []string{"76561198000000001", "76561198000000002"},
				SteamAPIKey:   "secret-key-here",
			},
		},
	}

	resp, err := hdlr.GetAdminAuthConfig(fuego.NewMockContextNoBody())
	require.NoError(t, err)
	assert.Equal(t, "steamAllowlist", resp.Mode)
	assert.Equal(t, []string{"76561198000000001", "76561198000000002"}, resp.AdminSteamIDs)
	assert.True(t, resp.SteamAPIKeyConfigured)
	assert.Equal(t, "24h0m0s", resp.SessionTTL)
}

func TestGetAdminAuthConfig_EmptyAdminsReturnsSliceNotNil(t *testing.T) {
	hdlr := Handler{
		setting: Setting{
			Auth: Auth{
				Mode:       "public",
				SessionTTL: time.Hour,
				// AdminSteamIDs left as nil intentionally
			},
		},
	}

	resp, err := hdlr.GetAdminAuthConfig(fuego.NewMockContextNoBody())
	require.NoError(t, err)
	assert.Equal(t, "public", resp.Mode)
	assert.NotNil(t, resp.AdminSteamIDs)
	assert.Empty(t, resp.AdminSteamIDs)
	assert.False(t, resp.SteamAPIKeyConfigured)
	assert.Equal(t, "1h0m0s", resp.SessionTTL)

	// JSON shape: adminSteamIds must serialize as [], never null.
	b, err := json.Marshal(resp)
	require.NoError(t, err)
	assert.Contains(t, string(b), `"adminSteamIds":[]`)
}

func TestGetAllowlist_Handler_RepoError(t *testing.T) {
	hdlr := newAllowlistAuthHandler(t, nil)
	// Force the repo error path by closing the underlying DB.
	require.NoError(t, hdlr.repoOperation.db.Close())

	_, err := hdlr.GetAllowlist(fuego.NewMockContextNoBody())
	require.Error(t, err)
}

func TestAddToAllowlist_Handler_RepoError(t *testing.T) {
	hdlr := newAllowlistAuthHandler(t, nil)
	require.NoError(t, hdlr.repoOperation.db.Close())

	mockCtx := fuego.NewMockContextNoBody()
	mockCtx.PathParams = map[string]string{"steamId": "76561198012345678"}

	_, err := hdlr.AddToAllowlist(mockCtx)
	require.Error(t, err)
}

func TestRemoveFromAllowlist_Handler_RepoError(t *testing.T) {
	hdlr := newAllowlistAuthHandler(t, nil)
	require.NoError(t, hdlr.repoOperation.db.Close())

	mockCtx := fuego.NewMockContextNoBody()
	mockCtx.PathParams = map[string]string{"steamId": "76561198012345678"}

	_, err := hdlr.RemoveFromAllowlist(mockCtx)
	require.Error(t, err)
}

func TestGetAdminAuthConfig_SteamAPIKeyAbsentVsPresent(t *testing.T) {
	withoutKey := Handler{setting: Setting{Auth: Auth{Mode: "steam", SessionTTL: time.Hour}}}
	withKey := Handler{setting: Setting{Auth: Auth{Mode: "steam", SessionTTL: time.Hour, SteamAPIKey: "x"}}}

	r1, err := withoutKey.GetAdminAuthConfig(fuego.NewMockContextNoBody())
	require.NoError(t, err)
	assert.False(t, r1.SteamAPIKeyConfigured)

	r2, err := withKey.GetAdminAuthConfig(fuego.NewMockContextNoBody())
	require.NoError(t, err)
	assert.True(t, r2.SteamAPIKeyConfigured)
}

func TestRemoveFromAllowlist_Handler(t *testing.T) {
	hdlr := newAllowlistAuthHandler(t, nil)
	ctx := context.Background()

	// Seed data
	require.NoError(t, hdlr.repoOperation.AddToAllowlist(ctx, "76561198012345678"))

	mockCtx := fuego.NewMockContextNoBody()
	mockCtx.PathParams = map[string]string{"steamId": "76561198012345678"}

	_, err := hdlr.RemoveFromAllowlist(mockCtx)
	require.NoError(t, err)

	// Verify it was removed
	ids, err := hdlr.repoOperation.GetAllowlist(ctx)
	require.NoError(t, err)
	assert.Empty(t, ids)
}

// --- SteamCallback allowlist mode tests ---

func TestSteamCallback_AllowlistMode_AllowedUser(t *testing.T) {
	hdlr := newAllowlistAuthHandler(t, []string{"76561198099999999"}) // different admin
	hdlr.openIDVerifier = mockVerifier{claimedID: "https://steamcommunity.com/openid/id/76561198012345678"}

	// Add the user to the allowlist
	require.NoError(t, hdlr.repoOperation.AddToAllowlist(context.Background(), "76561198012345678"))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/steam/callback?nonce=abc", nil)
	req.AddCookie(&http.Cookie{Name: cookieNonce, Value: "abc"})
	rec := httptest.NewRecorder()

	hdlr.SteamCallback(rec, req)
	assert.Equal(t, http.StatusTemporaryRedirect, rec.Code)

	loc := rec.Header().Get("Location")
	assert.Contains(t, loc, "auth_token=")
	assert.NotContains(t, loc, "auth_error")

	u, err := url.Parse(loc)
	require.NoError(t, err)
	tokenValue := u.Query().Get("auth_token")
	claims := hdlr.jwt.Claims(tokenValue)
	require.NotNil(t, claims)
	assert.Equal(t, "viewer", claims.Role)
}

func TestSteamCallback_AllowlistMode_DeniedUser(t *testing.T) {
	hdlr := newAllowlistAuthHandler(t, []string{"76561198099999999"}) // different admin
	hdlr.openIDVerifier = mockVerifier{claimedID: "https://steamcommunity.com/openid/id/76561198012345678"}
	// Do NOT add to allowlist

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/steam/callback?nonce=abc", nil)
	req.AddCookie(&http.Cookie{Name: cookieNonce, Value: "abc"})
	rec := httptest.NewRecorder()

	hdlr.SteamCallback(rec, req)
	assert.Equal(t, http.StatusTemporaryRedirect, rec.Code)
	assert.Contains(t, rec.Header().Get("Location"), "auth_error=not_allowed")
}

func TestSteamCallback_AllowlistMode_DBErrorRedirectsToSteamError(t *testing.T) {
	hdlr := newAllowlistAuthHandler(t, []string{"76561198099999999"}) // different admin → goes through allowlist check
	hdlr.openIDVerifier = mockVerifier{claimedID: "https://steamcommunity.com/openid/id/76561198012345678"}
	// Force IsOnAllowlist to fail by closing the underlying DB.
	require.NoError(t, hdlr.repoOperation.db.Close())

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/steam/callback?nonce=abc", nil)
	req.AddCookie(&http.Cookie{Name: cookieNonce, Value: "abc"})
	rec := httptest.NewRecorder()

	hdlr.SteamCallback(rec, req)
	assert.Equal(t, http.StatusTemporaryRedirect, rec.Code)
	assert.Contains(t, rec.Header().Get("Location"), "auth_error=steam_error")
}

func TestSteamCallback_AllowlistMode_AdminBypass(t *testing.T) {
	hdlr := newAllowlistAuthHandler(t, []string{"76561198012345678"}) // same as the mock verifier
	hdlr.openIDVerifier = mockVerifier{claimedID: "https://steamcommunity.com/openid/id/76561198012345678"}
	// Do NOT add to allowlist — admin should bypass

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/steam/callback?nonce=abc", nil)
	req.AddCookie(&http.Cookie{Name: cookieNonce, Value: "abc"})
	rec := httptest.NewRecorder()

	hdlr.SteamCallback(rec, req)
	assert.Equal(t, http.StatusTemporaryRedirect, rec.Code)

	loc := rec.Header().Get("Location")
	assert.Contains(t, loc, "auth_token=")
	assert.NotContains(t, loc, "auth_error")

	u, err := url.Parse(loc)
	require.NoError(t, err)
	tokenValue := u.Query().Get("auth_token")
	claims := hdlr.jwt.Claims(tokenValue)
	require.NotNil(t, claims)
	assert.Equal(t, "admin", claims.Role)
}

