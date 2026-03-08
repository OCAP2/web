package server

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
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

// --- checkSteamGroupMembership unit tests ---

func TestCheckSteamGroupMembership_IsMember(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "TESTKEY", r.URL.Query().Get("key"))
		assert.Equal(t, "76561198012345678", r.URL.Query().Get("steamid"))
		fmt.Fprint(w, `{"response":{"success":true,"groups":[{"gid":"103582791460000000"},{"gid":"103582791460111111"}]}}`)
	}))
	defer srv.Close()

	isMember, err := checkSteamGroupMembership(srv.URL, "76561198012345678", "TESTKEY", "103582791460111111")
	require.NoError(t, err)
	assert.True(t, isMember)
}

func TestCheckSteamGroupMembership_NotAMember(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(w, `{"response":{"success":true,"groups":[{"gid":"103582791460000000"}]}}`)
	}))
	defer srv.Close()

	isMember, err := checkSteamGroupMembership(srv.URL, "76561198012345678", "TESTKEY", "103582791460999999")
	require.NoError(t, err)
	assert.False(t, isMember)
}

func TestCheckSteamGroupMembership_APIError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))
	defer srv.Close()

	_, err := checkSteamGroupMembership(srv.URL, "76561198012345678", "BADKEY", "103582791460111111")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "status 403")
}

func TestCheckSteamGroupMembership_InvalidJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(w, `not json`)
	}))
	defer srv.Close()

	_, err := checkSteamGroupMembership(srv.URL, "76561198012345678", "TESTKEY", "103582791460111111")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "decode error")
}

func TestCheckSteamGroupMembership_ConnectionError(t *testing.T) {
	_, err := checkSteamGroupMembership("http://127.0.0.1:1/", "76561198012345678", "TESTKEY", "103582791460111111")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "request failed")
}

func TestCheckSteamGroupMembership_EmptyGroups(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(w, `{"response":{"success":true,"groups":[]}}`)
	}))
	defer srv.Close()

	isMember, err := checkSteamGroupMembership(srv.URL, "76561198012345678", "TESTKEY", "103582791460111111")
	require.NoError(t, err)
	assert.False(t, isMember)
}

// --- SteamCallback integration tests for steamGroup mode ---

func newSteamGroupHandler(steamID string, adminIDs []string, groupID string) (Handler, *httptest.Server) {
	// Create a mock server that handles both profile API and group membership API requests
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		// Route based on query parameters: group API uses "steamid" (singular), profile API uses "steamids" (plural)
		if q.Get("steamid") != "" {
			// GetUserGroupList request — return groupID as a member group
			fmt.Fprintf(w, `{"response":{"success":true,"groups":[{"gid":"%s"}]}}`, groupID)
		} else if q.Get("steamids") != "" {
			// GetPlayerSummaries request
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
						{PersonaName: "TestPlayer", AvatarURL: "https://example.com/avatar.jpg"},
					},
				},
			})
		}
	})
	srv := httptest.NewServer(mux)

	hdlr := Handler{
		setting: Setting{
			Secret: "test-secret",
			Auth: Auth{
				Mode:          "steamGroup",
				SessionTTL:    time.Hour,
				AdminSteamIDs: adminIDs,
				SteamAPIKey:   "TESTKEY",
				SteamGroupID:  groupID,
			},
		},
		jwt:              NewJWTManager("test-secret", time.Hour),
		openIDCache:      openid.NewSimpleDiscoveryCache(),
		openIDNonceStore: openid.NewSimpleNonceStore(),
		openIDVerifier:   mockVerifier{claimedID: "https://steamcommunity.com/openid/id/" + steamID},
		steamAPIBaseURL:  srv.URL,
	}

	return hdlr, srv
}

func TestSteamCallback_SteamGroup_MemberGetsToken(t *testing.T) {
	hdlr, srv := newSteamGroupHandler("76561198012345678", nil, "103582791460111111")
	defer srv.Close()

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

func TestSteamCallback_SteamGroup_NonMemberGetsError(t *testing.T) {
	// The mock server returns groupID "103582791460111111" as the user's group,
	// but we configure the handler to require "999999999999999999"
	hdlr, srv := newSteamGroupHandler("76561198012345678", nil, "999999999999999999")
	defer srv.Close()

	// Override the mock to return a different group than what's required
	srv.Close()
	nonMemberSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("steamid") != "" {
			// Return a group that doesn't match the required one
			fmt.Fprint(w, `{"response":{"success":true,"groups":[{"gid":"103582791460000000"}]}}`)
		} else if q.Get("steamids") != "" {
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
						{PersonaName: "TestPlayer", AvatarURL: "https://example.com/avatar.jpg"},
					},
				},
			})
		}
	}))
	defer nonMemberSrv.Close()
	hdlr.steamAPIBaseURL = nonMemberSrv.URL

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/steam/callback?nonce=abc", nil)
	req.AddCookie(&http.Cookie{Name: cookieNonce, Value: "abc"})
	rec := httptest.NewRecorder()

	hdlr.SteamCallback(rec, req)
	assert.Equal(t, http.StatusTemporaryRedirect, rec.Code)

	loc := rec.Header().Get("Location")
	assert.Contains(t, loc, "auth_error=not_a_member")
	assert.NotContains(t, loc, "auth_token=")
}

