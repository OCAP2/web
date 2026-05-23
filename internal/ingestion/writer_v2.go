package ingestion

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"google.golang.org/protobuf/proto"

	"github.com/OCAP2/extension/v5/pkg/core"
	pbv2 "github.com/OCAP2/web/pkg/schemas/protobuf/v2"
)

const defaultChunkSize = 300

// WriteV2Manifest writes the v2 protobuf manifest and a JSON archive from session data.
// Chunks are expected to have been written already by the ChunkFlusher.
func WriteV2Manifest(session *Session, outputDir string, chunkCount uint32) error {
	manifest := buildManifest(session, chunkCount)

	// Write protobuf manifest.
	data, err := proto.Marshal(manifest)
	if err != nil {
		return fmt.Errorf("marshal manifest: %w", err)
	}
	if err := os.WriteFile(filepath.Join(outputDir, "manifest.pb"), data, 0644); err != nil {
		return fmt.Errorf("write manifest.pb: %w", err)
	}

	// Write JSON archive for debugging.
	jsonData, err := json.MarshalIndent(manifestToJSON(manifest), "", "  ")
	if err != nil {
		return fmt.Errorf("marshal JSON archive: %w", err)
	}
	if err := os.WriteFile(filepath.Join(outputDir, "manifest.json"), jsonData, 0644); err != nil {
		return fmt.Errorf("write manifest.json: %w", err)
	}

	return nil
}

func buildManifest(session *Session, chunkCount uint32) *pbv2.Manifest {
	// Derive fire lines, markers, and hit events from raw projectile data.
	session.deriveProjectileData()

	chunkSize := uint32(defaultChunkSize)

	manifest := &pbv2.Manifest{
		Version:        2,
		FrameCount:     uint32(session.frameCount),
		ChunkSize:      chunkSize,
		CaptureDelayMs: captureDelayMs(session),
		ChunkCount:     chunkCount,
	}

	// World metadata.
	if session.world != nil {
		manifest.World = &pbv2.WorldMeta{
			WorldName:   session.world.WorldName,
			WorldSize:   session.world.WorldSize,
			Latitude:    session.world.Latitude,
			Longitude:   session.world.Longitude,
			Author:      session.world.Author,
			DisplayName: session.world.DisplayName,
		}
	}

	// Mission metadata.
	if session.mission != nil {
		m := session.mission
		manifest.Mission = &pbv2.MissionMeta{
			MissionName:      m.MissionName,
			BriefingName:     m.BriefingName,
			Author:           m.Author,
			ServerName:       m.ServerName,
			ExtensionVersion: m.ExtensionVersion,
			AddonVersion:     m.AddonVersion,
			ExtensionBuild:   m.ExtensionBuild,
			Tag:              m.Tag,
			PlayableSlots: &pbv2.PlayableSlots{
				West:        uint32(m.PlayableSlots.West),
				East:        uint32(m.PlayableSlots.East),
				Independent: uint32(m.PlayableSlots.Independent),
				Civilian:    uint32(m.PlayableSlots.Civilian),
			},
			SideFriendly: &pbv2.SideFriendly{
				EastWest:        m.SideFriendly.EastWest,
				EastIndependent: m.SideFriendly.EastIndependent,
				WestIndependent: m.SideFriendly.WestIndependent,
			},
		}
		for _, addon := range m.Addons {
			manifest.Mission.Addons = append(manifest.Mission.Addons, &pbv2.Addon{
				Name:       addon.Name,
				WorkshopId: addon.WorkshopID,
			})
		}
	}

	// Soldier definitions.
	for _, rec := range session.soldiers {
		manifest.Soldiers = append(manifest.Soldiers, soldierDefToProto(rec))
	}

	// Vehicle definitions.
	for _, rec := range session.vehicles {
		manifest.Vehicles = append(manifest.Vehicles, vehicleDefToProto(rec))
	}

	// Events.
	for _, rec := range session.events {
		if evt := eventToProto(rec); evt != nil {
			manifest.Events = append(manifest.Events, evt)
		}
	}

	// Raw projectile events (1:1 storage for future access).
	for _, pe := range session.projectiles {
		manifest.Events = append(manifest.Events, projectileToProtoEvent(pe))
	}

	// Telemetry (performance + entity counts + weather + player network).
	for _, te := range session.telemetry {
		manifest.Events = append(manifest.Events, telemetryToProtoEvent(te))
	}

	// Markers.
	for _, rec := range session.markers {
		manifest.Markers = append(manifest.Markers, markerToProto(rec))
	}

	// Times.
	for _, ts := range session.times {
		manifest.Times = append(manifest.Times, timeToProto(ts))
	}

	return manifest
}

