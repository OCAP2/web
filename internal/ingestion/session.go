// Package ingestion accumulates streaming mission data and produces
// v1 JSON recordings for the conversion pipeline.
package ingestion

import (
	"compress/gzip"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/OCAP2/extension/v5/pkg/core"
)

// soldierRecord tracks a soldier and their accumulated states/events.
type soldierRecord struct {
	Soldier     core.Soldier
	States      []core.SoldierState
	FiredEvents []core.FiredEvent
	// bulletFireLines is populated at write time from session.projectiles.
	bulletFireLines []core.ProjectileEvent
}

// vehicleRecord tracks a vehicle and their accumulated states.
type vehicleRecord struct {
	Vehicle core.Vehicle
	States  []core.VehicleState
}

// markerRecord tracks a marker and its accumulated states.
type markerRecord struct {
	Marker core.Marker
	States []core.MarkerState
}

// eventRecord stores a generic event with its type for serialization.
type eventRecord struct {
	eventType string
	frame     uint
	kill      *core.KillEvent
	hit       *core.HitEvent
	general   *core.GeneralEvent
	chat      *core.ChatEvent
}

// Session accumulates streaming mission data in memory.
// All methods are called sequentially from a single goroutine (the WebSocket read loop).
type Session struct {
	mission *core.Mission
	world   *core.World

	soldiers    map[uint16]*soldierRecord
	vehicles    map[uint16]*vehicleRecord
	markers     map[string]*markerRecord
	markersByID map[uint]*markerRecord // reverse index for MarkerState routing

	events      []eventRecord
	projectiles []core.ProjectileEvent // raw 1:1 storage, derived at write time
	telemetry   []core.TelemetryEvent
	times       []core.TimeState

	frameCount uint // highest CaptureFrame seen + 1

	projectileMarkerSeq uint // counter for unique projectile marker names
	projectilesDerived  bool // guard against double-derivation

	// v2 chunk flusher (optional, nil for v1-only sessions).
	chunkFlusher *ChunkFlusher
}

// NewSession creates an empty ingestion session.
func NewSession() *Session {
	return &Session{
		soldiers:    make(map[uint16]*soldierRecord),
		vehicles:    make(map[uint16]*vehicleRecord),
		markers:     make(map[string]*markerRecord),
		markersByID: make(map[uint]*markerRecord),
	}
}

// Mission returns the stored mission metadata.
func (s *Session) Mission() *core.Mission { return s.mission }

// World returns the stored world metadata.
func (s *Session) World() *core.World { return s.world }

// FrameCount returns the number of frames accumulated.
func (s *Session) FrameCount() uint { return s.frameCount }

type SideStats struct {
	Players int
	Units   int
	Dead    int
}

type SessionStats struct {
	PlayerCount     int
	KillCount       int
	PlayerKillCount int
	Sides           map[string]SideStats
}

// Stats derives final operation stats from accumulated session state.
// Players are deduplicated by name to handle respawn / JIP.
func (s *Session) Stats() SessionStats {
	stats := SessionStats{Sides: make(map[string]SideStats)}

	seenPlayer := make(map[string]bool)
	seenPlayerSide := make(map[string]map[string]bool)
	playerIDs := make(map[uint16]bool)
	idIsPlayer := make(map[uint16]bool)

	for id, rec := range s.soldiers {
		side := normalizeSide(rec.Soldier.Side)
		if rec.Soldier.IsPlayer {
			idIsPlayer[id] = true
			name := rec.Soldier.UnitName
			if name == "" || !seenPlayer[name] {
				seenPlayer[name] = true
				stats.PlayerCount++
			}
			playerIDs[id] = true
		}
		if side != "" && side != "UNKNOWN" && side != "GLOBAL" {
			sc := stats.Sides[side]
			sc.Units++
			if rec.Soldier.IsPlayer {
				name := rec.Soldier.UnitName
				if name == "" {
					sc.Players++
				} else {
					if seenPlayerSide[name] == nil {
						seenPlayerSide[name] = make(map[string]bool)
					}
					if !seenPlayerSide[name][side] {
						seenPlayerSide[name][side] = true
						sc.Players++
					}
				}
			}
			stats.Sides[side] = sc
		}
	}

	for _, evt := range s.events {
		if evt.kill == nil {
			continue
		}
		stats.KillCount++
		if evt.kill.KillerSoldierID != nil && idIsPlayer[uint16(*evt.kill.KillerSoldierID)] {
			stats.PlayerKillCount++
		}
		if evt.kill.VictimSoldierID != nil {
			vid := uint16(*evt.kill.VictimSoldierID)
			if rec, ok := s.soldiers[vid]; ok {
				side := normalizeSide(rec.Soldier.Side)
				if side != "" && side != "UNKNOWN" && side != "GLOBAL" {
					sc := stats.Sides[side]
					sc.Dead++
					stats.Sides[side] = sc
				}
			}
		}
	}
	return stats
}

