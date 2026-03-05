package server

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	// Allow non-browser clients (no Origin header, e.g. Arma extension).
	// Reject browser requests that include an Origin header.
	CheckOrigin: func(r *http.Request) bool { return r.Header.Get("Origin") == "" },
}

// HandleStream upgrades to WebSocket and processes streaming mission data.
func (h *Handler) HandleStream(w http.ResponseWriter, r *http.Request) {
	if !h.setting.Streaming.Enabled {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if r.URL.Query().Get("secret") != h.setting.Secret {
		w.WriteHeader(http.StatusForbidden)
		return
	}

	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer ws.Close()

	h.streamLoop(ws)
}

func (h *Handler) streamLoop(ws *websocket.Conn) {
	// Ping/pong keepalive
	pingInterval := h.setting.Streaming.PingInterval
	pingTimeout := h.setting.Streaming.PingTimeout
	if pingInterval == 0 {
		pingInterval = 30 * time.Second
	}
	if pingTimeout == 0 {
		pingTimeout = 10 * time.Second
	}

	var mu sync.Mutex
	ws.SetPongHandler(func(string) error {
		return ws.SetReadDeadline(time.Now().Add(pingInterval + pingTimeout))
	})
	ws.SetReadDeadline(time.Now().Add(pingInterval + pingTimeout))

	// Ping ticker
	done := make(chan struct{})
	go func() {
		ticker := time.NewTicker(pingInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				mu.Lock()
				err := ws.WriteControl(websocket.PingMessage, nil, time.Now().Add(pingTimeout))
				mu.Unlock()
				if err != nil {
					slog.Warn("stream: failed to write ping", "error", err)
					return
				}
			case <-done:
				return
			}
		}
	}()
	defer close(done)

	// Message counts for logging
	counts := make(map[string]int)

	for {
		_, msg, err := ws.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				slog.Warn("stream: unexpected disconnect", "error", err, "counts", counts)
			} else {
				slog.Info("stream: connection closed", "counts", counts)
			}
			return
		}

		var envelope struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(msg, &envelope); err != nil {
			slog.Warn("stream: invalid message", "error", err)
			continue
		}

		counts[envelope.Type]++

		switch envelope.Type {
		case "start_mission":
			slog.Info("stream: mission started", "message", string(msg))
			ack, _ := json.Marshal(map[string]string{"type": "ack", "for": "start_mission"})
			mu.Lock()
			ws.WriteMessage(websocket.TextMessage, ack)
			mu.Unlock()

		case "end_mission":
			slog.Info("stream: mission ended", "counts", counts)
			ack, _ := json.Marshal(map[string]string{"type": "ack", "for": "end_mission"})
			mu.Lock()
			ws.WriteMessage(websocket.TextMessage, ack)
			mu.Unlock()
			return
		}
	}
}
