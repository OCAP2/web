package server

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/OCAP2/extension/v5/pkg/streaming"
	"github.com/OCAP2/web/internal/ingestion"
	"github.com/OCAP2/web/internal/storage"
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
	if pingInterval <= 0 {
		pingInterval = 30 * time.Second
	}
	if pingTimeout <= 0 {
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

	var session *ingestion.Session
	var v2OutputDir string  // set on start_mission when data dir is available
	var streamingOpID int64 // DB row created at start_mission, updated at finalize
	counts := make(map[string]int)

	writeAck := func(msgType string) {
		ack, _ := json.Marshal(streaming.AckMessage{Type: "ack", For: msgType})
		mu.Lock()
		ws.WriteMessage(websocket.TextMessage, ack)
		mu.Unlock()
	}

	finalizing := false
	finalize := func(tag string) error {
		if session == nil {
			return nil
		}
		finalizing = true
		err := h.finalizeSession(session, tag, v2OutputDir, streamingOpID)
		if err != nil {
			slog.Error("stream: finalization failed", "error", err)
			if streamingOpID > 0 {
				h.repoOperation.UpdateConversionStatus(context.Background(), streamingOpID, ConversionStatusFailed)
			}
			return err
		}
		session = nil
		return nil
	}
	defer func() {
		if session != nil && !finalizing {
			finalize("partial")
		}
	}()
	fail := func(reason string) {
		ws.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseInternalServerErr, reason), time.Now().Add(pingTimeout))
	}

	for {
		_, msg, err := ws.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				slog.Warn("stream: unexpected disconnect, finalizing partial data", "error", err, "counts", counts)

			} else {
				slog.Info("stream: connection closed", "counts", counts)
			}
			return
		}

		var envelope streaming.Envelope
		if err := json.Unmarshal(msg, &envelope); err != nil {
			slog.Warn("stream: invalid message", "error", err)
			continue
		}

		counts[envelope.Type]++

		// All messages except start_mission and end_mission require an active session.
		if session == nil && envelope.Type != streaming.TypeStartMission && envelope.Type != streaming.TypeEndMission {
			slog.Warn("stream: message received before start_mission, ignoring", "type", envelope.Type)
			continue
		}

		switch envelope.Type {
		case streaming.TypeStartMission:
			if session != nil {
				fail("mission already active")
				return
			}
			var payload streaming.StartMissionPayload
			if err := json.Unmarshal(envelope.Payload, &payload); err != nil || payload.Mission == nil || payload.World == nil || payload.Mission.MissionName == "" || payload.World.WorldName == "" || payload.Mission.CaptureDelay <= 0 {
				fail("invalid mission metadata")
				return
			}
			// Additional protocol metadata is optional for historical clients. Keep
			// Mission and World in the shared extension types.
			var framing struct {
				FrameBase uint8 `json:"frameBase"`
			}
			if err := json.Unmarshal(envelope.Payload, &framing); err != nil || framing.FrameBase > 1 {
				fail("invalid frame base")
				return
			}
			if h.setting.Data == "" || h.repoOperation == nil {
				fail("streaming storage unavailable")
				return
			}
			if err := os.MkdirAll(h.setting.Data, 0755); err != nil {
				fail("streaming storage unavailable")
				return
			}
			// Allocate one unique key for the row, v2 directory and legacy backup.
			output, err := os.MkdirTemp(h.setting.Data, ingestion.MakeFilename(payload.Mission.MissionName)+"_*")
			if err != nil {
				fail("streaming storage unavailable")
				return
			}
			cf, err := ingestion.NewChunkFlusher(output, 300)
			if err != nil {
				fail("streaming storage unavailable")
				return
			}
			op := Operation{WorldName: payload.World.WorldName, MissionName: payload.Mission.MissionName, Filename: filepath.Base(output), Date: time.Now().Format("2006-01-02"), Tag: payload.Mission.Tag, StorageFormat: "protobuf", ConversionStatus: ConversionStatusStreaming, SchemaVersion: uint32(storage.SchemaVersionV2)}
			if err := h.repoOperation.Store(context.Background(), &op); err != nil {
				fail("cannot register mission")
				return
			}
			session = ingestion.NewSession()
			session.SetFrameBase(framing.FrameBase)
			session.SetMission(payload.Mission, payload.World)
			session.SetChunkFlusher(cf)
			v2OutputDir = output
			streamingOpID = op.ID
			writeAck(streaming.TypeStartMission)

		case streaming.TypeEndMission:
			tag := ""
			if session != nil && session.Mission() != nil {
				tag = session.Mission().Tag
			}
			// The extension may carry a save-time tag override in the envelope
			// payload. Prefer it over the mission-start tag when non-empty so
			// the operation row and the v2 manifest both reflect it.
			if len(envelope.Payload) > 0 && string(envelope.Payload) != "null" {
				var endPayload struct {
					Tag string `json:"tag"`
				}
				if err := json.Unmarshal(envelope.Payload, &endPayload); err != nil {
					slog.Warn("stream: invalid end_mission payload", "error", err)
				} else if endPayload.Tag != "" {
					tag = endPayload.Tag
					if session != nil && session.Mission() != nil {
						session.Mission().Tag = endPayload.Tag
					}
				}
			}
			slog.Info("stream: mission ended", "counts", counts)
			if err := finalize(tag); err != nil {
				fail("mission could not be saved")
				return
			}
			writeAck(streaming.TypeEndMission)
			return

		default:
			if err := session.HandleMessage(envelope); err != nil {
				slog.Warn("stream: invalid message", "type", envelope.Type, "error", err)
				continue
			}
			if envelope.Type == streaming.TypeTelemetry && streamingOpID > 0 {
				duration := float64(session.FrameCount()) * float64(session.Mission().CaptureDelay)
				if err := h.repoOperation.UpdateStreamingMeta(context.Background(), streamingOpID, duration, session.LivePlayerCount()); err != nil {
					slog.Warn("stream: metadata update failed", "error", err)
				}
			}
		}
	}
}

