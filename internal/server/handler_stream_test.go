package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/labstack/echo/v4"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestStreamingSettingDefaults(t *testing.T) {
	s := Setting{}
	// Verify Streaming field exists and has zero values
	assert.False(t, s.Streaming.Enabled)
	assert.Equal(t, time.Duration(0), s.Streaming.PingInterval)
	assert.Equal(t, time.Duration(0), s.Streaming.PingTimeout)
}

func newTestStreamHandler(enabled bool) (*Handler, *echo.Echo) {
	e := echo.New()
	hdlr := &Handler{
		setting: Setting{
			Secret: "test-secret",
			Streaming: Streaming{
				Enabled:      enabled,
				PingInterval: 30 * time.Second,
				PingTimeout:  10 * time.Second,
			},
		},
	}
	e.GET("/api/v1/stream", hdlr.HandleStream)
	return hdlr, e
}

func TestHandleStream_Disabled(t *testing.T) {
	_, e := newTestStreamHandler(false)
	srv := httptest.NewServer(e)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/v1/stream?secret=test-secret"
	_, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	require.Error(t, err)
	assert.Equal(t, http.StatusNotFound, resp.StatusCode)
}

func TestHandleStream_WrongSecret(t *testing.T) {
	_, e := newTestStreamHandler(true)
	srv := httptest.NewServer(e)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/v1/stream?secret=wrong"
	_, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	require.Error(t, err)
	assert.Equal(t, http.StatusForbidden, resp.StatusCode)
}

func TestHandleStream_UpgradeSuccess(t *testing.T) {
	_, e := newTestStreamHandler(true)
	srv := httptest.NewServer(e)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/v1/stream?secret=test-secret"
	conn, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	require.NoError(t, err)
	assert.Equal(t, http.StatusSwitchingProtocols, resp.StatusCode)
	conn.Close()
}