func soldierDefToProto(rec *soldierRecord) *pbv2.SoldierDef {
	sol := rec.Soldier
	def := &pbv2.SoldierDef{
		Id:        uint32(sol.ID),
		Name:      sol.UnitName,
		Side:      sideStringToProto(sol.Side),
		GroupName: sol.GroupID,
		Role:      sol.RoleDescription,
		StartFrame: uint32(sol.JoinFrame),
		IsPlayer:  sol.IsPlayer,
		ClassName: sol.ClassName,
		PlayerUid: sol.PlayerUID,
	}
	if len(rec.States) > 0 {
		lastFrame := rec.States[len(rec.States)-1].CaptureFrame
		def.EndFrame = uint32(lastFrame)
	}

	for _, fe := range rec.FiredEvents {
		def.FramesFired = append(def.FramesFired, &pbv2.FiredFrame{
			FrameNum:   uint32(fe.CaptureFrame),
			StartPos:   pos3DToProto(fe.StartPos),
			EndPos:     pos3DToProto(fe.EndPos),
			Weapon:     fe.Weapon,
			Magazine:   fe.Magazine,
			FiringMode: fe.FiringMode,
		})
	}
	for _, pe := range rec.bulletFireLines {
		endPos := projectileEndPos(pe)
		startPos := core.Position3D{}
		if len(pe.Trajectory) > 0 {
			startPos = pe.Trajectory[0].Position
		}
		def.FramesFired = append(def.FramesFired, &pbv2.FiredFrame{
			FrameNum: uint32(pe.CaptureFrame),
			StartPos: pos3DToProto(startPos),
			EndPos:   pos3DToProto(endPos),
			Weapon:   pe.WeaponDisplay,
			Magazine: pe.MagazineDisplay,
		})
	}

	return def
}

func vehicleDefToProto(rec *vehicleRecord) *pbv2.VehicleDef {
	veh := rec.Vehicle
	def := &pbv2.VehicleDef{
		Id:            uint32(veh.ID),
		Name:          veh.DisplayName,
		VehicleClass:  veh.OcapType,
		ClassName:     veh.ClassName,
		StartFrame:    uint32(veh.JoinFrame),
		Customization: veh.Customization,
	}
	if len(rec.States) > 0 {
		lastFrame := rec.States[len(rec.States)-1].CaptureFrame
		def.EndFrame = uint32(lastFrame)
	}
	return def
}

