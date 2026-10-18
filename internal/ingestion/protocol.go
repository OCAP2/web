package ingestion

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"

	"github.com/OCAP2/extension/v5/pkg/core"
	"github.com/OCAP2/extension/v5/pkg/streaming"
)

// HandleMessage consumes the extension's shared protocol. Lifecycle messages are
// handled by the HTTP handler, which owns the database and acknowledgements.
func (s *Session) HandleMessage(env streaming.Envelope) error {
	if len(env.Payload) == 0 || string(env.Payload) == "null" {
		return fmt.Errorf("missing %s payload", env.Type)
	}
	if s.frameBase == 0 {
		env.Payload = legacyPayload(env.Type, env.Payload)
	}
	switch env.Type {
	case streaming.TypeAddSoldier:
		return decodePayload(env.Payload, s.HandleAddSoldier, s.frameBase == 1)
	case streaming.TypeAddVehicle:
		return decodePayload(env.Payload, s.HandleAddVehicle, s.frameBase == 1)
	case streaming.TypeAddMarker:
		return decodePayload(env.Payload, s.HandleAddMarker, s.frameBase == 1)
	case streaming.TypeSoldierState:
		return decodePayload(env.Payload, s.HandleSoldierState, s.frameBase == 1)
	case streaming.TypeVehicleState:
		return decodePayload(env.Payload, s.HandleVehicleState, s.frameBase == 1)
	case streaming.TypeMarkerState:
		return decodePayload(env.Payload, s.HandleMarkerState, s.frameBase == 1)
	case streaming.TypeDeleteMarker:
		return decodePayload(env.Payload, func(m core.DeleteMarker) { s.HandleDeleteMarker(m.Name, m.EndFrame) }, s.frameBase == 1)
	case streaming.TypeDeleteSoldier, streaming.TypeDeleteVehicle:
		var deletion struct {
			ID    uint16
			Frame core.Frame
		}
		if err := json.Unmarshal(env.Payload, &deletion); err != nil {
			return err
		}
		if s.frameBase == 1 {
			deletion.Frame = playbackFrame(deletion.Frame)
		}
		if env.Type == streaming.TypeDeleteSoldier {
			if r := s.soldiers[deletion.ID]; r != nil {
				r.Soldier.DeleteFrame = deletion.Frame
				r.deleted = true
			}
		} else if r := s.vehicles[deletion.ID]; r != nil {
			r.Vehicle.DeleteFrame = deletion.Frame
			r.deleted = true
		}
		s.trackFrame(deletion.Frame)
	case streaming.TypeFiredEvent:
		return decodePayload(env.Payload, s.HandleFiredEvent, s.frameBase == 1)
	case streaming.TypeProjectileEvent:
		return decodePayload(env.Payload, s.HandleProjectileEvent, s.frameBase == 1)
	case streaming.TypeKillEvent:
		return decodePayload(env.Payload, s.HandleKillEvent, s.frameBase == 1)
	case streaming.TypeHitEvent:
		return decodePayload(env.Payload, s.HandleHitEvent, s.frameBase == 1)
	case streaming.TypeGeneralEvent:
		return decodePayload(env.Payload, func(e core.GeneralEvent) {
			if s.frameBase == 1 {
				switch e.Name {
				case "inventorySnapshot", "medicalSnapshot", "staminaSnapshot", "radioSnapshot":
					var payload map[string]json.RawMessage
					if json.Unmarshal([]byte(e.Message), &payload) == nil {
						var frame core.Frame
						if json.Unmarshal(payload["diffOf"], &frame) == nil && frame > 0 {
							payload["diffOf"], _ = json.Marshal(playbackFrame(frame))
							data, _ := json.Marshal(payload)
							e.Message = string(data)
						}
					}
				}
			}
			s.HandleGeneralEvent(e)
		}, s.frameBase == 1)
	case streaming.TypeChatEvent:
		return decodePayload(env.Payload, s.HandleChatEvent, s.frameBase == 1)
	case streaming.TypeTelemetry:
		return decodePayload(env.Payload, s.HandleTelemetry, s.frameBase == 1)
	case streaming.TypeTimeState:
		return decodePayload(env.Payload, s.HandleTimeState, s.frameBase == 1)
	case streaming.TypeSectorEvent:
		return decodePayload(env.Payload, func(e core.SectorEvent) {
			s.HandleGeneralEvent(core.GeneralEvent{CaptureFrame: e.CaptureFrame, Name: e.Name,
				ExtraData: map[string]any{"objectType": e.ObjectType, "unitName": e.UnitName, "side": e.Side, "position": []any{e.PosX, e.PosY, e.PosZ}}})
		}, s.frameBase == 1)
	case streaming.TypeEndMissionEvent:
		return decodePayload(env.Payload, func(e core.EndMissionEvent) {
			s.HandleGeneralEvent(core.GeneralEvent{CaptureFrame: e.CaptureFrame, Name: "endMission", Message: e.Message, ExtraData: map[string]any{"side": e.Side}})
		}, s.frameBase == 1)
	case streaming.TypeRadioEvent:
		return decodePayload(env.Payload, func(e core.RadioEvent) {
			s.radio = append(s.radio, e)
			s.trackFrame(e.CaptureFrame)
		}, s.frameBase == 1)
	case streaming.TypeAce3Death:
		return decodePayload(env.Payload, func(e core.Ace3DeathEvent) { s.aceDeaths = append(s.aceDeaths, e); s.trackFrame(e.CaptureFrame) }, s.frameBase == 1)
	case streaming.TypeAce3Unconscious:
		return decodePayload(env.Payload, func(e core.Ace3UnconsciousEvent) {
			s.aceUnconscious = append(s.aceUnconscious, e)
			s.trackFrame(e.CaptureFrame)
		}, s.frameBase == 1)
	case streaming.TypeAddPlaced:
		return decodePayload(env.Payload, func(e core.PlacedObject) { s.placed[e.ID] = e; s.trackFrame(e.JoinFrame) }, s.frameBase == 1)
	case streaming.TypePlacedEvent:
		return decodePayload(env.Payload, func(e core.PlacedObjectEvent) {
			s.placedEvents = append(s.placedEvents, e)
			s.trackFrame(e.CaptureFrame)
		}, s.frameBase == 1)
	case streaming.TypeMissionFocusStart, streaming.TypeMissionFocusEnd:
		var p struct{ Frame core.Frame }
		if err := json.Unmarshal(env.Payload, &p); err != nil {
			return err
		}
		if s.frameBase == 1 {
			p.Frame = playbackFrame(p.Frame)
		}
		if env.Type == streaming.TypeMissionFocusStart {
			s.focusStart = &p.Frame
		} else if s.focusStart != nil && p.Frame > *s.focusStart {
			s.focusRanges = append(s.focusRanges, core.FocusRange{Start: *s.focusStart, End: p.Frame})
			s.focusStart = nil
		}
		s.trackFrame(p.Frame)
	default:
		return fmt.Errorf("unknown streaming message type %q", env.Type)
	}
	return nil
}

