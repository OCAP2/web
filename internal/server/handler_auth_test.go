package server

import (
	"encoding/json"
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
		setting: Setting{Secret: "test-secret"},
		jwt:     NewJWTManager("test-secret", time.Hour),
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

	// Response should contain a token
	var resp map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	assert.Equal(t, true, resp["authenticated"])
	assert.NotEmpty(t, resp["token"])
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
	token, err := hdlr.jwt.Create()
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

	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", nil)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	err := hdlr.Logout(c)
	require.NoError(t, err)
	assert.Equal(t, http.StatusNoContent, rec.Code)
}