func normalizeSide(s string) string {
	return strings.ToUpper(strings.TrimSpace(s))
}

// [objectType, unitName, side, [posX, posY, posZ]?]
func capturedDataArray(ge *core.GeneralEvent) []any {
	parts := []any{
		stringFromExtra(ge.ExtraData, "objectType"),
		stringFromExtra(ge.ExtraData, "unitName"),
		stringFromExtra(ge.ExtraData, "side"),
	}
	if pos, ok := positionFromExtra(ge.ExtraData, "position"); ok {
		parts = append(parts, pos)
	}
	return parts
}

// [unitName, unitSide, flagSide]
func capturedFlagDataArray(ge *core.GeneralEvent) []any {
	return []any{
		stringFromExtra(ge.ExtraData, "unitName"),
		stringFromExtra(ge.ExtraData, "unitSide"),
		stringFromExtra(ge.ExtraData, "flagSide"),
	}
}

func stringFromExtra(extra map[string]any, key string) string {
	if v, ok := extra[key].(string); ok {
		return v
	}
	return ""
}

func positionFromExtra(extra map[string]any, key string) ([]any, bool) {
	v, ok := extra[key]
	if !ok {
		return nil, false
	}
	arr, ok := v.([]any)
	if !ok || len(arr) < 2 {
		return nil, false
	}
	return arr, true
}

// SetMission stores mission and world metadata from start_mission.
func (s *Session) SetMission(mission *core.Mission, world *core.World) {
	s.mission = mission
	s.world = world
}

// SetChunkFlusher attaches a v2 chunk flusher to this session.
// When set, state updates are also routed to the flusher for incremental writing.
func (s *Session) SetChunkFlusher(cf *ChunkFlusher) {
	s.chunkFlusher = cf
}

// ChunkFlusher returns the attached chunk flusher, or nil.
func (s *Session) ChunkFlusher() *ChunkFlusher {
	return s.chunkFlusher
}

// Finalize flushes remaining chunks and writes the v2 manifest.
// outputDir is the directory where chunks/ and manifest files are written.
func (s *Session) Finalize(outputDir string) error {
	if s.chunkFlusher == nil {
		return nil
	}
	if err := s.chunkFlusher.Flush(); err != nil {
		return fmt.Errorf("flush final chunk: %w", err)
	}
	return WriteV2Manifest(s, outputDir, s.chunkFlusher.ChunkCount())
}

// HandleAddSoldier registers a new soldier entity.
func (s *Session) HandleAddSoldier(sol core.Soldier) {
	s.soldiers[sol.ID] = &soldierRecord{Soldier: sol}
}

// HandleSoldierState appends a state snapshot for a soldier.
func (s *Session) HandleSoldierState(state core.SoldierState) {
	rec, ok := s.soldiers[state.SoldierID]
	if !ok {
		rec = &soldierRecord{Soldier: core.Soldier{ID: state.SoldierID}}
		s.soldiers[state.SoldierID] = rec
	}
	rec.States = append(rec.States, state)
	s.trackFrame(state.CaptureFrame)

	if s.chunkFlusher != nil {
		s.chunkFlusher.AddSoldierState(uint32(state.CaptureFrame), SoldierStateToProto(state))
	}
}

// HandleAddVehicle registers a new vehicle entity.
func (s *Session) HandleAddVehicle(veh core.Vehicle) {
	s.vehicles[veh.ID] = &vehicleRecord{Vehicle: veh}
}

// HandleVehicleState appends a state snapshot for a vehicle.
func (s *Session) HandleVehicleState(state core.VehicleState) {
	rec, ok := s.vehicles[state.VehicleID]
	if !ok {
		rec = &vehicleRecord{Vehicle: core.Vehicle{ID: state.VehicleID}}
		s.vehicles[state.VehicleID] = rec
	}
	rec.States = append(rec.States, state)
	s.trackFrame(state.CaptureFrame)

	if s.chunkFlusher != nil {
		s.chunkFlusher.AddVehicleState(uint32(state.CaptureFrame), VehicleStateToProto(state))
	}
}

