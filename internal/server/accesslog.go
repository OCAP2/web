package server

import (
	"bufio"
	"log/slog"
	"net"
	"net/http"
	"slices"
	"time"

	"github.com/google/uuid"
)

// accessLogWriter records the response status for the access log.
type accessLogWriter struct {
	http.ResponseWriter
	status   int
	hijacked bool
}

func (w *accessLogWriter) WriteHeader(code int) {
	if w.status == 0 {
		w.status = code
	}
	w.ResponseWriter.WriteHeader(code)
}

func (w *accessLogWriter) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	return w.ResponseWriter.Write(b)
}

func (w *accessLogWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (w *accessLogWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	h, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, http.ErrNotSupported
	}
	conn, rw, err := h.Hijack()
	if err == nil {
		w.hijacked = true
	}
	return conn, rw, err
}

// Unwrap lets http.ResponseController reach the underlying writer.
func (w *accessLogWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

func (w *accessLogWriter) statusCode() int {
	switch {
	case w.hijacked:
		return http.StatusSwitchingProtocols
	case w.status == 0:
		return http.StatusOK
	}
	return w.status
}

// AccessLogMiddleware logs every request: "incoming request" at debug level
// and "outgoing response" at info level, or at debug level for quietPaths
// (such as the healthcheck polled by Docker). It sets X-Request-ID, keeping
// the one the client sent.
func AccessLogMiddleware(quietPaths ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()

			requestID := r.Header.Get("X-Request-ID")
			if requestID == "" {
				requestID = uuid.NewString()
			}
			w.Header().Set("X-Request-ID", requestID)

			ctx := r.Context()
			slog.DebugContext(ctx, "incoming request",
				"method", r.Method,
				"path", r.URL.Path,
				"request_id", requestID,
				"remote_addr", r.RemoteAddr,
				"user_agent", r.UserAgent(),
			)

			lw := &accessLogWriter{ResponseWriter: w}
			next.ServeHTTP(lw, r)

			level := slog.LevelInfo
			if slices.Contains(quietPaths, r.URL.Path) {
				level = slog.LevelDebug
			}
			attrs := []any{
				"status_code", lw.statusCode(),
				"method", r.Method,
				"path", r.URL.Path,
				"duration_ms", time.Since(start).Milliseconds(),
				"request_id", requestID,
				"remote_addr", r.RemoteAddr,
			}
			if proxy, ok := ProxyAddr(r); ok {
				attrs = append(attrs, "proxy_addr", proxy)
			}
			slog.Log(ctx, level, "outgoing response", attrs...)
		})
	}
}