func TestSteamCallback_SteamGroup_AdminBypassesGroupCheck(t *testing.T) {
	// Admin's steam ID is in the admin list; group check should be skipped entirely
	// Use a group ID that doesn't match any group the user is in, to prove bypass
	steamID := "76561198012345678"
	hdlr, srv := newSteamGroupHandler(steamID, []string{steamID}, "999999999999999999")
	defer srv.Close()

	// Override to return no matching group — if group check runs, it would fail
	srv.Close()
	noGroupSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("steamid") != "" {
			// Return empty groups — would fail membership check
			fmt.Fprint(w, `{"response":{"success":true,"groups":[]}}`)
		} else if q.Get("steamids") != "" {
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
						{PersonaName: "AdminPlayer", AvatarURL: "https://example.com/admin.jpg"},
					},
				},
			})
		}
	}))
	defer noGroupSrv.Close()
	hdlr.steamAPIBaseURL = noGroupSrv.URL

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

func TestSteamCallback_SteamGroup_APIFailureRedirectsWithError(t *testing.T) {
	steamID := "76561198012345678"
	hdlr, srv := newSteamGroupHandler(steamID, nil, "103582791460111111")
	defer srv.Close()

	// Replace with a server that returns 500 for group check
	srv.Close()
	failSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("steamid") != "" {
			w.WriteHeader(http.StatusInternalServerError)
		} else if q.Get("steamids") != "" {
			// Profile fetch still works
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
						{PersonaName: "TestPlayer", AvatarURL: "https://example.com/avatar.jpg"},
					},
				},
			})
		}
	}))
	defer failSrv.Close()
	hdlr.steamAPIBaseURL = failSrv.URL

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/steam/callback?nonce=abc", nil)
	req.AddCookie(&http.Cookie{Name: cookieNonce, Value: "abc"})
	rec := httptest.NewRecorder()

	hdlr.SteamCallback(rec, req)
	assert.Equal(t, http.StatusTemporaryRedirect, rec.Code)

	loc := rec.Header().Get("Location")
	assert.Contains(t, loc, "auth_error=membership_check_failed")
}

func TestSteamCallback_NonSteamGroupMode_SkipsGroupCheck(t *testing.T) {
	// In "steam" mode (not "steamGroup"), group membership check should NOT run
	hdlr := newSteamAuthHandler([]string{})
	hdlr.setting.Auth.Mode = "steam"

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/steam/callback?nonce=abc", nil)
	req.AddCookie(&http.Cookie{Name: cookieNonce, Value: "abc"})
	rec := httptest.NewRecorder()

	hdlr.SteamCallback(rec, req)
	assert.Equal(t, http.StatusTemporaryRedirect, rec.Code)

	loc := rec.Header().Get("Location")
	assert.Contains(t, loc, "auth_token=")
	assert.NotContains(t, loc, "auth_error")
}

// --- squadXmlChecker unit tests ---

const testSquadXML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE squad SYSTEM "squad.dtd">
<squad nick="TestGroup">
  <name>Test Group</name>
  <member id="76561198012345678" nick="Player1"></member>
  <member id="76561198099999999" nick="Player2"></member>
