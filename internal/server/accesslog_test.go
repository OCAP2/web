package server

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"maps"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func captureLogs(t *testing.T, level slog.Level) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&buf, &slog.HandlerOptions{Level: level})))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return &buf
}

func logEntries(t *testing.T, buf *bytes.Buffer) []map[string]any {
	t.Helper()
	var entries []map[string]any
	for line := range strings.Lines(buf.String()) {
		var e map[string]any
		require.NoError(t, json.Unmarshal([]byte(line), &e))
		entries = append(entries, e)
	}
	return entries
}

func TestAccessLogMiddleware(t *testing.T) {
	trusted, err := ParseTrustedProxies([]string{"172.18.0.0/16"})
	require.NoError(t, err)
	handler := AccessLogMiddleware("/api/healthcheck")(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/missing" {
				http.NotFound(w, r)
				return
			}
			w.Write([]byte("ok"))
		}),
	)
	// Same order as main: RealIP wraps the access log.
	handler = RealIPMiddleware(trusted, nil)(handler)

	serve := func(path string, header http.Header) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.RemoteAddr = "172.18.0.2:4000"
		maps.Copy(req.Header, header)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}

	t.Run("info logs response with client address", func(t *testing.T) {
		buf := captureLogs(t, slog.LevelInfo)
		rec := serve("/missing", http.Header{"X-Forwarded-For": {"1.2.3.4"}})

		entries := logEntries(t, buf)
		require.Len(t, entries, 1)
		e := entries[0]
		assert.Equal(t, "outgoing response", e["msg"])
		assert.Equal(t, "INFO", e["level"])
		assert.EqualValues(t, http.StatusNotFound, e["status_code"])
		assert.Equal(t, "/missing", e["path"])
		assert.Equal(t, "1.2.3.4", e["remote_addr"])
		assert.NotEmpty(t, e["request_id"])
		assert.Equal(t, e["request_id"], rec.Header().Get("X-Request-ID"))
	})

	t.Run("healthcheck is hidden at info", func(t *testing.T) {
		buf := captureLogs(t, slog.LevelInfo)
		serve("/api/healthcheck", nil)
		assert.Empty(t, buf.String())
	})

	t.Run("healthcheck is logged at debug", func(t *testing.T) {
		buf := captureLogs(t, slog.LevelDebug)
		rec := serve("/api/healthcheck", http.Header{"X-Request-Id": {"req-1"}})

		entries := logEntries(t, buf)
		require.Len(t, entries, 2)
		assert.Equal(t, "incoming request", entries[0]["msg"])
		assert.Equal(t, "outgoing response", entries[1]["msg"])
		assert.Equal(t, "DEBUG", entries[1]["level"])
		assert.EqualValues(t, http.StatusOK, entries[1]["status_code"])
		assert.Equal(t, "172.18.0.2:4000", entries[1]["remote_addr"])
		assert.Equal(t, "req-1", rec.Header().Get("X-Request-ID"))
	})
}

func TestAccessLogWriter_ResponseController(t *testing.T) {
	rec := httptest.NewRecorder()
	w := &accessLogWriter{ResponseWriter: rec}
	require.NoError(t, http.NewResponseController(w).Flush())
	assert.True(t, rec.Flushed)
	assert.Equal(t, http.StatusOK, w.statusCode())
}
