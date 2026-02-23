package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newAuthHandler() Handler {
	return Handler{
		setting:  Setting{Secret: "test-secret"},
		sessions: NewSessionStore(time.Hour),
	}
}

func TestLogin_Success(t *testing.T) {
	hdlr := newAuthHandler()
	e := echo.New()

	body := `{"secret":"test-secret"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := hdlr.Login(c)
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, rec.Code)

	// Should set a session cookie
	cookies := rec.Result().Cookies()
	require.Len(t, cookies, 1)
	assert.Equal(t, "ocap_session", cookies[0].Name)
	assert.True(t, cookies[0].HttpOnly)
}

func TestLogin_WrongSecret(t *testing.T) {
	hdlr := newAuthHandler()
	e := echo.New()

	body := `{"secret":"wrong"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := hdlr.Login(c)
	assert.Equal(t, echo.ErrForbidden, err)
}

func TestLogin_BadBody(t *testing.T) {
	hdlr := newAuthHandler()
	e := echo.New()

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader("not json"))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := hdlr.Login(c)
	assert.Equal(t, echo.ErrBadRequest, err)
}

func TestGetMe_Authenticated(t *testing.T) {
	hdlr := newAuthHandler()
	token := hdlr.sessions.Create()

	e := echo.New()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
	req.AddCookie(&http.Cookie{Name: "ocap_session", Value: token})
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := hdlr.GetMe(c)
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), `"authenticated":true`)
}

func TestGetMe_NotAuthenticated(t *testing.T) {
	hdlr := newAuthHandler()
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
	hdlr := newAuthHandler()
	token := hdlr.sessions.Create()

	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", nil)
	req.AddCookie(&http.Cookie{Name: "ocap_session", Value: token})
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := hdlr.Logout(c)
	require.NoError(t, err)
	assert.Equal(t, http.StatusNoContent, rec.Code)

	// Session should be invalidated
	assert.False(t, hdlr.sessions.Valid(token))
}
