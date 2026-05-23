package ingestion

import (
	"compress/gzip"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/OCAP2/extension/v5/pkg/core"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSession_AddSoldierAndStates(t *testing.T) {
	s := NewSession()

	s.HandleAddSoldier(core.Soldier{
		ID: 1, JoinFrame: 0, UnitName: "Player1", Side: "WEST",
		GroupID: "Alpha", IsPlayer: true, DisplayName: "Player1", OcapType: "unit",
	})

	s.HandleSoldierState(core.SoldierState{
		SoldierID: 1, CaptureFrame: 0,
		Position: core.Position3D{X: 100, Y: 200, Z: 10},
		Bearing: 90, Lifestate: 0, IsPlayer: true,
		UnitName: "Player1", GroupID: "Alpha", Side: "WEST",
	})
	s.HandleSoldierState(core.SoldierState{
		SoldierID: 1, CaptureFrame: 1,
		Position: core.Position3D{X: 101, Y: 201, Z: 10},
		Bearing: 95, Lifestate: 0, IsPlayer: true,
		UnitName: "Player1", GroupID: "Alpha", Side: "WEST",
	})

	rec, ok := s.soldiers[1]
	require.True(t, ok)
	assert.Equal(t, "Player1", rec.Soldier.DisplayName)
	assert.Len(t, rec.States, 2)
	assert.Equal(t, uint(1), rec.States[1].CaptureFrame)
}

func TestSession_SoldierStatePlaceholder(t *testing.T) {
	s := NewSession()

	// State arrives before add_soldier — should create placeholder
	s.HandleSoldierState(core.SoldierState{
		SoldierID: 5, CaptureFrame: 0,
		Position: core.Position3D{X: 100, Y: 200, Z: 10},
	})

	rec, ok := s.soldiers[5]
	require.True(t, ok)
	assert.Equal(t, uint16(5), rec.Soldier.ID)
	assert.Len(t, rec.States, 1)
}

func TestSession_AddVehicleAndStates(t *testing.T) {
	s := NewSession()

	s.HandleAddVehicle(core.Vehicle{
		ID: 100, JoinFrame: 5, ClassName: "B_MRAP_01_F",
		DisplayName: "Hunter", OcapType: "vehicle",
	})

	s.HandleVehicleState(core.VehicleState{
		VehicleID: 100, CaptureFrame: 5,
		Position: core.Position3D{X: 500, Y: 600, Z: 0},
		Bearing: 180, IsAlive: true, Crew: "[1,2]",
	})

	rec, ok := s.vehicles[100]
	require.True(t, ok)
	assert.Equal(t, "Hunter", rec.Vehicle.DisplayName)
	assert.Len(t, rec.States, 1)
}

func TestSession_Events(t *testing.T) {
	s := NewSession()

	s.HandleKillEvent(core.KillEvent{
		CaptureFrame:    50,
		VictimSoldierID: ptrUint(2),
		KillerSoldierID: ptrUint(1),
		EventText:       "arifle_MX_F",
		Distance:        150.5,
	})

	s.HandleGeneralEvent(core.GeneralEvent{
		CaptureFrame: 100, Name: "generalEvent", Message: "Objective captured",
	})

	assert.Len(t, s.events, 2)
}

