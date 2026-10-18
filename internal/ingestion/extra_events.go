package ingestion

import (
	"fmt"
	"math"
	"sort"

	"github.com/OCAP2/extension/v5/pkg/core"
	pbv2 "github.com/OCAP2/web/pkg/schemas/protobuf/v2"
)

func radioToProto(e core.RadioEvent) *pbv2.Event {
	r := &pbv2.RadioEvent{Radio: e.Radio, RadioType: e.RadioType, StartEnd: e.StartEnd, Channel: int32(e.Channel), IsAdditional: e.IsAdditional, Frequency: e.Frequency, Code: e.Code}
	if e.SoldierID != nil {
		r.SoldierId = uint32(*e.SoldierID)
	}
	return &pbv2.Event{FrameNum: uint32(e.CaptureFrame), Event: &pbv2.Event_Radio{Radio: r}}
}

func radioPayload(e core.RadioEvent) map[string]any {
	p := map[string]any{"radio": e.Radio, "type": e.RadioType, "action": e.StartEnd, "channel": e.Channel, "additional": e.IsAdditional, "frequency": e.Frequency, "code": e.Code}
	if e.SoldierID != nil {
		p["unitId"] = *e.SoldierID
	}
	return p
}

func (s *Session) hasGeneralEvent(name string) bool {
	for _, e := range s.events {
		if e.eventType == name {
			return true
		}
	}
	return false
}

func (s *Session) appendExtraV1Events(events []any) []any {
	// The addon emits native serverFps/weather general events when its tracking
	// is on. Telemetry-derived samples are only a fallback for when they are
	// absent, otherwise the v1 backup reports each reading twice.
	hasNativeFps := s.hasGeneralEvent("serverFps")
	hasNativeWeather := s.hasGeneralEvent("weather")
	for _, e := range s.radio {
		events = append(events, []any{e.CaptureFrame, "radioTransmission", radioPayload(e)})
	}
	for _, e := range s.telemetry {
		if !hasNativeFps {
			events = append(events, []any{e.CaptureFrame, "serverFps", map[string]any{"fps": e.FpsAverage}})
		}
		w := e.Weather
		if !hasNativeWeather {
			events = append(events, []any{e.CaptureFrame, "weather", map[string]any{"fog": w.Fog, "overcast": w.Overcast, "rain": w.Rain, "windDir": w.WindDir, "windStr": w.WindStr, "gusts": w.Gusts, "waves": w.Waves, "lightnings": w.Lightnings, "humidity": w.Humidity, "moonIntensity": w.MoonIntensity, "moonPhase": w.MoonPhase, "sunOrMoon": w.SunOrMoon}})
		}
	}
	for _, e := range s.aceDeaths {
		events = append(events, []any{e.CaptureFrame, "ace3Death", e})
	}
	for _, e := range s.aceUnconscious {
		events = append(events, []any{e.CaptureFrame, "ace3Unconscious", e})
	}
	sort.SliceStable(events, func(i, j int) bool {
		return events[i].([]any)[0].(core.Frame) < events[j].([]any)[0].(core.Frame)
	})
	return events
}

// Placed objects and projectile display data are derived by the web service.
func (s *Session) derivePlacedObjects() {
	for id, p := range s.placed {
		typeName := p.MarkerIcon
		if typeName == "" {
			if icon := extractFilename(p.MagazineIcon); icon != "" {
				typeName = "magIcons/" + icon
			} else {
				typeName = "Minefield"
			}
		}
		m := core.Marker{MarkerName: fmt.Sprintf("_placed_%d", id), CaptureFrame: p.JoinFrame, MarkerType: typeName, Text: p.DisplayName, OwnerID: int(p.OwnerID), Color: "D96600", Position: p.Position, Direction: p.Direction, Size: "[1,1]", Shape: "ICON", Brush: "Solid", Alpha: 1}
		for _, e := range s.placedEvents {
			if e.PlacedID == id && (e.EventType == "deleted" || e.EventType == "detonated") {
				if !m.IsDeleted || e.CaptureFrame < m.EndFrame {
					m.EndFrame = e.CaptureFrame
					m.IsDeleted = true
				}
			}
		}
		s.markers[m.MarkerName] = &markerRecord{Marker: m}
	}
	for _, e := range s.placedEvents {
		p, ok := s.placed[e.PlacedID]
		if !ok || e.EventType != "hit" || e.HitEntityID == nil {
			continue
		}
		victim, source := uint(*e.HitEntityID), uint(p.OwnerID)
		h := core.HitEvent{CaptureFrame: e.CaptureFrame, VictimSoldierID: &victim, ShooterSoldierID: &source, EventText: p.DisplayName, Distance: float32(math.Hypot(p.Position.X-e.Position.X, p.Position.Y-e.Position.Y))}
		if _, isVehicle := s.vehicles[*e.HitEntityID]; isVehicle {
			h.VictimSoldierID = nil
			h.VictimVehicleID = &victim
		}
		s.HandleHitEvent(h)
	}
}