// finalizeSession writes v2 protobuf + v1 JSON, stores an Operation, and triggers conversion.
// If streamingOpID > 0, updates the existing "streaming" row instead of inserting a new one.
func (h *Handler) finalizeSession(session *ingestion.Session, tag string, v2OutputDir string, streamingOpID int64) error {
	if h.setting.Data == "" {
		return nil
	}

	if tag == "partial" && session.Mission() != nil && session.Mission().Tag != "" {
		tag = session.Mission().Tag + ",partial"
	}

	worldName := ""
	missionName := ""
	if session.World() != nil {
		worldName = session.World().WorldName
	}
	if session.Mission() != nil {
		missionName = session.Mission().MissionName
	}

	// Compute duration from frame count and capture delay.
	captureDelay := float32(1.0)
	if session.Mission() != nil && session.Mission().CaptureDelay > 0 {
		captureDelay = session.Mission().CaptureDelay
	}
	duration := float64(session.FrameCount()) * float64(captureDelay)

	filename := filepath.Base(v2OutputDir)
	if v2OutputDir == "" {
		filename = ingestion.MakeFilename(missionName)
	}
	if err := session.WriteJSONGzNamed(h.setting.Data, filename); err != nil {
		return fmt.Errorf("write JSON.gz: %w", err)
	}

	// Write v2 protobuf (manifest + finalize chunks).
	var chunkCount int
	hasV2 := session.ChunkFlusher() != nil && v2OutputDir != ""
	if hasV2 {
		if err := session.Finalize(v2OutputDir); err != nil {
			slog.Error("stream: v2 finalization failed, falling back to v1 only", "error", err)
			hasV2 = false
		} else {
			chunkCount = int(session.ChunkFlusher().ChunkCount())
		}
	}

	storageFormat := "json"
	schemaVersion := uint32(storage.SchemaVersionV1)
	conversionStatus := ConversionStatusPending

	if hasV2 {
		filename = filepath.Base(v2OutputDir)
		storageFormat = "protobuf"
		schemaVersion = uint32(storage.SchemaVersionV2)
		conversionStatus = ConversionStatusCompleted // v2 is already in final format
	}

	op := Operation{
		WorldName:        worldName,
		MissionName:      missionName,
		MissionDuration:  duration,
		Filename:         filename,
		Date:             time.Now().Format("2006-01-02"),
		Tag:              tag,
		StorageFormat:    storageFormat,
		ConversionStatus: conversionStatus,
		SchemaVersion:    schemaVersion,
		ChunkCount:       chunkCount,
	}
	if ranges := session.FocusRanges(); len(ranges) > 0 {
		start, end := int64(ranges[0].Start), int64(ranges[0].End)
		op.FocusStart = &start
		op.FocusEnd = &end
	}
	ctx := context.TODO()

	if streamingOpID > 0 {
		// Update the existing "streaming" row created at start_mission.
		op.ID = streamingOpID
		if err := h.repoOperation.Update(ctx, &op); err != nil {
			return fmt.Errorf("update operation: %w", err)
		}
	} else {
		if err := h.repoOperation.Store(ctx, &op); err != nil {
			return fmt.Errorf("store operation: %w", err)
		}
	}

	// Finalize owns stats: backfill skips rows where player_count != 0, and
	// UpdateStreamingMeta has already set it from telemetry.
	stats := session.Stats()
	sideComp := make(SideComposition, len(stats.Sides))
	for side, sc := range stats.Sides {
		sideComp[side] = SideCounts{Players: sc.Players, Units: sc.Units, Dead: sc.Dead, Kills: sc.Kills}
	}
	if err := h.repoOperation.UpdateOperationStats(ctx, op.ID,
		stats.PlayerCount, stats.KillCount, stats.PlayerKillCount, sideComp); err != nil {
		slog.Warn("stream: failed to update operation stats", "error", err)
	}

	slog.Info("stream: finalized",
		"id", op.ID,
		"filename", filename,
		"format", storageFormat,
		"schemaVersion", schemaVersion,
		"frames", session.FrameCount(),
		"chunks", chunkCount,
		"duration", duration,
		"tag", tag)

	// Only trigger conversion for v1 JSON (v2 is already complete).
	if !hasV2 {
		if h.conversionTrigger != nil {
			h.conversionTrigger.TriggerConversion(op.ID, op.Filename)
		} else {
			if err := h.repoOperation.UpdateConversionStatus(ctx, op.ID, ConversionStatusCompleted); err != nil {
				slog.Error("stream: failed to mark completed", "error", err)
			}
		}
	}

	return nil
}