func TestSession_Stats(t *testing.T) {
	s := NewSession()

	// 2 players on WEST, 1 unit on EAST, 1 player on EAST (different name)
	s.HandleAddSoldier(core.Soldier{ID: 1, UnitName: "Alice", Side: "WEST", IsPlayer: true})
	s.HandleAddSoldier(core.Soldier{ID: 2, UnitName: "Bob", Side: "WEST", IsPlayer: true})
	s.HandleAddSoldier(core.Soldier{ID: 3, UnitName: "AI_1", Side: "EAST", IsPlayer: false})
	s.HandleAddSoldier(core.Soldier{ID: 4, UnitName: "Charlie", Side: "EAST", IsPlayer: true})

	// Respawn of Alice on WEST — should not double-count as a player
	s.HandleAddSoldier(core.Soldier{ID: 5, UnitName: "Alice", Side: "WEST", IsPlayer: true})

	// Player-on-player kill: Alice kills Charlie (PlayerKillCount=1)
	s.HandleKillEvent(core.KillEvent{
		CaptureFrame:    10,
		KillerSoldierID: ptrUint(1),
		VictimSoldierID: ptrUint(4),
	})
	// AI kill (KillCount only, not PlayerKill): AI_1 kills Bob
	s.HandleKillEvent(core.KillEvent{
		CaptureFrame:    20,
		KillerSoldierID: ptrUint(3),
		VictimSoldierID: ptrUint(2),
	})

	stats := s.Stats()
	assert.Equal(t, 3, stats.PlayerCount, "Alice/Bob/Charlie — Alice respawn not double-counted")
	assert.Equal(t, 2, stats.KillCount)
	assert.Equal(t, 1, stats.PlayerKillCount)

	west, ok := stats.Sides["WEST"]
	require.True(t, ok)
	assert.Equal(t, 2, west.Players, "Alice + Bob on WEST")
	assert.Equal(t, 3, west.Units, "Alice + Bob + Alice-respawn count as 3 units")
	assert.Equal(t, 1, west.Dead, "Bob killed")

	east, ok := stats.Sides["EAST"]
	require.True(t, ok)
	assert.Equal(t, 1, east.Players, "Charlie")
	assert.Equal(t, 2, east.Units, "AI_1 + Charlie")
	assert.Equal(t, 1, east.Dead, "Charlie killed")
}

func TestSession_Markers(t *testing.T) {
	s := NewSession()

	s.HandleAddMarker(core.Marker{
		ID: 1, MarkerName: "marker1", CaptureFrame: 10, EndFrame: -1,
		MarkerType: "hd_dot", Text: "HQ", Color: "ColorBlue",
		Side: "WEST", Position: core.Position3D{X: 300, Y: 400, Z: 0},
		Shape: "ICON", Alpha: 1.0, Brush: "Solid",
	})

	s.HandleMarkerState(core.MarkerState{
		MarkerID: 1, CaptureFrame: 20,
		Position: core.Position3D{X: 310, Y: 410, Z: 0},
		Direction: 45, Alpha: 0.8,
	})

	rec, ok := s.markers["marker1"]
	require.True(t, ok)
	assert.Equal(t, "HQ", rec.Marker.Text)
	assert.Len(t, rec.States, 1)
}

func TestSession_DeleteMarker(t *testing.T) {
	s := NewSession()

	s.HandleAddMarker(core.Marker{
		ID: 1, MarkerName: "m1", CaptureFrame: 0, EndFrame: -1,
	})

	s.HandleDeleteMarker("m1", 50)

	rec := s.markers["m1"]
	assert.Equal(t, 50, rec.Marker.EndFrame)
	assert.True(t, rec.Marker.IsDeleted)
}

func TestSession_FiredEvents(t *testing.T) {
	s := NewSession()

	s.HandleAddSoldier(core.Soldier{ID: 1})
	s.HandleFiredEvent(core.FiredEvent{
		SoldierID: 1, CaptureFrame: 30,
		StartPos: core.Position3D{X: 100, Y: 200, Z: 10},
		EndPos:   core.Position3D{X: 150, Y: 250, Z: 8},
	})

	rec := s.soldiers[1]
	assert.Len(t, rec.FiredEvents, 1)
}

func TestSession_FiredEvent_UnknownSoldier(t *testing.T) {
	s := NewSession()

	// Fired event for unknown soldier should be silently dropped
	s.HandleFiredEvent(core.FiredEvent{SoldierID: 99, CaptureFrame: 0})

	assert.Empty(t, s.soldiers)
}

func TestSession_TimeStates(t *testing.T) {
	s := NewSession()

	s.HandleTimeState(core.TimeState{
		CaptureFrame:   0,
		SystemTimeUTC:  "2026-02-16T12:00:00Z",
		MissionDate:    "2035-06-15",
		TimeMultiplier: 1.0,
		MissionTime:    360,
	})

	assert.Len(t, s.times, 1)
}

func TestSession_FrameCount(t *testing.T) {
	s := NewSession()

	s.HandleAddSoldier(core.Soldier{ID: 1})
	s.HandleSoldierState(core.SoldierState{SoldierID: 1, CaptureFrame: 0})
	s.HandleSoldierState(core.SoldierState{SoldierID: 1, CaptureFrame: 1})
	s.HandleSoldierState(core.SoldierState{SoldierID: 1, CaptureFrame: 2})

	s.HandleAddVehicle(core.Vehicle{ID: 100})
	s.HandleVehicleState(core.VehicleState{VehicleID: 100, CaptureFrame: 5})

	assert.Equal(t, uint(6), s.frameCount) // max(2,5) + 1 = 6
}