// HandleAddMarker registers a new marker.
func (s *Session) HandleAddMarker(marker core.Marker) {
	rec := &markerRecord{Marker: marker}
	s.markers[marker.MarkerName] = rec
	s.markersByID[marker.ID] = rec
}

// HandleMarkerState appends a state snapshot for a marker, routed by MarkerID.
func (s *Session) HandleMarkerState(state core.MarkerState) {
	rec, ok := s.markersByID[state.MarkerID]
	if !ok {
		return
	}
	rec.States = append(rec.States, state)
}

// HandleDeleteMarker sets the end frame for a marker.
func (s *Session) HandleDeleteMarker(name string, endFrame uint) {
	rec, ok := s.markers[name]
	if !ok {
		return
	}
	rec.Marker.EndFrame = int(endFrame)
	rec.Marker.IsDeleted = true
}

// HandleFiredEvent appends a fired event to the corresponding soldier.
func (s *Session) HandleFiredEvent(fe core.FiredEvent) {
	rec, ok := s.soldiers[fe.SoldierID]
	if !ok {
		return
	}
	rec.FiredEvents = append(rec.FiredEvents, fe)
	s.trackFrame(fe.CaptureFrame)
}

// HandleKillEvent stores a kill event.
func (s *Session) HandleKillEvent(evt core.KillEvent) {
	s.events = append(s.events, eventRecord{
		eventType: "killed",
		frame:     evt.CaptureFrame,
		kill:      &evt,
	})
	s.trackFrame(evt.CaptureFrame)
}

// HandleProjectileEvent stores a raw projectile event for later derivation.
// Raw events are stored 1:1; fire lines, markers, and hit events are derived at write time.
func (s *Session) HandleProjectileEvent(evt core.ProjectileEvent) {
	s.projectiles = append(s.projectiles, evt)
	s.trackFrame(evt.CaptureFrame)
}

// HandleHitEvent stores a hit event.
func (s *Session) HandleHitEvent(evt core.HitEvent) {
	s.events = append(s.events, eventRecord{
		eventType: "hit",
		frame:     evt.CaptureFrame,
		hit:       &evt,
	})
	s.trackFrame(evt.CaptureFrame)
}

// HandleGeneralEvent stores a general event.
func (s *Session) HandleGeneralEvent(evt core.GeneralEvent) {
	s.events = append(s.events, eventRecord{
		eventType: evt.Name,
		frame:     evt.CaptureFrame,
		general:   &evt,
	})
	s.trackFrame(evt.CaptureFrame)
}

// HandleChatEvent stores a chat event.
func (s *Session) HandleChatEvent(evt core.ChatEvent) {
	s.events = append(s.events, eventRecord{
		eventType: "chat",
		frame:     evt.CaptureFrame,
		chat:      &evt,
	})
	s.trackFrame(evt.CaptureFrame)
}

// HandleTelemetry stores a telemetry snapshot (FPS, entity counts, scripts, weather, player network).
func (s *Session) HandleTelemetry(evt core.TelemetryEvent) {
	s.telemetry = append(s.telemetry, evt)
	s.trackFrame(evt.CaptureFrame)
}

// HandleTimeState appends a time synchronization record.
func (s *Session) HandleTimeState(ts core.TimeState) {
	s.times = append(s.times, ts)
	s.trackFrame(ts.CaptureFrame)
}

// deriveProjectileData processes raw projectile events into fire lines, markers,
// and hit events. Called once at write time — never during ingestion.
func (s *Session) deriveProjectileData() {
	if s.projectilesDerived {
		return
	}
	s.projectilesDerived = true

	for _, evt := range s.projectiles {
		if !isProjectileMarker(evt.SimulationType) {
			// Bullets → fire lines on the soldier entity (need >= 2 trajectory points).
			if len(evt.Trajectory) >= 2 {
				if rec, ok := s.soldiers[evt.FirerObjectID]; ok {
					rec.bulletFireLines = append(rec.bulletFireLines, evt)
				}
			}
		} else {
			// Non-bullet projectiles → moving markers.
			s.addProjectileMarker(evt)
		}

		// All projectiles with hits → hit events.
		if len(evt.Hits) > 0 {
			s.addProjectileHits(evt)
		}
	}
}

