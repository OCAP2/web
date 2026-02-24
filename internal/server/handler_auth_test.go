package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/yohcop/openid-go"
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

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/steam", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := hdlr.SteamLogin(c)
	require.NoError(t, err)
	assert.Equal(t, http.StatusTemporaryRedirect, rec.Code)

	loc := rec.Header().Get("Location")
	assert.Contains(t, loc, "steamcommunity.com/openid")

	// Should set nonce cookie
	cookies := rec.Result().Cookies()
	var foundNonce bool
	for _, ck := range cookies {
		if ck.Name == nonceCookie {
			foundNonce = true
			assert.True(t, ck.HttpOnly)
			assert.NotEmpty(t, ck.Value)
		}
	}
	assert.True(t, foundNonce, "nonce cookie should be set")
}

func TestSteamCallback_MissingNonce(t *testing.T) {
	hdlr := newSteamAuthHandler([]string{"76561198012345678"})

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/steam/callback?nonce=abc", nil)
	// No cookie set
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := hdlr.SteamCallback(c)
	he, ok := err.(*echo.HTTPError)
	require.True(t, ok)
	assert.Equal(t, http.StatusBadRequest, he.Code)
}

func TestSteamCallback_NonceMismatch(t *testing.T) {
	hdlr := newSteamAuthHandler([]string{"76561198012345678"})

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/steam/callback?nonce=abc", nil)
	req.AddCookie(&http.Cookie{Name: nonceCookie, Value: "xyz"})
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := hdlr.SteamCallback(c)
	he, ok := err.(*echo.HTTPError)
	require.True(t, ok)
	assert.Equal(t, http.StatusBadRequest, he.Code)
}

func TestSteamCallback_UnauthorizedSteamID(t *testing.T) {
	hdlr := newSteamAuthHandler([]string{"76561198099999999"}) // different ID
	hdlr.openIDVerifier = mockVerifier{claimedID: "https://steamcommunity.com/openid/id/76561198012345678"}

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/steam/callback?nonce=abc", nil)
	req.AddCookie(&http.Cookie{Name: nonceCookie, Value: "abc"})
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := hdlr.SteamCallback(c)
	require.NoError(t, err)
	assert.Equal(t, http.StatusTemporaryRedirect, rec.Code)
	assert.Contains(t, rec.Header().Get("Location"), "auth_error=steam_denied")
}

func TestSteamCallback_Success(t *testing.T) {
	hdlr := newSteamAuthHandler([]string{"76561198012345678"})

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/steam/callback?nonce=abc", nil)
	req.AddCookie(&http.Cookie{Name: nonceCookie, Value: "abc"})
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := hdlr.SteamCallback(c)
	require.NoError(t, err)
	assert.Equal(t, http.StatusTemporaryRedirect, rec.Code)

	// Should set token cookie
	cookies := rec.Result().Cookies()
	var tokenValue string
	for _, ck := range cookies {
		if ck.Name == tokenCookie {
			tokenValue = ck.Value
			assert.False(t, ck.HttpOnly, "token cookie must be readable by JS")
		}
	}
	assert.NotEmpty(t, tokenValue, "token cookie should be set")

	// Token should be valid and contain the Steam ID as subject
	assert.NoError(t, hdlr.jwt.Validate(tokenValue))
	assert.Equal(t, "76561198012345678", hdlr.jwt.Subject(tokenValue))
}

func TestGetMe_WithSteamID(t *testing.T) {
	hdlr := newSteamAuthHandler(nil)
	token, err := hdlr.jwt.Create("76561198012345678")
	require.NoError(t, err)

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err = hdlr.GetMe(c)
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), `"authenticated":true`)
	assert.Contains(t, rec.Body.String(), `"steamId":"76561198012345678"`)
}

func TestGetMe_NotAuthenticated(t *testing.T) {
	hdlr := newSteamAuthHandler(nil)
	e := echo.New()

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := hdlr.GetMe(c)
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), `"authenticated":false`)
}

func TestLogout(t *testing.T) {
	hdlr := newSteamAuthHandler(nil)

	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := hdlr.Logout(c)
	require.NoError(t, err)
	assert.Equal(t, http.StatusNoContent, rec.Code)
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
