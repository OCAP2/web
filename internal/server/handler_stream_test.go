package server

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-fuego/fuego"
	"github.com/gorilla/websocket"
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

func newTestStreamHandler(enabled bool) (*Handler, *http.ServeMux) {
	mux := http.NewServeMux()
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
	mux.HandleFunc("GET /api/v1/stream", hdlr.HandleStream)
	return hdlr, mux
}

func TestHandleStream_Disabled(t *testing.T) {
	_, mux := newTestStreamHandler(false)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/v1/stream?secret=test-secret"
	_, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	require.Error(t, err)
	assert.Equal(t, http.StatusNotFound, resp.StatusCode)
}

func TestHandleStream_WrongSecret(t *testing.T) {
	_, mux := newTestStreamHandler(true)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/v1/stream?secret=wrong"
	_, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	require.Error(t, err)
	assert.Equal(t, http.StatusForbidden, resp.StatusCode)
}

func TestHandleStream_BrowserOriginRejected(t *testing.T) {
	_, mux := newTestStreamHandler(true)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/v1/stream?secret=test-secret"
	_, resp, err := websocket.DefaultDialer.Dial(wsURL, http.Header{"Origin": {"https://evil.example.com"}})
	require.Error(t, err)
	assert.Equal(t, http.StatusForbidden, resp.StatusCode)
}

func TestHandleStream_UpgradeSuccess(t *testing.T) {
	_, mux := newTestStreamHandler(true)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/v1/stream?secret=test-secret"
	conn, resp, err := websocket.DefaultDialer.Dial(wsURL, nil)
	require.NoError(t, err)
	assert.Equal(t, http.StatusSwitchingProtocols, resp.StatusCode)
	conn.Close()
}

func TestHandleStream_StartMissionAck(t *testing.T) {
	_, mux := newTestStreamHandler(true)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/v1/stream?secret=test-secret"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	require.NoError(t, err)
	defer conn.Close()

	// Send start_mission
	err = conn.WriteJSON(map[string]any{
		"type":        "start_mission",
		"missionName": "Test Mission",
		"worldName":   "altis",
	})
	require.NoError(t, err)

	// Read ack
	var ack map[string]string
	err = conn.ReadJSON(&ack)
	require.NoError(t, err)
	assert.Equal(t, "ack", ack["type"])
	assert.Equal(t, "start_mission", ack["for"])
}

func TestHandleStream_EndMissionAckAndClose(t *testing.T) {
	_, mux := newTestStreamHandler(true)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/v1/stream?secret=test-secret"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	require.NoError(t, err)
	defer conn.Close()

	// Send start_mission and consume ack
	err = conn.WriteJSON(map[string]string{"type": "start_mission"})
	require.NoError(t, err)
	var startAck map[string]string
	err = conn.ReadJSON(&startAck)
	require.NoError(t, err)

	// Send some state messages
	for i := 0; i < 5; i++ {
		conn.WriteJSON(map[string]any{"type": "soldier_state", "id": i})
	}

	// Send end_mission
	err = conn.WriteJSON(map[string]string{"type": "end_mission"})
	require.NoError(t, err)

	// Read ack
	var ack map[string]string
	err = conn.ReadJSON(&ack)
	require.NoError(t, err)
	assert.Equal(t, "ack", ack["type"])
	assert.Equal(t, "end_mission", ack["for"])

	// Connection should be closed by server — next read should fail
	_, _, err = conn.ReadMessage()
	assert.Error(t, err)
}

func TestHandleStream_UnknownTypesAccepted(t *testing.T) {
	_, mux := newTestStreamHandler(true)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/v1/stream?secret=test-secret"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	require.NoError(t, err)
	defer conn.Close()

	// Send unknown message types — should not error
	err = conn.WriteJSON(map[string]string{"type": "add_soldier"})
	require.NoError(t, err)
	err = conn.WriteJSON(map[string]string{"type": "vehicle_state"})
	require.NoError(t, err)
	err = conn.WriteJSON(map[string]string{"type": "fired_event"})
	require.NoError(t, err)

	// Send end_mission to cleanly close
	conn.WriteJSON(map[string]string{"type": "end_mission"})
	var ack map[string]string
	err = conn.ReadJSON(&ack)
	require.NoError(t, err)
	assert.Equal(t, "end_mission", ack["for"])
}

func TestHandleStream_InvalidJSON(t *testing.T) {
	_, mux := newTestStreamHandler(true)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/v1/stream?secret=test-secret"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	require.NoError(t, err)
	defer conn.Close()

	// Send invalid JSON — should be skipped, not crash
	err = conn.WriteMessage(websocket.TextMessage, []byte("not json"))
	require.NoError(t, err)

	// Server should still be alive — send valid message and get ack
	err = conn.WriteJSON(map[string]string{"type": "start_mission"})
	require.NoError(t, err)
	var ack map[string]string
	err = conn.ReadJSON(&ack)
	require.NoError(t, err)
	assert.Equal(t, "start_mission", ack["for"])
}

func TestHandleStream_NormalClose(t *testing.T) {
	_, mux := newTestStreamHandler(true)
	srv := httptest.NewServer(mux)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/v1/stream?secret=test-secret"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	require.NoError(t, err)

	// Send a proper WebSocket close frame (triggers normal close path)
	err = conn.WriteMessage(websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
	require.NoError(t, err)
	conn.Close()
}

func TestHandleStream_ZeroConfigFallbacks(t *testing.T) {
	mux := http.NewServeMux()
	hdlr := &Handler{
		setting: Setting{
			Secret: "test-secret",
			Streaming: Streaming{
				Enabled: true,
				// PingInterval and PingTimeout intentionally zero
			},
		},
	}
	mux.HandleFunc("GET /api/v1/stream", hdlr.HandleStream)

	srv := httptest.NewServer(mux)
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http") + "/api/v1/stream?secret=test-secret"
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	require.NoError(t, err)
	defer conn.Close()

	// Verify connection works with fallback values
	err = conn.WriteJSON(map[string]string{"type": "end_mission"})
	require.NoError(t, err)
	var ack map[string]string
	err = conn.ReadJSON(&ack)
	require.NoError(t, err)
	assert.Equal(t, "end_mission", ack["for"])
}

func TestNewHandler_StreamRouteRegistered(t *testing.T) {
	dir := t.TempDir()
	pathDB := filepath.Join(dir, "test.db")
	repo, err := NewRepoOperation(pathDB)
	require.NoError(t, err)
	defer repo.db.Close()
	repoMarker, _ := NewRepoMarker(filepath.Join(dir, "markers"))
	repoAmmo, _ := NewRepoAmmo(filepath.Join(dir, "ammo"))

	s := fuego.NewServer(fuego.WithoutStartupMessages(), fuego.WithoutAutoGroupTags(), fuego.WithSecurity(OpenAPISecuritySchemes))
	NewHandler(s, repo, repoMarker, repoAmmo, Setting{PrefixURL: "/sub/"})

	// Verify the stream route is accessible by making a request
	ts := httptest.NewServer(s.Mux)
	defer ts.Close()

	// The stream endpoint should respond (even if not upgraded) — 404 because streaming disabled
	resp, err := http.Get(ts.URL + "/sub/api/v1/stream")
	require.NoError(t, err)
	defer resp.Body.Close()
	// With streaming disabled (default), should get 404
	assert.Equal(t, http.StatusNotFound, resp.StatusCode)
}