func eventToProto(rec eventRecord) *pbv2.Event {
	evt := &pbv2.Event{
		FrameNum: uint32(rec.frame),
	}

	switch rec.eventType {
	case "killed":
		if rec.kill == nil {
			return nil
		}
		k := rec.kill
		kill := &pbv2.KillEvent{
			WeaponName:    k.WeaponName,
			WeaponMagazine: k.WeaponMagazine,
			EventText:     k.EventText,
			Distance:      k.Distance,
		}
		if k.VictimSoldierID != nil {
			kill.VictimSoldierId = uint32(*k.VictimSoldierID)
		}
		if k.VictimVehicleID != nil {
			kill.VictimVehicleId = uint32(*k.VictimVehicleID)
			kill.VictimIsVehicle = true
		}
		if k.KillerSoldierID != nil {
			kill.KillerSoldierId = uint32(*k.KillerSoldierID)
		}
		if k.KillerVehicleID != nil {
			kill.KillerVehicleId = uint32(*k.KillerVehicleID)
			kill.KillerIsVehicle = true
		}
		evt.Event = &pbv2.Event_Kill{Kill: kill}

	case "hit":
		if rec.hit == nil {
			return nil
		}
		h := rec.hit
		hit := &pbv2.HitEvent{
			WeaponName:    h.WeaponName,
			WeaponMagazine: h.WeaponMagazine,
			EventText:     h.EventText,
			Distance:      h.Distance,
		}
		if h.VictimSoldierID != nil {
			hit.VictimSoldierId = uint32(*h.VictimSoldierID)
		}
		if h.VictimVehicleID != nil {
			hit.VictimVehicleId = uint32(*h.VictimVehicleID)
			hit.VictimIsVehicle = true
		}
		if h.ShooterSoldierID != nil {
			hit.ShooterSoldierId = uint32(*h.ShooterSoldierID)
		}
		if h.ShooterVehicleID != nil {
			hit.ShooterVehicleId = uint32(*h.ShooterVehicleID)
			hit.ShooterIsVehicle = true
		}
		evt.Event = &pbv2.Event_Hit{Hit: hit}

	case "chat":
		if rec.chat == nil {
			return nil
		}
		c := rec.chat
		chat := &pbv2.ChatEvent{
			Channel:   c.Channel,
			FromName:  c.FromName,
			Message:   c.Message,
			PlayerUid: c.PlayerUID,
		}
		if c.SoldierID != nil {
			chat.SoldierId = uint32(*c.SoldierID)
		}
		evt.Event = &pbv2.Event_Chat{Chat: chat}

	default:
		if rec.general != nil {
			ge := &pbv2.GeneralEvent{
				Name:    rec.eventType,
				Message: rec.general.Message,
			}
			if v, ok := rec.general.ExtraData["objectType"].(string); ok {
				ge.ObjectType = v
			}
			if v, ok := rec.general.ExtraData["unitName"].(string); ok {
				ge.UnitName = v
			}
			if v, ok := rec.general.ExtraData["side"].(string); ok {
				ge.Side = v
			}
			evt.Event = &pbv2.Event_General{General: ge}
		} else {
			return nil
		}
	}

	return evt
}

func markerToProto(rec *markerRecord) *pbv2.MarkerDef {
	m := rec.Marker
	endFrame := uint32(0)
	if m.EndFrame > 0 {
		endFrame = uint32(m.EndFrame)
	}

	marker := &pbv2.MarkerDef{
		Type:       m.MarkerType,
		Text:       m.Text,
		StartFrame: uint32(m.CaptureFrame),
		EndFrame:   endFrame,
		PlayerId:   int32(m.OwnerID),
		Color:      strings.TrimPrefix(m.Color, "#"),
		Side:       sideStringToProto(m.Side),
		Shape:      m.Shape,
		Brush:      m.Brush,
		Size:       parseMarkerSizeF32(m.Size),
	}

	// Initial position.
	if m.Shape == "POLYLINE" && len(m.Polyline) > 0 {
		coords := make([]float32, 0, len(m.Polyline)*2)
		for _, pt := range m.Polyline {
			coords = append(coords, float32(pt.X), float32(pt.Y))
		}
		marker.Positions = append(marker.Positions, &pbv2.MarkerPosition{
			FrameNum:   uint32(m.CaptureFrame),
			Direction:  m.Direction,
			Alpha:      m.Alpha,
			LineCoords: coords,
		})
	} else {
		marker.Positions = append(marker.Positions, &pbv2.MarkerPosition{
			FrameNum: uint32(m.CaptureFrame),
			Position: &pbv2.Position3D{
				X: float32(m.Position.X),
				Y: float32(m.Position.Y),
				Z: float32(m.Position.Z),
			},
			Direction: m.Direction,
			Alpha:     m.Alpha,
		})

		for _, st := range rec.States {
			marker.Positions = append(marker.Positions, &pbv2.MarkerPosition{
				FrameNum: uint32(st.CaptureFrame),
				Position: &pbv2.Position3D{
					X: float32(st.Position.X),
					Y: float32(st.Position.Y),
					Z: float32(st.Position.Z),
				},
				Direction: st.Direction,
				Alpha:     st.Alpha,
			})
		}
	}

	return marker
}

