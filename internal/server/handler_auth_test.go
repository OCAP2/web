package server

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
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

func newSteamAuthHandler(allowedIDs []string) Handler {
	return Handler{
		setting: Setting{
			Secret: "test-secret",
			Admin: Admin{
				SessionTTL:      time.Hour,
				AllowedSteamIDs: allowedIDs,
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

func TestSteamCallback_UnauthorizedSteamID(t *testing.T) {
	hdlr := newSteamAuthHandler([]string{"76561198099999999"}) // different ID
	hdlr.openIDVerifier = mockVerifier{claimedID: "https://steamcommunity.com/openid/id/76561198012345678"}

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/steam/callback?nonce=abc", nil)
	req.AddCookie(&http.Cookie{Name: cookieNonce, Value: "abc"})
	rec := httptest.NewRecorder()

	hdlr.SteamCallback(rec, req)
	assert.Equal(t, http.StatusTemporaryRedirect, rec.Code)
	assert.Contains(t, rec.Header().Get("Location"), "auth_error=steam_denied")
}

func TestSteamCallback_Success(t *testing.T) {
	hdlr := newSteamAuthHandler([]string{"76561198012345678"})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/steam/callback?nonce=abc", nil)
	req.AddCookie(&http.Cookie{Name: cookieNonce, Value: "abc"})
	rec := httptest.NewRecorder()

	hdlr.SteamCallback(rec, req)
	assert.Equal(t, http.StatusTemporaryRedirect, rec.Code)

	// Token should be in the redirect URL query param
	loc := rec.Header().Get("Location")
	assert.Contains(t, loc, "auth_token=")

	u, err := url.Parse(loc)
	require.NoError(t, err)
	tokenValue := u.Query().Get("auth_token")
	assert.NotEmpty(t, tokenValue)

	assert.NoError(t, hdlr.jwt.Validate(tokenValue))
	assert.Equal(t, "76561198012345678", hdlr.jwt.Subject(tokenValue))
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

func TestIsSteamIDAllowed(t *testing.T) {
	allowed := []string{"76561198012345678", "76561198087654321"}

	assert.True(t, isSteamIDAllowed("76561198012345678", allowed))
	assert.True(t, isSteamIDAllowed("76561198087654321", allowed))
	assert.False(t, isSteamIDAllowed("76561198000000000", allowed))
	assert.False(t, isSteamIDAllowed("", allowed))
	assert.False(t, isSteamIDAllowed("76561198012345678", nil))
	assert.False(t, isSteamIDAllowed("76561198012345678", []string{}))
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

func TestSteamCallback_AllowedEmptyList(t *testing.T) {
	hdlr := newSteamAuthHandler([]string{}) // empty allowed list

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/steam/callback?nonce=abc", nil)
	req.AddCookie(&http.Cookie{Name: cookieNonce, Value: "abc"})
	rec := httptest.NewRecorder()

	hdlr.SteamCallback(rec, req)
	assert.Equal(t, http.StatusTemporaryRedirect, rec.Code)
	assert.Contains(t, rec.Header().Get("Location"), "auth_error=steam_denied")
}

func TestSteamCallback_SteamAPIError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	hdlr := newSteamAuthHandler([]string{"76561198012345678"})
	hdlr.setting.Admin.SteamAPIKey = "TESTKEY"
	hdlr.steamAPIBaseURL = srv.URL

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/steam/callback?nonce=abc", nil)
	req.AddCookie(&http.Cookie{Name: cookieNonce, Value: "abc"})
	rec := httptest.NewRecorder()

	hdlr.SteamCallback(rec, req)
	assert.Equal(t, http.StatusTemporaryRedirect, rec.Code)

	// Should still get auth_token (just no profile data)
	loc := rec.Header().Get("Location")
	assert.Contains(t, loc, "auth_token=")
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
	hdlr.setting.Admin.SteamAPIKey = "TESTKEY"
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
	assert.Equal(t, "TestPlayer", claims.SteamName)
	assert.Equal(t, "https://avatars.steamstatic.com/abc.jpg", claims.SteamAvatar)
}