</squad>`

func TestSquadXmlChecker_MemberFound(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(w, testSquadXML)
	}))
	defer srv.Close()

	checker := newSquadXmlChecker(srv.URL, 5*time.Minute)
	isMember, err := checker.isMember("76561198012345678")
	require.NoError(t, err)
	assert.True(t, isMember)
}

func TestSquadXmlChecker_NonMemberNotFound(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(w, testSquadXML)
	}))
	defer srv.Close()

	checker := newSquadXmlChecker(srv.URL, 5*time.Minute)
	isMember, err := checker.isMember("76561198000000000")
	require.NoError(t, err)
	assert.False(t, isMember)
}

func TestSquadXmlChecker_CachePreventsRefetch(t *testing.T) {
	var fetchCount atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fetchCount.Add(1)
		fmt.Fprint(w, testSquadXML)
	}))
	defer srv.Close()

	checker := newSquadXmlChecker(srv.URL, 5*time.Minute)

	// First call fetches
	_, err := checker.isMember("76561198012345678")
	require.NoError(t, err)
	assert.Equal(t, int32(1), fetchCount.Load())

	// Second call should use cache (same TTL, no expiry)
	_, err = checker.isMember("76561198099999999")
	require.NoError(t, err)
	assert.Equal(t, int32(1), fetchCount.Load(), "should not refetch when cache is valid")
}

func TestSquadXmlChecker_ZeroTTL_AlwaysRefetches(t *testing.T) {
	var fetchCount atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fetchCount.Add(1)
		fmt.Fprint(w, testSquadXML)
	}))
	defer srv.Close()

	checker := newSquadXmlChecker(srv.URL, 0) // zero TTL = always refetch

	_, err := checker.isMember("76561198012345678")
	require.NoError(t, err)
	assert.Equal(t, int32(1), fetchCount.Load())

	_, err = checker.isMember("76561198012345678")
	require.NoError(t, err)
	assert.Equal(t, int32(2), fetchCount.Load(), "should refetch every time with zero TTL")
}

func TestSquadXmlChecker_HTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	checker := newSquadXmlChecker(srv.URL, 5*time.Minute)
	_, err := checker.isMember("76561198012345678")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "status 500")
}

func TestSquadXmlChecker_InvalidXML(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(w, "not valid xml <><><<")
	}))
	defer srv.Close()

	checker := newSquadXmlChecker(srv.URL, 5*time.Minute)
	_, err := checker.isMember("76561198012345678")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "parse error")
}

func TestSquadXmlChecker_ConnectionError(t *testing.T) {
	checker := newSquadXmlChecker("http://127.0.0.1:1/", 5*time.Minute)
	_, err := checker.isMember("76561198012345678")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "fetch failed")
}

// --- SteamCallback integration tests for squadXml mode ---

func newSquadXmlHandler(steamID string, adminIDs []string, squadMembers []string) (Handler, *httptest.Server) {
	// Build squad XML from member list
	var members strings.Builder
	for _, id := range squadMembers {
		fmt.Fprintf(&members, `  <member id="%s" nick="Player"></member>`+"\n", id)
	}
	squadXMLBody := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<squad nick="TestGroup">
  <name>Test Group</name>
%s</squad>`, members.String())

	// Create a mock server that handles squad XML, profile API, and group API requests
	mux := http.NewServeMux()
	mux.HandleFunc("/squad.xml", func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(w, squadXMLBody)
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if q.Get("steamids") != "" {
			// GetPlayerSummaries request
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
						{PersonaName: "TestPlayer", AvatarURL: "https://example.com/avatar.jpg"},
					},
				},
			})
		}
	})
	srv := httptest.NewServer(mux)

	hdlr := Handler{
		setting: Setting{
			Secret: "test-secret",
			Auth: Auth{
				Mode:             "squadXml",
				SessionTTL:       time.Hour,
				AdminSteamIDs:    adminIDs,
				SteamAPIKey:      "TESTKEY",
				SquadXmlURL:      srv.URL + "/squad.xml",
				SquadXmlCacheTTL: 5 * time.Minute,
			},
		},
		jwt:              NewJWTManager("test-secret", time.Hour),
		openIDCache:      openid.NewSimpleDiscoveryCache(),
		openIDNonceStore: openid.NewSimpleNonceStore(),
		openIDVerifier:   mockVerifier{claimedID: "https://steamcommunity.com/openid/id/" + steamID},
		steamAPIBaseURL:  srv.URL,
	}
	hdlr.squadXml = newSquadXmlChecker(hdlr.setting.Auth.SquadXmlURL, hdlr.setting.Auth.SquadXmlCacheTTL)

	return hdlr, srv
}

func TestSteamCallback_SquadXml_MemberGetsToken(t *testing.T) {
	steamID := "76561198012345678"
	hdlr, srv := newSquadXmlHandler(steamID, nil, []string{steamID, "76561198099999999"})
	defer srv.Close()

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

func TestSteamCallback_SquadXml_NonMemberGetsError(t *testing.T) {
	steamID := "76561198012345678"
	// Squad XML only contains a different user
	hdlr, srv := newSquadXmlHandler(steamID, nil, []string{"76561198099999999"})
	defer srv.Close()

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/steam/callback?nonce=abc", nil)
	req.AddCookie(&http.Cookie{Name: cookieNonce, Value: "abc"})
	rec := httptest.NewRecorder()

	hdlr.SteamCallback(rec, req)
	assert.Equal(t, http.StatusTemporaryRedirect, rec.Code)

	loc := rec.Header().Get("Location")
	assert.Contains(t, loc, "auth_error=not_a_member")
	assert.NotContains(t, loc, "auth_token=")
}

func TestSteamCallback_SquadXml_AdminBypassesCheck(t *testing.T) {
	steamID := "76561198012345678"
	// Squad XML has NO members — if check runs, it would reject
	hdlr, srv := newSquadXmlHandler(steamID, []string{steamID}, []string{})
	defer srv.Close()

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

func TestSteamCallback_SquadXml_FetchFailureRedirectsWithError(t *testing.T) {
	steamID := "76561198012345678"
	hdlr, srv := newSquadXmlHandler(steamID, nil, []string{steamID})
	defer srv.Close()

	// Replace the squad XML checker with one pointing to a dead server
	hdlr.squadXml = newSquadXmlChecker("http://127.0.0.1:1/squad.xml", 5*time.Minute)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/steam/callback?nonce=abc", nil)
	req.AddCookie(&http.Cookie{Name: cookieNonce, Value: "abc"})
	rec := httptest.NewRecorder()

	hdlr.SteamCallback(rec, req)
	assert.Equal(t, http.StatusTemporaryRedirect, rec.Code)

	loc := rec.Header().Get("Location")
	assert.Contains(t, loc, "auth_error=membership_check_failed")
}