func timeToProto(ts core.TimeState) *pbv2.TimeSample {
	return &pbv2.TimeSample{
		FrameNum:       uint32(ts.CaptureFrame),
		SystemTimeUtc:  ts.SystemTimeUTC,
		Date:           ts.MissionDate,
		TimeMultiplier: ts.TimeMultiplier,
		Time:           ts.MissionTime,
	}
}

// --- Helpers ---

func pos3DToProto(p core.Position3D) *pbv2.Position3D {
	return &pbv2.Position3D{
		X: float32(p.X),
		Y: float32(p.Y),
		Z: float32(p.Z),
	}
}

func sideStringToProto(s string) pbv2.Side {
	switch strings.ToUpper(s) {
	case "WEST", "BLUFOR":
		return pbv2.Side_SIDE_WEST
	case "EAST", "OPFOR":
		return pbv2.Side_SIDE_EAST
	case "GUER", "INDEPENDENT":
		return pbv2.Side_SIDE_GUER
	case "CIV", "CIVILIAN":
		return pbv2.Side_SIDE_CIV
	case "GLOBAL":
		return pbv2.Side_SIDE_GLOBAL
	default:
		return pbv2.Side_SIDE_UNKNOWN
	}
}

func captureDelayMs(session *Session) uint32 {
	if session.mission != nil && session.mission.CaptureDelay > 0 {
		return uint32(session.mission.CaptureDelay * 1000)
	}
	return 1000
}

// SoldierStateToProto converts a core.SoldierState to a v2 protobuf SoldierState.
func SoldierStateToProto(st core.SoldierState) *pbv2.SoldierState {
	state := &pbv2.SoldierState{
		Id:               uint32(st.SoldierID),
		Position:         pos3DToProto(st.Position),
		Bearing:          uint32(st.Bearing),
		Lifestate:        uint32(st.Lifestate),
		InVehicle:        st.InVehicle,
		Name:             st.UnitName,
		IsPlayer:         st.IsPlayer,
		GroupName:        st.GroupID,
		Side:             st.Side,
		Role:             st.CurrentRole,
		VehicleRole:      st.VehicleRole,
		Stance:           st.Stance,
		HasStableVitals:  st.HasStableVitals,
		IsDraggedCarried: st.IsDraggedCarried,
		Scores: &pbv2.SoldierScores{
			InfantryKills: uint32(st.Scores.InfantryKills),
			VehicleKills:  uint32(st.Scores.VehicleKills),
			ArmorKills:    uint32(st.Scores.ArmorKills),
			AirKills:      uint32(st.Scores.AirKills),
			Deaths:        uint32(st.Scores.Deaths),
			TotalScore:    uint32(st.Scores.TotalScore),
		},
	}
	if st.InVehicleObjectID != nil {
		state.VehicleId = uint32(*st.InVehicleObjectID)
	}
	return state
}

// VehicleStateToProto converts a core.VehicleState to a v2 protobuf VehicleState.
func VehicleStateToProto(st core.VehicleState) *pbv2.VehicleState {
	state := &pbv2.VehicleState{
		Id:               uint32(st.VehicleID),
		Position:         pos3DToProto(st.Position),
		Bearing:          uint32(st.Bearing),
		Alive:            st.IsAlive,
		Fuel:             st.Fuel,
		Damage:           st.Damage,
		Locked:           st.Locked,
		EngineOn:         st.EngineOn,
		Side:             st.Side,
		TurretAzimuth:    st.TurretAzimuth,
		TurretElevation:  st.TurretElevation,
	}

	// Parse crew JSON string to extract crew IDs.
	if st.Crew != "" {
		var crewIDs []uint32
		if err := json.Unmarshal([]byte(st.Crew), &crewIDs); err == nil {
			state.CrewIds = crewIDs
		}
	}

	return state
}