func TestSession_Telemetry(t *testing.T) {
	s := NewSession()

	s.HandleTelemetry(core.TelemetryEvent{
		CaptureFrame: 10,
		FpsAverage:   45.2,
		FpsMin:       30.1,
		GlobalCounts: core.GlobalEntityCount{UnitsAlive: 20, PlayersConnected: 8},
		Players: []core.PlayerNetworkData{
			{UID: "123", Name: "Player1", Ping: 42, BW: 1024, Desync: 0.5},
		},
	})

	assert.Len(t, s.events, 0, "telemetry should not be stored as gameplay events")
	assert.Len(t, s.telemetry, 1)
	assert.InDelta(t, 45.2, s.telemetry[0].FpsAverage, 0.01)
	assert.InDelta(t, 30.1, s.telemetry[0].FpsMin, 0.01)
	assert.Equal(t, uint(20), s.telemetry[0].GlobalCounts.UnitsAlive)
	assert.Equal(t, uint(8), s.telemetry[0].GlobalCounts.PlayersConnected)
	assert.Len(t, s.telemetry[0].Players, 1)
	assert.Equal(t, "Player1", s.telemetry[0].Players[0].Name)
	assert.Equal(t, uint(11), s.frameCount) // frame 10 + 1
}

func TestSession_Finalize(t *testing.T) {
	s := NewSession()
	s.SetMission(
		&core.Mission{MissionName: "Test Mission", CaptureDelay: 1.0, Tag: "TvT",
			ExtensionVersion: "1.0.0", AddonVersion: "2.0.0"},
		&core.World{WorldName: "altis"},
	)

	// Add a soldier with 3 frames of state
	s.HandleAddSoldier(core.Soldier{
		ID: 1, JoinFrame: 0, UnitName: "Player1", Side: "WEST",
		GroupID: "Alpha", IsPlayer: true, OcapType: "unit", RoleDescription: "Rifleman",
	})
	for i := uint(0); i < 3; i++ {
		s.HandleSoldierState(core.SoldierState{
			SoldierID: 1, CaptureFrame: i,
			Position: core.Position3D{X: float64(100 + i), Y: 200, Z: 10},
			Bearing: 90, Lifestate: 0, IsPlayer: true,
			UnitName: "Player1", GroupID: "Alpha", Side: "WEST",
		})
	}

	// Add a vehicle
	s.HandleAddVehicle(core.Vehicle{
		ID: 100, JoinFrame: 0, ClassName: "B_MRAP_01_F",
		DisplayName: "Hunter", OcapType: "vehicle",
	})
	s.HandleVehicleState(core.VehicleState{
		VehicleID: 100, CaptureFrame: 0,
		Position: core.Position3D{X: 500, Y: 600, Z: 0},
		Bearing: 180, IsAlive: true, Crew: "[1]",
	})

	// Add a kill event
	s.HandleKillEvent(core.KillEvent{
		CaptureFrame:    2,
		VictimSoldierID: ptrUint(2),
		KillerSoldierID: ptrUint(1),
		EventText:       "arifle_MX_F",
		Distance:        100.5,
	})

	// Add a time state
	s.HandleTimeState(core.TimeState{
		CaptureFrame: 0, SystemTimeUTC: "2026-02-16T12:00:00Z", MissionDate: "2035-06-15",
	})

	// Fired event
	s.HandleFiredEvent(core.FiredEvent{
		SoldierID: 1, CaptureFrame: 1,
		EndPos: core.Position3D{X: 150, Y: 250, Z: 8},
	})

	data := s.ToV1JSON()

	// Verify top-level fields
	assert.Equal(t, "altis", data["worldName"])
	assert.Equal(t, "Test Mission", data["missionName"])
	assert.Equal(t, uint(3), data["endFrame"])
	assert.Equal(t, float32(1.0), data["captureDelay"])
	assert.Equal(t, "1.0.0", data["extensionVersion"])
	assert.Equal(t, "2.0.0", data["addonVersion"])

	// Entities array is indexed by ID — entity 1 at index 1, entity 100 at index 100
	entities, ok := data["entities"].([]any)
	require.True(t, ok)
	assert.Len(t, entities, 101) // maxID=100, so 101 entries

	// Check soldier at index 1
	solEnt, ok := entities[1].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "unit", solEnt["type"])
	assert.Equal(t, "Player1", solEnt["name"])
	positions := solEnt["positions"].([][]any)
	assert.Len(t, positions, 3)

	// Check vehicle at index 100
	vehEnt, ok := entities[100].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "vehicle", vehEnt["type"])

	// Verify events
	events, ok := data["events"].([]any)
	require.True(t, ok)
	assert.Len(t, events, 1) // 1 kill

	// Verify kill event uses old extension format: [frame, "killed", victimId, [killerId, weapon], distance]
	killEvt := events[0].([]any)
	assert.Equal(t, uint(2), killEvt[0])
	assert.Equal(t, "killed", killEvt[1])
	assert.Equal(t, uint(2), killEvt[2])                   // victimId
	killerArr := killEvt[3].([]any)
	assert.Equal(t, uint(1), killerArr[0])                  // killerId
	assert.Equal(t, "arifle_MX_F", killerArr[1])            // weapon
	assert.Equal(t, float32(100.5), killEvt[4])             // distance

	// Verify markers
	markers, ok := data["Markers"].([]any)
	require.True(t, ok)
	assert.Len(t, markers, 0)

	// Verify times
	times, ok := data["times"].([]any)
	require.True(t, ok)
	assert.Len(t, times, 1)
}