// addProjectileMarker creates a moving marker from a non-bullet projectile.
// Matches the extension's builder.go logic for marker creation.
func (s *Session) addProjectileMarker(evt core.ProjectileEvent) {
	if len(evt.Trajectory) == 0 {
		return
	}

	// Determine icon and color.
	iconFilename := extractFilename(evt.MagazineIcon)
	var markerType, color string
	if iconFilename != "" {
		markerType = "magIcons/" + iconFilename
		color = "ColorWhite"
	} else {
		markerType = "mil_triangle"
		color = "ColorRed"
	}

	// Determine text.
	var text string
	switch {
	case evt.VehicleObjectID != nil && *evt.VehicleObjectID != evt.FirerObjectID:
		vehicleName := ""
		if vr, ok := s.vehicles[*evt.VehicleObjectID]; ok {
			vehicleName = vr.Vehicle.DisplayName
		}
		text = fmt.Sprintf("%s %s - %s", vehicleName, evt.MuzzleDisplay, evt.MagazineDisplay)
	case evt.SimulationType == "shotGrenade":
		text = evt.MagazineDisplay
	default:
		text = fmt.Sprintf("%s - %s", evt.MuzzleDisplay, evt.MagazineDisplay)
	}

	// EndFrame is the last trajectory point's frame.
	endFrame := int(evt.Trajectory[len(evt.Trajectory)-1].Frame)

	// Generate unique marker name.
	s.projectileMarkerSeq++
	name := fmt.Sprintf("_projectile_%d", s.projectileMarkerSeq)

	firstTP := evt.Trajectory[0]
	marker := core.Marker{
		CaptureFrame: firstTP.Frame,
		EndFrame:     endFrame,
		MarkerName:   name,
		MarkerType:   markerType,
		Text:         text,
		OwnerID:      int(evt.FirerObjectID),
		Color:        color,
		Size:         "[1,1]",
		Shape:        "ICON",
		Alpha:        1.0,
		Brush:        "Solid",
		Position:     firstTP.Position,
	}

	rec := &markerRecord{Marker: marker}
	for i := 1; i < len(evt.Trajectory); i++ {
		tp := evt.Trajectory[i]
		rec.States = append(rec.States, core.MarkerState{
			CaptureFrame: tp.Frame,
			Position:     tp.Position,
			Alpha:        1.0,
		})
	}

	s.markers[name] = rec
}

// addProjectileHits extracts hit events from a projectile.
// Matches the extension's builder.go hit event extraction.
func (s *Session) addProjectileHits(evt core.ProjectileEvent) {
	weaponName := evt.MuzzleDisplay
	if weaponName == "" {
		weaponName = evt.WeaponDisplay
	}
	eventText := formatWeaponText(weaponName, evt.MagazineDisplay)

	var startPos core.Position3D
	if len(evt.Trajectory) > 0 {
		startPos = evt.Trajectory[0].Position
	}

	shooterID := uint(evt.FirerObjectID)

	for _, hit := range evt.Hits {
		dx := float64(startPos.X - hit.Position.X)
		dy := float64(startPos.Y - hit.Position.Y)
		dist := float32(math.Sqrt(dx*dx + dy*dy))

		hitEvt := core.HitEvent{
			CaptureFrame:     hit.CaptureFrame,
			ShooterSoldierID: &shooterID,
			EventText:        eventText,
			Distance:         dist,
			WeaponName:       weaponName,
			WeaponMagazine:   evt.MagazineDisplay,
		}

		if hit.SoldierID != nil {
			v := uint(*hit.SoldierID)
			hitEvt.VictimSoldierID = &v
		}
		if hit.VehicleID != nil {
			v := uint(*hit.VehicleID)
			hitEvt.VictimVehicleID = &v
		}
		if evt.VehicleObjectID != nil {
			v := uint(*evt.VehicleObjectID)
			hitEvt.ShooterVehicleID = &v
		}

		s.events = append(s.events, eventRecord{
			eventType: "hit",
			frame:     hit.CaptureFrame,
			hit:       &hitEvt,
		})
		s.trackFrame(hit.CaptureFrame)
	}
}

// projectileEndPos returns the best end position for a projectile fire line:
// last hit position if any, otherwise last trajectory point.
func projectileEndPos(pe core.ProjectileEvent) core.Position3D {
	if len(pe.Hits) > 0 {
		return pe.Hits[len(pe.Hits)-1].Position
	}
	if len(pe.Trajectory) > 0 {
		return pe.Trajectory[len(pe.Trajectory)-1].Position
	}
	return core.Position3D{}
}

