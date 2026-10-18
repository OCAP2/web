package ingestion

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/OCAP2/extension/v5/pkg/core"
	"github.com/OCAP2/extension/v5/pkg/streaming"
	"github.com/OCAP2/web/internal/storage"
	v1 "github.com/OCAP2/web/pkg/schemas/protobuf/v1"
	pb "github.com/OCAP2/web/pkg/schemas/protobuf/v2"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/proto"
)

func TestSharedProtocolCoverage(t *testing.T) {
	// Extension uses one-based frames. Domain types and message names come from
	// its published package, so a newly added upstream message fails this test.
	payloads := map[string]any{
		streaming.TypeAddSoldier:        core.Soldier{ID: 1, JoinFrame: 1, UnitName: "Player", Side: "WEST", IsPlayer: true},
		streaming.TypeAddVehicle:        core.Vehicle{ID: 2, JoinFrame: 1, DisplayName: "Hunter", OcapType: "car"},
		streaming.TypeAddMarker:         core.Marker{ID: 3, MarkerName: "HQ", CaptureFrame: 1},
		streaming.TypeSoldierState:      core.SoldierState{SoldierID: 1, CaptureFrame: 2, Lifestate: 1, UnitName: "Player", Side: "WEST", IsPlayer: true},
		streaming.TypeVehicleState:      core.VehicleState{VehicleID: 2, CaptureFrame: 2, IsAlive: true},
		streaming.TypeMarkerState:       core.MarkerState{MarkerID: 3, CaptureFrame: 2},
		streaming.TypeDeleteMarker:      core.DeleteMarker{Name: "HQ", EndFrame: 3},
		streaming.TypeDeleteSoldier:     map[string]any{"id": 1, "frame": 3},
		streaming.TypeDeleteVehicle:     map[string]any{"id": 2, "frame": 3},
		streaming.TypeFiredEvent:        core.FiredEvent{SoldierID: 1, CaptureFrame: 2},
		streaming.TypeProjectileEvent:   core.ProjectileEvent{CaptureFrame: 2, FirerObjectID: 1, SimulationType: "shotBullet", Trajectory: []core.TrajectoryPoint{{FrameNum: 2}, {FrameNum: 8}}},
		streaming.TypeGeneralEvent:      core.GeneralEvent{CaptureFrame: 3, Name: "inventorySnapshot", Message: `{"unitId":1,"reason":"periodic"}`},
		streaming.TypeSectorEvent:       core.SectorEvent{CaptureFrame: 3, Name: "captured", ObjectType: "sector", UnitName: "A", Side: "WEST", PosX: 100, PosY: 200},
		streaming.TypeEndMissionEvent:   core.EndMissionEvent{CaptureFrame: 9, Side: "WEST", Message: "Victory"},
		streaming.TypeKillEvent:         core.KillEvent{CaptureFrame: 3, VictimSoldierID: ptrUint(1), KillerSoldierID: ptrUint(1)},
		streaming.TypeHitEvent:          core.HitEvent{CaptureFrame: 2},
		streaming.TypeChatEvent:         core.ChatEvent{CaptureFrame: 2, Message: "hello"},
		streaming.TypeRadioEvent:        core.RadioEvent{CaptureFrame: 2, SoldierID: ptrUint(1), Frequency: 50, Code: "secret", StartEnd: "start"},
		streaming.TypeTelemetry:         core.TelemetryEvent{CaptureFrame: 2, FpsAverage: 45, Weather: core.WeatherData{Rain: 0.5}},
		streaming.TypeTimeState:         core.TimeState{CaptureFrame: 2, SystemTimeUTC: "2026-10-18T00:00:00Z"},
		streaming.TypeAce3Death:         core.Ace3DeathEvent{CaptureFrame: 3, SoldierID: 1, Reason: "blood loss"},
		streaming.TypeAce3Unconscious:   core.Ace3UnconsciousEvent{CaptureFrame: 2, SoldierID: 1, IsUnconscious: true},
		streaming.TypeAddPlaced:         core.PlacedObject{ID: 7, JoinFrame: 2, OwnerID: 1, MarkerIcon: "trench", Direction: 90},
		streaming.TypePlacedEvent:       core.PlacedObjectEvent{PlacedID: 7, CaptureFrame: 9, EventType: "deleted"},
		streaming.TypeMissionFocusStart: map[string]any{"frame": 2},
		streaming.TypeMissionFocusEnd:   map[string]any{"frame": 5},
	}
	s := NewSession()
	s.SetMission(&core.Mission{MissionName: "Protocol", CaptureDelay: 1}, &core.World{WorldName: "altis"})
	dir := t.TempDir()
	cf, err := NewChunkFlusher(dir, 3)
	require.NoError(t, err)
	s.SetChunkFlusher(cf)
	for _, kind := range streaming.AllMessageTypes {
		if kind == streaming.TypeStartMission || kind == streaming.TypeEndMission {
			continue
		}
		p, ok := payloads[kind]
		require.True(t, ok, "missing contract case for %s", kind)
		data, err := json.Marshal(p)
		require.NoError(t, err)
		require.NoError(t, s.HandleMessage(streaming.Envelope{Type: kind, Payload: data}), kind)
	}
	require.Equal(t, core.Frame(9), s.FrameCount())
	require.NoError(t, s.Finalize(dir))
	data, err := os.ReadFile(filepath.Join(dir, "manifest.pb"))
	require.NoError(t, err)
	var manifest pb.Manifest
	require.NoError(t, proto.Unmarshal(data, &manifest))
	require.Equal(t, uint32(3), manifest.ChunkSize)
	require.Equal(t, uint32(3), manifest.ChunkCount)
	require.Equal(t, uint32(0), manifest.Soldiers[0].StartFrame)
	require.Len(t, manifest.PlacedObjects, 1)
	require.Equal(t, "trench", manifest.PlacedObjects[0].MarkerIcon)
	require.Len(t, manifest.PlacedEvents, 1)
	require.Len(t, manifest.FocusRanges, 1)
	require.Equal(t, uint32(1), manifest.FocusRanges[0].Start)
	require.Equal(t, uint32(4), manifest.FocusRanges[0].End)
	counts := map[string]int{}
	for _, e := range manifest.Events {
		switch {
		case e.GetRadio() != nil:
			counts["radio"]++
			require.Equal(t, "secret", e.GetRadio().Code)
		case e.GetAce3Death() != nil:
			counts["aceDeath"]++
		case e.GetAce3Unconscious() != nil:
			counts["aceUnconscious"]++
		case e.GetGeneral() != nil:
			counts[e.GetGeneral().Name]++
		}
	}
	for _, name := range []string{"radio", "aceDeath", "aceUnconscious", "captured", "endMission"} {
		require.Equal(t, 1, counts[name], name)
	}
	require.Equal(t, []uint32{1}, manifest.SnapshotUnitIds)
	snapshotData, err := os.ReadFile(filepath.Join(dir, "snapshots", "1.pb"))
	require.NoError(t, err)
	var series v1.PlayerSnapshotSeries
	require.NoError(t, proto.Unmarshal(snapshotData, &series))
	require.Len(t, series.Events, 1)
	require.JSONEq(t, `{"unitId":1,"reason":"periodic"}`, series.Events[0].Message)
	require.NoError(t, s.WriteJSONGzNamed(filepath.Dir(dir), filepath.Base(dir)))
	legacy, err := storage.NewJSONEngine(filepath.Dir(dir)).GetManifest(context.Background(), filepath.Base(dir))
	require.NoError(t, err)
	require.Equal(t, "Protocol", legacy.MissionName)
	loaded, err := storage.NewProtobufEngine(filepath.Dir(dir)).GetManifest(context.Background(), filepath.Base(dir))
	require.NoError(t, err)
	require.Equal(t, uint32(2), loaded.Version)
	require.Equal(t, "Protocol", loaded.MissionName)
	require.Equal(t, "Player", loaded.Entities[0].Name)
	// Check the real upstream parser, not just syntactically valid JSON.
	canonicalBytes, err := json.Marshal(s.ToV1JSON())
	require.NoError(t, err)
	var canonical map[string]any
	require.NoError(t, json.Unmarshal(canonicalBytes, &canonical))
	parsed, err := (&storage.ParserV1{}).Parse(canonical, 3)
	require.NoError(t, err)
	require.Equal(t, uint32(8), parsed.EndFrame)
	legacyTypes := map[string]bool{}
	for _, e := range parsed.Events {
		legacyTypes[e.Type] = true
	}
	for _, kind := range []string{"inventorySnapshot", "serverFps", "weather", "radioTransmission", "captured", "endMission"} {
		require.True(t, legacyTypes[kind], kind)
	}
	found := false
	for _, e := range parsed.EntityPositions {
		if e.EntityID == 1 {
			require.NotEmpty(t, e.Positions)
			require.Equal(t, uint32(1), e.Positions[0].FrameNum)
			found = true
		}
	}
	require.True(t, found)
}