func TestSession_FinalizeWritesFile(t *testing.T) {
	s := NewSession()
	s.SetMission(
		&core.Mission{MissionName: "Test Op", CaptureDelay: 1.0, Tag: "coop"},
		&core.World{WorldName: "altis"},
	)

	s.HandleAddSoldier(core.Soldier{ID: 1, JoinFrame: 0, OcapType: "unit", IsPlayer: true, UnitName: "P1", Side: "WEST"})
	s.HandleSoldierState(core.SoldierState{SoldierID: 1, CaptureFrame: 0, Position: core.Position3D{X: 1, Y: 2, Z: 3}})

	dir := t.TempDir()
	filename, err := s.WriteJSONGz(dir)
	require.NoError(t, err)
	assert.Contains(t, filename, "Test_Op_")

	// Verify file exists and is valid gzip JSON
	fullPath := filepath.Join(dir, filename+".json.gz")
	f, err := os.Open(fullPath)
	require.NoError(t, err)
	defer f.Close()

	gr, err := gzip.NewReader(f)
	require.NoError(t, err)

	var data map[string]any
	err = json.NewDecoder(gr).Decode(&data)
	require.NoError(t, err)
	assert.Equal(t, "altis", data["worldName"])
}

func TestSession_RoundTrip_ParserV1(t *testing.T) {
	// Build a session with representative data
	s := NewSession()
	s.SetMission(
		&core.Mission{MissionName: "RoundTrip Test", CaptureDelay: 1.0, Tag: "coop",
			ExtensionVersion: "1.0", AddonVersion: "2.0"},
		&core.World{WorldName: "stratis"},
	)

	// 2 soldiers, 1 vehicle, states, events, markers, times
	s.HandleAddSoldier(core.Soldier{ID: 1, JoinFrame: 0, OcapType: "unit",
		UnitName: "Alpha1", Side: "WEST", GroupID: "Alpha",
		IsPlayer: true, RoleDescription: "SL"})
	s.HandleAddSoldier(core.Soldier{ID: 2, JoinFrame: 0, OcapType: "unit",
		UnitName: "Alpha2", Side: "WEST", GroupID: "Alpha"})

	for i := uint(0); i < 5; i++ {
		s.HandleSoldierState(core.SoldierState{
			SoldierID: 1, CaptureFrame: i,
			Position: core.Position3D{X: float64(100 + i), Y: 200, Z: 10},
			Bearing: 90, Side: "WEST", GroupID: "Alpha",
			UnitName: "Alpha1", IsPlayer: true,
		})
		s.HandleSoldierState(core.SoldierState{
			SoldierID: 2, CaptureFrame: i,
			Position: core.Position3D{X: float64(110 + i), Y: 210, Z: 10},
			Bearing: 180, Side: "WEST", GroupID: "Alpha",
			UnitName: "Alpha2",
		})
	}

	s.HandleAddVehicle(core.Vehicle{ID: 100, JoinFrame: 0,
		ClassName: "B_MRAP_01_F", DisplayName: "Hunter", OcapType: "vehicle"})
	s.HandleVehicleState(core.VehicleState{VehicleID: 100, CaptureFrame: 0,
		Position: core.Position3D{X: 500, Y: 600, Z: 0}, IsAlive: true, Crew: "[1]"})

	s.HandleFiredEvent(core.FiredEvent{SoldierID: 1, CaptureFrame: 2,
		EndPos: core.Position3D{X: 150, Y: 250, Z: 8}})

	s.HandleKillEvent(core.KillEvent{CaptureFrame: 3,
		KillerSoldierID: ptrUint(1), VictimSoldierID: ptrUint(2),
		EventText: "arifle_MX_F", Distance: 50})

	s.HandleAddMarker(core.Marker{ID: 1, MarkerName: "m1", CaptureFrame: 0,
		EndFrame: -1, MarkerType: "hd_dot", Text: "HQ",
		Color: "ColorBlue", Side: "WEST", Shape: "ICON", Alpha: 1.0,
		Position: core.Position3D{X: 300, Y: 400, Z: 0}})

	s.HandleTimeState(core.TimeState{CaptureFrame: 0,
		SystemTimeUTC: "2026-02-16T12:00:00Z", MissionDate: "2035-06-15",
		TimeMultiplier: 1.0, MissionTime: 360})

	// Get v1 JSON and round-trip through JSON marshal/unmarshal
	data := s.ToV1JSON()
	jsonBytes, err := json.Marshal(data)
	require.NoError(t, err)

	var parsed map[string]interface{}
	err = json.Unmarshal(jsonBytes, &parsed)
	require.NoError(t, err)

	// Verify top-level fields
	assert.Equal(t, "stratis", parsed["worldName"])
	assert.Equal(t, "RoundTrip Test", parsed["missionName"])
	assert.NotNil(t, parsed["endFrame"])
	assert.NotNil(t, parsed["captureDelay"])

	// Entities indexed by ID: 0..100
	entities := parsed["entities"].([]interface{})
	assert.Len(t, entities, 101) // maxID=100

	// Verify soldier entity at index 1
	ent := entities[1].(map[string]interface{})
	assert.Equal(t, "unit", ent["type"])
	assert.Contains(t, ent, "positions")
	assert.Contains(t, ent, "startFrameNum")
	assert.Contains(t, ent, "framesFired")

	positions := ent["positions"].([]interface{})
	assert.Len(t, positions, 5)

	// Each position: [[x,y,z], bearing, lifestate, inVehicleID, name, isPlayer, role]
	pos := positions[0].([]interface{})
	assert.Len(t, pos, 7)

	// Events
	events := parsed["events"].([]interface{})
	assert.Len(t, events, 1) // 1 kill

	// Kill event uses old format: [frame, "killed", victimId, [killerId, weapon], distance]
	killEvt := events[0].([]interface{})
	assert.Len(t, killEvt, 5)
	assert.Equal(t, "killed", killEvt[1])
	killerArr := killEvt[3].([]interface{})
	assert.Len(t, killerArr, 2) // [killerId, weapon]

	// Markers
	markers := parsed["Markers"].([]interface{})
	assert.Len(t, markers, 1)

	// Marker format: [type, text, startFrame, endFrame, playerId, color, side, positions, size, shape, brush]
	marker := markers[0].([]interface{})
	assert.Len(t, marker, 11)
	assert.Equal(t, "hd_dot", marker[0])
	assert.Equal(t, "HQ", marker[1])

	// Times
	times := parsed["times"].([]interface{})
	assert.Len(t, times, 1)
}

func TestSession_EmptySession(t *testing.T) {
	s := NewSession()
	data := s.ToV1JSON()

	assert.Equal(t, "", data["worldName"])
	assert.Equal(t, "", data["missionName"])
	assert.Equal(t, uint(0), data["endFrame"])

	entities := data["entities"].([]any)
	assert.Empty(t, entities)
}

func TestSession_Accessors(t *testing.T) {
	s := NewSession()
	assert.Nil(t, s.Mission())
	assert.Nil(t, s.World())
	assert.Equal(t, uint(0), s.FrameCount())

	s.SetMission(&core.Mission{MissionName: "Test"}, &core.World{WorldName: "altis"})
	assert.Equal(t, "Test", s.Mission().MissionName)
	assert.Equal(t, "altis", s.World().WorldName)
}

func ptrUint(v uint) *uint {
	return &v
}