func decodePayload[T any](data json.RawMessage, handle func(T), oneBased bool) error {
	if len(data) == 0 || string(data) == "null" {
		return fmt.Errorf("missing payload")
	}
	var p T
	if err := json.Unmarshal(data, &p); err != nil {
		return err
	}
	if oneBased {
		normalizeFrames(reflect.ValueOf(&p).Elem())
	}
	handle(p)
	return nil
}

func (s *Session) SetFrameBase(base uint8) { s.frameBase = base }

// Early proxy versions used Frame instead of FrameNum for trajectory samples,
// and -1 for a marker with no end. Retain those wire shapes at the boundary.
func legacyPayload(kind string, data json.RawMessage) json.RawMessage {
	if kind != streaming.TypeAddMarker && kind != streaming.TypeProjectileEvent {
		return data
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(data, &fields) != nil {
		return data
	}
	for key, value := range fields {
		if kind == streaming.TypeAddMarker && strings.EqualFold(key, "EndFrame") && string(value) == "-1" {
			fields[key] = json.RawMessage("0")
		}
		if kind == streaming.TypeProjectileEvent && strings.EqualFold(key, "Trajectory") {
			var points []map[string]json.RawMessage
			if json.Unmarshal(value, &points) == nil {
				for _, p := range points {
					if old, ok := p["Frame"]; ok {
						p["FrameNum"] = old
						delete(p, "Frame")
					}
				}
				fields[key], _ = json.Marshal(points)
			}
		}
	}
	result, err := json.Marshal(fields)
	if err != nil {
		return data
	}
	return result
}

func playbackFrame(frame core.Frame) core.Frame {
	if frame > 0 {
		return frame - 1
	}
	return 0
}

// The shared extension Frame type is one-based. Playback files are zero-based.
// Walk only typed fields, leaving arbitrary JSON event payloads untouched.
func normalizeFrames(v reflect.Value) {
	if v.Type() == reflect.TypeFor[core.Frame]() {
		v.SetUint(uint64(playbackFrame(core.Frame(v.Uint()))))
		return
	}
	switch v.Kind() {
	case reflect.Struct:
		for i := 0; i < v.NumField(); i++ {
			if v.Field(i).CanSet() {
				normalizeFrames(v.Field(i))
			}
		}
	case reflect.Slice:
		for i := 0; i < v.Len(); i++ {
			normalizeFrames(v.Index(i))
		}
	}
}

func (s *Session) recordChunkError(err error) {
	if s.chunkErr == nil {
		s.chunkErr = err
	}
}

// FocusRanges returns completed ranges; an unfinished range is closed on save.
func (s *Session) FocusRanges() []core.FocusRange {
	ranges := append([]core.FocusRange(nil), s.focusRanges...)
	if s.focusStart != nil && s.frameCount > *s.focusStart {
		ranges = append(ranges, core.FocusRange{Start: *s.focusStart, End: s.frameCount})
	}
	return ranges
}