func parseMarkerSizeF32(sizeStr string) []float32 {
	f64 := parseMarkerSize(sizeStr)
	f32 := make([]float32, len(f64))
	for i, v := range f64 {
		f32[i] = float32(v)
	}
	return f32
}

// manifestToJSON creates a JSON-serializable representation of the manifest for debugging.
func manifestToJSON(m *pbv2.Manifest) map[string]any {
	result := map[string]any{
		"version":        m.Version,
		"frameCount":     m.FrameCount,
		"chunkSize":      m.ChunkSize,
		"captureDelayMs": m.CaptureDelayMs,
		"chunkCount":     m.ChunkCount,
	}

	if m.World != nil {
		result["world"] = map[string]any{
			"worldName":   m.World.WorldName,
			"worldSize":   m.World.WorldSize,
			"latitude":    m.World.Latitude,
			"longitude":   m.World.Longitude,
			"author":      m.World.Author,
			"displayName": m.World.DisplayName,
		}
	}

	if m.Mission != nil {
		mission := map[string]any{
			"missionName":      m.Mission.MissionName,
			"briefingName":     m.Mission.BriefingName,
			"author":           m.Mission.Author,
			"serverName":       m.Mission.ServerName,
			"extensionVersion": m.Mission.ExtensionVersion,
			"addonVersion":     m.Mission.AddonVersion,
			"extensionBuild":   m.Mission.ExtensionBuild,
			"tag":              m.Mission.Tag,
		}
		if m.Mission.PlayableSlots != nil {
			mission["playableSlots"] = m.Mission.PlayableSlots
		}
		if m.Mission.SideFriendly != nil {
			mission["sideFriendly"] = m.Mission.SideFriendly
		}
		if len(m.Mission.Addons) > 0 {
			mission["addons"] = m.Mission.Addons
		}
		result["mission"] = mission
	}

	result["soldierCount"] = len(m.Soldiers)
	result["vehicleCount"] = len(m.Vehicles)
	result["eventCount"] = len(m.Events)
	result["markerCount"] = len(m.Markers)
	result["timeCount"] = len(m.Times)

	return result
}

// telemetryToProtoEvent converts a core.TelemetryEvent to a v2 proto Event.
func telemetryToProtoEvent(te core.TelemetryEvent) *pbv2.Event {
	t := &pbv2.TelemetryEvent{
		FpsAverage: te.FpsAverage,
		FpsMin:     te.FpsMin,
		SideEntityCounts: &pbv2.SideEntityCounts{
			East:        sideEntityCountToProto(te.SideEntityCounts.East),
			West:        sideEntityCountToProto(te.SideEntityCounts.West),
			Independent: sideEntityCountToProto(te.SideEntityCounts.Independent),
			Civilian:    sideEntityCountToProto(te.SideEntityCounts.Civilian),
		},
		GlobalCounts: &pbv2.GlobalEntityCount{
			UnitsAlive:       uint32(te.GlobalCounts.UnitsAlive),
			UnitsDead:        uint32(te.GlobalCounts.UnitsDead),
			Groups:           uint32(te.GlobalCounts.Groups),
			Vehicles:         uint32(te.GlobalCounts.Vehicles),
			WeaponHolders:    uint32(te.GlobalCounts.WeaponHolders),
			PlayersAlive:     uint32(te.GlobalCounts.PlayersAlive),
			PlayersDead:      uint32(te.GlobalCounts.PlayersDead),
			PlayersConnected: uint32(te.GlobalCounts.PlayersConnected),
		},
		Scripts: &pbv2.ScriptCounts{
			Spawn:   uint32(te.Scripts.Spawn),
			ExecVm:  uint32(te.Scripts.ExecVM),
			Exec:    uint32(te.Scripts.Exec),
			ExecFsm: uint32(te.Scripts.ExecFSM),
			Pfh:     uint32(te.Scripts.PFH),
		},
		Weather: &pbv2.WeatherData{
			Fog:           te.Weather.Fog,
			Overcast:      te.Weather.Overcast,
			Rain:          te.Weather.Rain,
			Humidity:      te.Weather.Humidity,
			Waves:         te.Weather.Waves,
			WindDir:       te.Weather.WindDir,
			WindStr:       te.Weather.WindStr,
			Gusts:         te.Weather.Gusts,
			Lightnings:    te.Weather.Lightnings,
			MoonIntensity: te.Weather.MoonIntensity,
			MoonPhase:     te.Weather.MoonPhase,
			SunOrMoon:     te.Weather.SunOrMoon,
		},
	}
	for _, p := range te.Players {
		t.Players = append(t.Players, &pbv2.PlayerNetworkData{
			Uid:    p.UID,
			Name:   p.Name,
			Ping:   p.Ping,
			Bw:     p.BW,
			Desync: p.Desync,
		})
	}
	return &pbv2.Event{
		FrameNum: uint32(te.CaptureFrame),
		Event:    &pbv2.Event_Telemetry{Telemetry: t},
	}
}

