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

	"github.com/OCAP2/extension/v5/pkg/core"
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

	var session *ingestion.Session
	var v2OutputDir string // set on start_mission when data dir is available
	var streamingOpID int64 // DB row created at start_mission, updated at finalize
	counts := make(map[string]int)

	writeAck := func(msgType string) {
		ack, _ := json.Marshal(streaming.AckMessage{Type: "ack", For: msgType})
		mu.Lock()
		ws.WriteMessage(websocket.TextMessage, ack)
		mu.Unlock()
	}

	finalize := func(tag string) {
		if session == nil {
			return
		}
		if err := h.finalizeSession(session, tag, v2OutputDir, streamingOpID); err != nil {
			slog.Error("stream: finalization failed", "error", err)
		}
	}

	for {
		_, msg, err := ws.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				slog.Warn("stream: unexpected disconnect, finalizing partial data", "error", err, "counts", counts)
				finalize("partial")
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
			var payload streaming.StartMissionPayload
			if err := json.Unmarshal(envelope.Payload, &payload); err != nil {
				slog.Warn("stream: invalid start_mission payload", "error", err)
				continue
			}
			session = ingestion.NewSession()
			session.SetMission(payload.Mission, payload.World)

			// Set up v2 protobuf output directory and chunk flusher.
			if h.setting.Data != "" {
				v2OutputDir = filepath.Join(h.setting.Data, ingestion.MakeFilename(payload.Mission.MissionName))
				if err := os.MkdirAll(v2OutputDir, 0755); err != nil {
					slog.Error("stream: failed to create v2 output dir", "error", err)
				} else {
					cf, err := ingestion.NewChunkFlusher(v2OutputDir, 300)
					if err != nil {
						slog.Error("stream: failed to create chunk flusher", "error", err)
					} else {
						session.SetChunkFlusher(cf)
					}
				}
			}

			slog.Info("stream: mission started",
				"mission", payload.Mission.MissionName,
				"world", payload.World.WorldName)

			// Insert a "streaming" operation so it appears in the operations list.
			filename := ingestion.MakeFilename(payload.Mission.MissionName)
			op := Operation{
				WorldName:        payload.World.WorldName,
				MissionName:      payload.Mission.MissionName,
				Filename:         filename,
				Date:             time.Now().Format("2006-01-02"),
				Tag:              payload.Mission.Tag,
				StorageFormat:    "protobuf",
				ConversionStatus: ConversionStatusStreaming,
				SchemaVersion:    uint32(storage.SchemaVersionV2),
			}
			if err := h.repoOperation.Store(context.TODO(), &op); err != nil {
				slog.Error("stream: failed to store streaming operation", "error", err)
			} else {
				streamingOpID = op.ID
			}

			writeAck(streaming.TypeStartMission)

		case streaming.TypeEndMission:
			tag := ""
			if session != nil && session.Mission() != nil {
				tag = session.Mission().Tag
			}
			slog.Info("stream: mission ended", "counts", counts)
			finalize(tag)
			writeAck(streaming.TypeEndMission)
			return

		case streaming.TypeAddSoldier:
			var sol core.Soldier
			if err := json.Unmarshal(envelope.Payload, &sol); err != nil {
				slog.Warn("stream: invalid add_soldier", "error", err)
				continue
			}
			session.HandleAddSoldier(sol)

		case streaming.TypeSoldierState:
			var st core.SoldierState
			if err := json.Unmarshal(envelope.Payload, &st); err != nil {
				slog.Warn("stream: invalid soldier_state", "error", err)
				continue
			}
			session.HandleSoldierState(st)

		case streaming.TypeAddVehicle:
			var veh core.Vehicle
			if err := json.Unmarshal(envelope.Payload, &veh); err != nil {
				slog.Warn("stream: invalid add_vehicle", "error", err)
				continue
			}
			session.HandleAddVehicle(veh)

		case streaming.TypeVehicleState:
			var st core.VehicleState
			if err := json.Unmarshal(envelope.Payload, &st); err != nil {
				slog.Warn("stream: invalid vehicle_state", "error", err)
				continue
			}
			session.HandleVehicleState(st)

		case streaming.TypeAddMarker:
			var m core.Marker
			if err := json.Unmarshal(envelope.Payload, &m); err != nil {
				slog.Warn("stream: invalid add_marker", "error", err)
				continue
			}
			session.HandleAddMarker(m)

		case streaming.TypeMarkerState:
			var st core.MarkerState
			if err := json.Unmarshal(envelope.Payload, &st); err != nil {
				slog.Warn("stream: invalid marker_state", "error", err)
				continue
			}
			session.HandleMarkerState(st)

		case streaming.TypeDeleteMarker:
			var dm core.DeleteMarker
			if err := json.Unmarshal(envelope.Payload, &dm); err != nil {
				slog.Warn("stream: invalid delete_marker", "error", err)
				continue
			}
			session.HandleDeleteMarker(dm.Name, dm.EndFrame)

		case streaming.TypeFiredEvent:
			var fe core.FiredEvent
			if err := json.Unmarshal(envelope.Payload, &fe); err != nil {
				slog.Warn("stream: invalid fired_event", "error", err)
				continue
			}
			session.HandleFiredEvent(fe)

		case streaming.TypeKillEvent:
			var evt core.KillEvent
			if err := json.Unmarshal(envelope.Payload, &evt); err != nil {
				slog.Warn("stream: invalid kill_event", "error", err)
				continue
			}
			session.HandleKillEvent(evt)

		case streaming.TypeHitEvent:
			var evt core.HitEvent
			if err := json.Unmarshal(envelope.Payload, &evt); err != nil {
				slog.Warn("stream: invalid hit_event", "error", err)
				continue
			}
			session.HandleHitEvent(evt)

		case streaming.TypeGeneralEvent:
			var evt core.GeneralEvent
			if err := json.Unmarshal(envelope.Payload, &evt); err != nil {
				slog.Warn("stream: invalid general_event", "error", err)
				continue
			}
			session.HandleGeneralEvent(evt)

		case streaming.TypeChatEvent:
			var evt core.ChatEvent
			if err := json.Unmarshal(envelope.Payload, &evt); err != nil {
				slog.Warn("stream: invalid chat_event", "error", err)
				continue
			}
			session.HandleChatEvent(evt)

		case streaming.TypeTelemetry:
			var evt core.TelemetryEvent
			if err := json.Unmarshal(envelope.Payload, &evt); err != nil {
				slog.Warn("stream: invalid telemetry", "error", err)
				continue
			}
			session.HandleTelemetry(evt)

			// Update operation metadata so the operations list stays current.
			if streamingOpID > 0 {
				captureDelay := float64(1.0)
				if session.Mission() != nil && session.Mission().CaptureDelay > 0 {
					captureDelay = float64(session.Mission().CaptureDelay)
				}
				duration := float64(session.FrameCount()) * captureDelay
				playerCount := int(evt.GlobalCounts.PlayersConnected)
				if err := h.repoOperation.UpdateStreamingMeta(context.TODO(), streamingOpID, duration, playerCount); err != nil {
					slog.Warn("stream: failed to update streaming meta", "error", err)
				}
			}

		case streaming.TypeProjectileEvent:
			var evt core.ProjectileEvent
			if err := json.Unmarshal(envelope.Payload, &evt); err != nil {
				slog.Warn("stream: invalid projectile_event", "error", err)
				continue
			}
			session.HandleProjectileEvent(evt)

		case streaming.TypeTimeState:
			var ts core.TimeState
			if err := json.Unmarshal(envelope.Payload, &ts); err != nil {
				slog.Warn("stream: invalid time_state", "error", err)
				continue
			}
			session.HandleTimeState(ts)

		default:
			slog.Warn("stream: unknown message type", "type", envelope.Type)
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

	// Always write v1 JSON.gz as backup/fallback.
	v1Filename, err := session.WriteJSONGz(h.setting.Data)
	if err != nil {
		return fmt.Errorf("write JSON.gz: %w", err)
	}

	// Use v2 output directory name as filename if v2 succeeded, otherwise v1.
	filename := v1Filename
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
		sideComp[side] = SideCounts{Players: sc.Players, Units: sc.Units, Dead: sc.Dead}
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