// isProjectileMarker returns true if the projectile should be rendered as a
// moving marker rather than a fire-line. Bullets are fire-lines; everything
// else (grenades, rockets, missiles, shells, etc.) becomes a marker.
func isProjectileMarker(sim string) bool {
	return sim != "shotBullet"
}

// extractFilename returns the last path component from a file path.
// Handles both forward and backslash separators (Arma uses backslashes).
func extractFilename(path string) string {
	for i := len(path) - 1; i >= 0; i-- {
		if path[i] == '/' || path[i] == '\\' {
			return path[i+1:]
		}
	}
	return path
}

// formatWeaponText formats weapon and magazine into display text: "weapon [magazine]".
func formatWeaponText(weapon, magazine string) string {
	if magazine == "" {
		return weapon
	}
	return weapon + " [" + magazine + "]"
}

// trackFrame updates frameCount to be max(current, frame+1).
func (s *Session) trackFrame(frame uint) {
	if frame+1 > s.frameCount {
		s.frameCount = frame + 1
	}
}

// --- V1 JSON Serialization ---
// Produces the same format as the extension's internal/storage/memory/export/v1/builder.go
// which parser_v1.go in internal/storage/ is proven to parse.

// ToV1JSON converts accumulated session data to the v1 JSON map structure.
func (s *Session) ToV1JSON() map[string]any {
	// Derive fire lines, markers, and hit events from raw projectile data.
	s.deriveProjectileData()

	result := map[string]any{
		"worldName":    "",
		"missionName":  "",
		"endFrame":     s.frameCount,
		"captureDelay": float32(0),
		"entities":     s.entitiesToV1(),
		"events":       s.eventsToV1(),
		"Markers":      s.markersToV1(),
		"times":        s.timesToV1(),
	}

	if s.world != nil {
		result["worldName"] = s.world.WorldName
	}
	if s.mission != nil {
		result["missionName"] = s.mission.MissionName
		result["captureDelay"] = s.mission.CaptureDelay
		if s.mission.ExtensionVersion != "" {
			result["extensionVersion"] = s.mission.ExtensionVersion
		}
		if s.mission.AddonVersion != "" {
			result["addonVersion"] = s.mission.AddonVersion
		}
		if s.mission.ExtensionBuild != "" {
			result["extensionBuild"] = s.mission.ExtensionBuild
		}
		if s.mission.Author != "" {
			result["missionAuthor"] = s.mission.Author
		}
		if s.mission.Tag != "" {
			result["tags"] = s.mission.Tag
		}
	}

	return result
}