func sideEntityCountToProto(sec core.SideEntityCount) *pbv2.SideEntityCount {
	return &pbv2.SideEntityCount{
		Local: &pbv2.EntityLocality{
			UnitsTotal:    uint32(sec.Local.UnitsTotal),
			UnitsAlive:    uint32(sec.Local.UnitsAlive),
			UnitsDead:     uint32(sec.Local.UnitsDead),
			Groups:        uint32(sec.Local.Groups),
			Vehicles:      uint32(sec.Local.Vehicles),
			WeaponHolders: uint32(sec.Local.WeaponHolders),
		},
		Remote: &pbv2.EntityLocality{
			UnitsTotal:    uint32(sec.Remote.UnitsTotal),
			UnitsAlive:    uint32(sec.Remote.UnitsAlive),
			UnitsDead:     uint32(sec.Remote.UnitsDead),
			Groups:        uint32(sec.Remote.Groups),
			Vehicles:      uint32(sec.Remote.Vehicles),
			WeaponHolders: uint32(sec.Remote.WeaponHolders),
		},
	}
}

// projectileToProtoEvent converts a raw core.ProjectileEvent to a v2 proto Event.
func projectileToProtoEvent(pe core.ProjectileEvent) *pbv2.Event {
	proj := &pbv2.ProjectileEvent{
		FirerId:        uint32(pe.FirerObjectID),
		Weapon:         pe.WeaponDisplay,
		Magazine:       pe.MagazineDisplay,
		Muzzle:         pe.MuzzleDisplay,
		MagazineIcon:   pe.MagazineIcon,
		SimulationType: pe.SimulationType,
	}
	if pe.VehicleObjectID != nil {
		proj.VehicleId = uint32(*pe.VehicleObjectID)
	}
	for _, tp := range pe.Trajectory {
		proj.Trajectory = append(proj.Trajectory, &pbv2.TrajectoryPoint{
			Position: pos3DToProto(tp.Position),
			FrameNum: uint32(tp.Frame),
		})
	}
	for _, h := range pe.Hits {
		hit := &pbv2.ProjectileHit{
			FrameNum:      uint32(h.CaptureFrame),
			Position:      pos3DToProto(h.Position),
			ComponentsHit: h.ComponentsHit,
		}
		if h.SoldierID != nil {
			hit.SoldierId = uint32(*h.SoldierID)
			hit.HitSoldier = true
		}
		if h.VehicleID != nil {
			hit.VehicleId = uint32(*h.VehicleID)
			hit.HitVehicle = true
		}
		proj.Hits = append(proj.Hits, hit)
	}
	return &pbv2.Event{
		FrameNum: uint32(pe.CaptureFrame),
		Event:    &pbv2.Event_Projectile{Projectile: proj},
	}
}