func TestChunkFlusherGapsAndLateStates(t *testing.T) {
	dir := t.TempDir()
	cf, err := NewChunkFlusher(dir, 3)
	require.NoError(t, err)
	require.NoError(t, cf.AddSoldierState(10, &pb.SoldierState{Id: 1}))
	require.NoError(t, cf.AddVehicleState(1, &pb.VehicleState{Id: 2}))
	require.NoError(t, cf.AddSoldierState(10, &pb.SoldierState{Id: 3}))
	require.NoError(t, cf.FlushThrough(15))
	require.Equal(t, uint32(5), cf.ChunkCount())
	for i := uint32(0); i < 5; i++ {
		data, err := os.ReadFile(cf.chunkPath(i))
		require.NoError(t, err)
		var c pb.Chunk
		require.NoError(t, proto.Unmarshal(data, &c))
		require.Equal(t, i, c.Index)
		if i == 0 {
			require.Len(t, c.Frames, 1)
			require.Equal(t, uint32(1), c.Frames[0].FrameNum)
			require.Len(t, c.Frames[0].Vehicles, 1)
		}
		if i == 3 {
			require.Len(t, c.Frames, 1)
			require.Len(t, c.Frames[0].Soldiers, 2)
		}
	}
}

func TestLegacyStreamFramesAndPayloads(t *testing.T) {
	s := NewSession()
	s.SetFrameBase(0)
	s.SetMission(&core.Mission{MissionName: "Legacy proxy", CaptureDelay: 1}, &core.World{WorldName: "altis"})
	for _, env := range []streaming.Envelope{
		{Type: streaming.TypeAddSoldier, Payload: json.RawMessage(`{"ID":1,"JoinFrame":0,"UnitName":"Legacy","IsPlayer":true}`)},
		{Type: streaming.TypeSoldierState, Payload: json.RawMessage(`{"SoldierID":1,"CaptureFrame":1,"Lifestate":1}`)},
		{Type: streaming.TypeAddMarker, Payload: json.RawMessage(`{"MarkerName":"LegacyMarker","CaptureFrame":0,"EndFrame":-1}`)},
		{Type: streaming.TypeProjectileEvent, Payload: json.RawMessage(`{"CaptureFrame":1,"FirerObjectID":1,"SimulationType":"shotBullet","Trajectory":[{"Frame":1},{"Frame":4}]}`)},
		{Type: streaming.TypeGeneralEvent, Payload: json.RawMessage(`{"CaptureFrame":3,"Name":"inventorySnapshot","Message":"{\"unitId\":1,\"diffOf\":1}"}`)},
	} {
		require.NoError(t, s.HandleMessage(env))
	}
	require.Equal(t, core.Frame(1), s.soldiers[1].States[0].CaptureFrame)
	require.Equal(t, core.Frame(4), s.projectiles[0].Trajectory[1].FrameNum)
	require.JSONEq(t, `{"unitId":1,"diffOf":1}`, s.events[0].general.Message)
	data := s.ToV1JSON()
	require.Equal(t, core.Frame(4), data["endFrame"])
	require.Equal(t, -1, data["Markers"].([]any)[0].([]any)[3])
}