// entitiesToV1 converts soldiers and vehicles to v1 entity format.
// Matches the extension's v1 builder: entities array indexed by ID.
func (s *Session) entitiesToV1() []any {
	// Find max entity ID to size array correctly (JS frontend uses entities[id])
	var maxID uint16
	for _, rec := range s.soldiers {
		if rec.Soldier.ID > maxID {
			maxID = rec.Soldier.ID
		}
	}
	for _, rec := range s.vehicles {
		if rec.Vehicle.ID > maxID {
			maxID = rec.Vehicle.ID
		}
	}

	if len(s.soldiers) == 0 && len(s.vehicles) == 0 {
		return []any{}
	}

	entities := make([]any, maxID+1)
	// Fill with placeholder maps for empty slots
	for i := range entities {
		entities[i] = map[string]any{
			"id":            i,
			"type":          "",
			"name":          "",
			"side":          "",
			"isPlayer":      0,
			"startFrameNum": 0,
			"positions":     []any{},
			"framesFired":   []any{},
		}
	}

	for _, rec := range s.soldiers {
		sol := rec.Soldier

		positions := make([][]any, 0, len(rec.States))
		for _, st := range rec.States {
			var inVehicleID any = 0
			if st.InVehicleObjectID != nil {
				inVehicleID = *st.InVehicleObjectID
			}

			pos := []any{
				[]float64{st.Position.X, st.Position.Y, st.Position.Z},
				st.Bearing,
				st.Lifestate,
				inVehicleID,
				st.UnitName,
				boolToInt(st.IsPlayer),
				st.CurrentRole,
			}
			positions = append(positions, pos)
		}

		firedFrames := make([][]any, 0, len(rec.FiredEvents)+len(rec.bulletFireLines))
		for _, fe := range rec.FiredEvents {
			firedFrames = append(firedFrames, []any{
				fe.CaptureFrame,
				[]float64{fe.EndPos.X, fe.EndPos.Y, fe.EndPos.Z},
			})
		}
		for _, pe := range rec.bulletFireLines {
			endPos := projectileEndPos(pe)
			firedFrames = append(firedFrames, []any{
				pe.CaptureFrame,
				[]float64{endPos.X, endPos.Y, endPos.Z},
			})
		}

		entity := map[string]any{
			"id":            sol.ID,
			"type":          "unit",
			"name":          sol.UnitName,
			"side":          sol.Side,
			"group":         sol.GroupID,
			"isPlayer":      boolToInt(sol.IsPlayer),
			"role":          sol.RoleDescription,
			"startFrameNum": sol.JoinFrame,
			"positions":     positions,
			"framesFired":   firedFrames,
		}
		entities[sol.ID] = entity
	}

	for _, rec := range s.vehicles {
		veh := rec.Vehicle

		positions := make([][]any, 0, len(rec.States))
		for _, st := range rec.States {
			// Parse crew JSON string into actual JSON array
			var crew any
			if st.Crew != "" {
				if err := json.Unmarshal([]byte(st.Crew), &crew); err != nil {
					crew = []any{}
				}
			} else {
				crew = []any{}
			}

			pos := []any{
				[]float64{st.Position.X, st.Position.Y, st.Position.Z},
				st.Bearing,
				boolToInt(st.IsAlive),
				crew,
				[]uint{st.CaptureFrame, st.CaptureFrame},
			}
			positions = append(positions, pos)
		}

		entity := map[string]any{
			"id":            veh.ID,
			"type":          "vehicle",
			"name":          veh.DisplayName,
			"side":          "UNKNOWN",
			"class":         veh.OcapType,
			"isPlayer":      0,
			"startFrameNum": veh.JoinFrame,
			"positions":     positions,
			"framesFired":   []any{},
		}
		entities[veh.ID] = entity
	}

	return entities
}

// eventsToV1 converts events to v1 format.
// Uses the extension's "old" format: [frame, "killed", victimId, [killerId, weapon], distance]
func (s *Session) eventsToV1() []any {
	events := make([]any, 0, len(s.events))

	for _, e := range s.events {
		switch e.eventType {
		case "killed":
			evt := e.kill
			var victimID uint
			if evt.VictimVehicleID != nil {
				victimID = *evt.VictimVehicleID
			} else if evt.VictimSoldierID != nil {
				victimID = *evt.VictimSoldierID
			}
			var killerID uint
			if evt.KillerVehicleID != nil {
				killerID = *evt.KillerVehicleID
			} else if evt.KillerSoldierID != nil {
				killerID = *evt.KillerSoldierID
			}
			events = append(events, []any{
				evt.CaptureFrame, "killed",
				victimID,
				[]any{killerID, evt.EventText},
				evt.Distance,
			})

		case "hit":
			evt := e.hit
			var victimID uint
			if evt.VictimVehicleID != nil {
				victimID = *evt.VictimVehicleID
			} else if evt.VictimSoldierID != nil {
				victimID = *evt.VictimSoldierID
			}
			var sourceID uint
			if evt.ShooterVehicleID != nil {
				sourceID = *evt.ShooterVehicleID
			} else if evt.ShooterSoldierID != nil {
				sourceID = *evt.ShooterSoldierID
			}
			events = append(events, []any{
				evt.CaptureFrame, "hit",
				victimID,
				[]any{sourceID, evt.EventText},
				evt.Distance,
			})

		default:
			if e.general != nil {
				switch e.eventType {
				case "captured", "contested":
					events = append(events, []any{
						e.general.CaptureFrame, e.eventType,
						capturedDataArray(e.general),
					})
				case "capturedFlag":
					events = append(events, []any{
						e.general.CaptureFrame, e.eventType,
						capturedFlagDataArray(e.general),
					})
				default:
					events = append(events, []any{
						e.general.CaptureFrame, e.eventType, e.general.Message,
					})
				}
			} else if e.chat != nil {
				events = append(events, []any{
					e.chat.CaptureFrame, "chat", e.chat.Message,
				})
			}
		}
	}

	return events
}

// markersToV1 converts markers to v1 format.
// Format: [type, text, startFrame, endFrame, playerId, color, sideIndex, positions, size, shape, brush]
func (s *Session) markersToV1() []any {
	markers := make([]any, 0, len(s.markers))

	for _, rec := range s.markers {
		m := rec.Marker

		posArray := make([][]any, 0, 1+len(rec.States))

		if m.Shape == "POLYLINE" && len(m.Polyline) > 0 {
			coords := make([][]float64, len(m.Polyline))
			for i, pt := range m.Polyline {
				coords[i] = []float64{pt.X, pt.Y}
			}
			posArray = append(posArray, []any{
				m.CaptureFrame, coords, m.Direction, m.Alpha,
			})
		} else {
			posArray = append(posArray, []any{
				m.CaptureFrame,
				[]float64{m.Position.X, m.Position.Y, m.Position.Z},
				m.Direction, m.Alpha,
			})

			for _, st := range rec.States {
				posArray = append(posArray, []any{
					st.CaptureFrame,
					[]float64{st.Position.X, st.Position.Y, st.Position.Z},
					st.Direction, st.Alpha,
				})
			}
		}

		// Strip "#" prefix from hex colors for URL compatibility
		markerColor := strings.TrimPrefix(m.Color, "#")

		endFrame := m.EndFrame
		if endFrame == 0 {
			endFrame = -1
		}

		markers = append(markers, []any{
			m.MarkerType,
			m.Text,
			m.CaptureFrame,
			endFrame,
			m.OwnerID,
			markerColor,
			sideToIndex(m.Side),
			posArray,
			parseMarkerSize(m.Size),
			m.Shape,
			m.Brush,
		})
	}

	return markers
}

// timesToV1 converts time states to v1 format.
func (s *Session) timesToV1() []any {
	times := make([]any, 0, len(s.times))
	for _, ts := range s.times {
		times = append(times, map[string]any{
			"frameNum":       ts.CaptureFrame,
			"systemTimeUTC":  ts.SystemTimeUTC,
			"date":           ts.MissionDate,
			"timeMultiplier": ts.TimeMultiplier,
			"time":           ts.MissionTime,
		})
	}
	return times
}

// sanitizeFilename replaces non-filesystem-safe characters with underscores.
var unsafeChars = regexp.MustCompile(`[^a-zA-Z0-9._-]`)

func sanitizeFilename(name string) string {
	return unsafeChars.ReplaceAllString(strings.TrimSpace(name), "_")
}

// MakeFilename creates a sanitized timestamped filename from a mission name.
func MakeFilename(missionName string) string {
	name := "unknown"
	if missionName != "" {
		name = sanitizeFilename(missionName)
	}
	return name + "_" + time.Now().Format("20060102_150405")
}

// WriteJSONGz serializes the session to v1 JSON, gzip-compresses it,
// and writes it to dataDir/{filename}.json.gz. Returns the sanitized filename (without extension).
func (s *Session) WriteJSONGz(dataDir string) (string, error) {
	missionName := "unknown"
	if s.mission != nil && s.mission.MissionName != "" {
		missionName = s.mission.MissionName
	}

	filename := sanitizeFilename(missionName) + "_" + time.Now().Format("20060102_150405")

	data := s.ToV1JSON()

	outPath := filepath.Join(dataDir, filename+".json.gz")
	f, err := os.Create(outPath)
	if err != nil {
		return "", fmt.Errorf("create file: %w", err)
	}

	gw := gzip.NewWriter(f)
	encodeErr := json.NewEncoder(gw).Encode(data)
	gzipErr := gw.Close()
	fileErr := f.Close()

	if encodeErr != nil {
		return "", fmt.Errorf("encode JSON: %w", encodeErr)
	}
	if gzipErr != nil {
		return "", fmt.Errorf("close gzip: %w", gzipErr)
	}
	if fileErr != nil {
		return "", fmt.Errorf("close file: %w", fileErr)
	}

	return filename, nil
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func sideToIndex(side string) int {
	switch strings.ToUpper(side) {
	case "EAST", "OPFOR":
		return 0
	case "WEST", "BLUFOR":
		return 1
	case "GUER", "INDEPENDENT":
		return 2
	case "CIV", "CIVILIAN":
		return 3
	default:
		return -1
	}
}

func parseMarkerSize(sizeStr string) []float64 {
	var size []float64
	if err := json.Unmarshal([]byte(sizeStr), &size); err != nil || len(size) != 2 {
		return []float64{1.0, 1.0}
	}
	return size
}
