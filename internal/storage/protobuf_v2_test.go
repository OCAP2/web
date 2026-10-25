package storage

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/proto"

	pbv2 "github.com/OCAP2/web/pkg/schemas/protobuf/v2"
)

// writeV2Manifest stores a v2 manifest the way ingestion lays it out and returns
// an engine rooted at dir, so the tests read it back through GetManifest — the
// same path the API handlers use.
func writeV2Manifest(t *testing.T, dir, name string, m *pbv2.Manifest) *ProtobufEngine {
	t.Helper()
	missionDir := filepath.Join(dir, name)
	require.NoError(t, os.MkdirAll(missionDir, 0755))
	data, err := proto.Marshal(m)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(missionDir, "manifest.pb"), data, 0644))
	return NewProtobufEngine(dir)
}

func getV2(t *testing.T, e *ProtobufEngine, name string) *Manifest {
	t.Helper()
	m, err := e.GetManifest(context.Background(), name)
	require.NoError(t, err)
	return m
}

func TestGetManifestV2_HeaderAndEntities(t *testing.T) {
	dir := t.TempDir()
	engine := writeV2Manifest(t, dir, "rec", &pbv2.Manifest{
		Version:        2,
		World:          &pbv2.WorldMeta{WorldName: "altis"},
		Mission:        &pbv2.MissionMeta{MissionName: "Operation DAWN", ExtensionVersion: "5.0.2", AddonVersion: "1.4.0"},
		FrameCount:     900,
		ChunkSize:      300,
		CaptureDelayMs: 1000,
		ChunkCount:     3,
		Soldiers: []*pbv2.SoldierDef{{
			Id: 7, Name: "Nosey", Side: pbv2.Side_SIDE_WEST, GroupName: "Blackfoot 1-1",
			Role: "Squad Leader", StartFrame: 3, EndFrame: 880, IsPlayer: true,
		}},
		Vehicles: []*pbv2.VehicleDef{{
			Id: 4, Name: "Medic truck", VehicleClass: "car", StartFrame: 1, EndFrame: 120,
		}},
	})

	m := getV2(t, engine, "rec")

	assert.Equal(t, uint32(2), m.Version)
	assert.Equal(t, "altis", m.WorldName)
	assert.Equal(t, "Operation DAWN", m.MissionName)
	assert.Equal(t, "5.0.2", m.ExtensionVersion)
	assert.Equal(t, "1.4.0", m.AddonVersion)
	// The manifest stores a count; playback wants the last valid frame index.
	assert.Equal(t, uint32(899), m.EndFrame)
	assert.Equal(t, uint32(300), m.ChunkSize)
	assert.Equal(t, uint32(1000), m.CaptureDelayMs)
	assert.Equal(t, uint32(3), m.ChunkCount)

	require.Len(t, m.Entities, 2)

	unit := m.Entities[0]
	assert.Equal(t, uint32(7), unit.ID)
	assert.Equal(t, "unit", unit.Type)
	assert.Equal(t, "Nosey", unit.Name)
	assert.Equal(t, "WEST", unit.Side)
	assert.Equal(t, "Blackfoot 1-1", unit.Group)
	assert.Equal(t, "Squad Leader", unit.Role)
	assert.Equal(t, uint32(3), unit.StartFrame)
	assert.Equal(t, uint32(880), unit.EndFrame)
	assert.True(t, unit.IsPlayer)

	vehicle := m.Entities[1]
	assert.Equal(t, uint32(4), vehicle.ID)
	assert.Equal(t, "vehicle", vehicle.Type)
	assert.Equal(t, "Medic truck", vehicle.Name)
	assert.Equal(t, "car", vehicle.VehicleClass)
	assert.Equal(t, uint32(1), vehicle.StartFrame)
	assert.Equal(t, uint32(120), vehicle.EndFrame)
}

// A frame count of zero means no frames were captured. It must not be
// decremented, or the unsigned subtraction wraps to a huge end frame and
// playback probes chunks that do not exist.
func TestGetManifestV2_ZeroFrameCountKeepsZeroEndFrame(t *testing.T) {
	dir := t.TempDir()
	engine := writeV2Manifest(t, dir, "rec", &pbv2.Manifest{Version: 2, FrameCount: 0, ChunkSize: 300})

	m := getV2(t, engine, "rec")

	assert.Equal(t, uint32(0), m.EndFrame)
	assert.Empty(t, m.Entities)
	assert.Empty(t, m.Events)
}

func TestGetManifestV2_SideMapping(t *testing.T) {
	cases := []struct {
		side pbv2.Side
		want string
	}{
		{pbv2.Side_SIDE_WEST, "WEST"},
		{pbv2.Side_SIDE_EAST, "EAST"},
		{pbv2.Side_SIDE_GUER, "GUER"},
		{pbv2.Side_SIDE_CIV, "CIV"},
		{pbv2.Side_SIDE_UNKNOWN, "UNKNOWN"},
		{pbv2.Side_SIDE_GLOBAL, "UNKNOWN"},
	}
	for _, tc := range cases {
		t.Run(tc.want+"/"+tc.side.String(), func(t *testing.T) {
			dir := t.TempDir()
			engine := writeV2Manifest(t, dir, "rec", &pbv2.Manifest{
				Version:  2,
				Soldiers: []*pbv2.SoldierDef{{Id: 1, Side: tc.side}},
			})

			m := getV2(t, engine, "rec")

			require.Len(t, m.Entities, 1)
			assert.Equal(t, tc.want, m.Entities[0].Side)
		})
	}
}

func TestGetManifestV2_Events(t *testing.T) {
	extra, err := json.Marshal(map[string]any{"Side": "EAST", "Position": []float32{12, 34}})
	require.NoError(t, err)

	dir := t.TempDir()
	engine := writeV2Manifest(t, dir, "rec", &pbv2.Manifest{
		Version:    2,
		FrameCount: 100,
		Events: []*pbv2.Event{
			{FrameNum: 1, Event: &pbv2.Event_Kill{Kill: &pbv2.KillEvent{
				KillerSoldierId: 1, VictimSoldierId: 2, EventText: "M16A4", Distance: 210.5,
			}}},
			{FrameNum: 2, Event: &pbv2.Event_Kill{Kill: &pbv2.KillEvent{
				KillerSoldierId: 1, KillerVehicleId: 9, KillerIsVehicle: true,
				VictimSoldierId: 2, VictimVehicleId: 8, VictimIsVehicle: true, EventText: "RAM",
			}}},
			{FrameNum: 3, Event: &pbv2.Event_Hit{Hit: &pbv2.HitEvent{
				ShooterSoldierId: 3, VictimSoldierId: 4, EventText: "MXM", Distance: 44,
			}}},
			{FrameNum: 4, Event: &pbv2.Event_Hit{Hit: &pbv2.HitEvent{
				ShooterSoldierId: 3, ShooterVehicleId: 11, ShooterIsVehicle: true,
				VictimSoldierId: 4, VictimVehicleId: 12, VictimIsVehicle: true, EventText: "BGM",
			}}},
			{FrameNum: 5, Event: &pbv2.Event_General{General: &pbv2.GeneralEvent{
				Name: "captured", Message: "flag captured", ObjectType: "Flag_USEC_F",
				UnitName: "Nosey", Side: "WEST",
			}}},
			// No Side of its own: it falls back to extra_data_json for side and position.
			{FrameNum: 6, Event: &pbv2.Event_General{General: &pbv2.GeneralEvent{
				Name: "contested", Message: "flag contested", ExtraDataJson: extra,
			}}},
			{FrameNum: 7, Event: &pbv2.Event_Connect{Connect: &pbv2.ConnectEvent{UnitName: "Boop", IsConnect: true}}},
			{FrameNum: 8, Event: &pbv2.Event_Connect{Connect: &pbv2.ConnectEvent{UnitName: "Boop"}}},
			{FrameNum: 9, Event: &pbv2.Event_EndMission{EndMission: &pbv2.EndMissionEvent{Side: "EAST", Message: "mission ended"}}},
			// Chat has no v1 storage representation and is skipped rather than
			// surfacing as an empty event row.
			{FrameNum: 10, Event: &pbv2.Event_Chat{Chat: &pbv2.ChatEvent{Channel: "SIDE", Message: "hi"}}},
		},
	})

	m := getV2(t, engine, "rec")

	require.Len(t, m.Events, 9, "chat is skipped, everything else maps")

	kill := m.Events[0]
	assert.Equal(t, "killed", kill.Type)
	assert.Equal(t, uint32(1), kill.SourceID)
	assert.Equal(t, uint32(2), kill.TargetID)
	assert.Equal(t, "M16A4", kill.Weapon)
	assert.InDelta(t, 210.5, kill.Distance, 1e-5)

	// Vehicle flags swap the id to the vehicle side of the pair.
	killVeh := m.Events[1]
	assert.Equal(t, "killed", killVeh.Type)
	assert.Equal(t, uint32(9), killVeh.SourceID)
	assert.Equal(t, uint32(8), killVeh.TargetID)

	hit := m.Events[2]
	assert.Equal(t, "hit", hit.Type)
	assert.Equal(t, uint32(3), hit.SourceID)
	assert.Equal(t, uint32(4), hit.TargetID)
	assert.Equal(t, "MXM", hit.Weapon)

	hitVeh := m.Events[3]
	assert.Equal(t, "hit", hitVeh.Type)
	assert.Equal(t, uint32(11), hitVeh.SourceID)
	assert.Equal(t, uint32(12), hitVeh.TargetID)

	general := m.Events[4]
	assert.Equal(t, "captured", general.Type)
	assert.Equal(t, "flag captured", general.Message)
	assert.Equal(t, "WEST", general.Side)
	assert.Equal(t, "Flag_USEC_F", general.ObjectType)
	assert.Equal(t, "Nosey", general.UnitName)

	fallback := m.Events[5]
	assert.Equal(t, "contested", fallback.Type)
	assert.Equal(t, "EAST", fallback.Side, "side falls back to extra_data_json")
	assert.InDelta(t, 12, fallback.PosX, 1e-5)
	assert.InDelta(t, 34, fallback.PosY, 1e-5)

	assert.Equal(t, "connected", m.Events[6].Type)
	assert.Equal(t, "Boop", m.Events[6].Message)
	assert.Equal(t, "disconnected", m.Events[7].Type)

	endMission := m.Events[8]
	assert.Equal(t, "endMission", endMission.Type)
	assert.Equal(t, "EAST", endMission.Side)
	assert.Equal(t, "mission ended", endMission.Message)
}

// A general event whose extra_data_json is absent or too short must leave the
// position untouched instead of reading past the slice.
func TestGetManifestV2_GeneralEventWithoutExtraData(t *testing.T) {
	dir := t.TempDir()
	engine := writeV2Manifest(t, dir, "rec", &pbv2.Manifest{
		Version: 2,
		Events: []*pbv2.Event{
			{FrameNum: 1, Event: &pbv2.Event_General{General: &pbv2.GeneralEvent{Name: "killedFlag", Message: "no extra"}}},
			{FrameNum: 2, Event: &pbv2.Event_General{General: &pbv2.GeneralEvent{
				Name: "capturedFlag", Message: "one coordinate only",
				ExtraDataJson: []byte(`{"Side":"GUER","Position":[5]}`),
			}}},
		},
	})

	m := getV2(t, engine, "rec")

	require.Len(t, m.Events, 2)

	assert.Equal(t, "killedFlag", m.Events[0].Type)
	assert.Empty(t, m.Events[0].Side)
	assert.Zero(t, m.Events[0].PosX)
	assert.Zero(t, m.Events[0].PosY)

	// A single coordinate is not a position; the side still comes from extra data.
	assert.Equal(t, "GUER", m.Events[1].Side)
	assert.Zero(t, m.Events[1].PosX)
	assert.Zero(t, m.Events[1].PosY)
}

// Malformed extra_data_json is tolerated: the event still loads with its own
// fields intact, because a bad optional blob must not drop a real event.
func TestGetManifestV2_GeneralEventInvalidExtraDataJSON(t *testing.T) {
	dir := t.TempDir()
	engine := writeV2Manifest(t, dir, "rec", &pbv2.Manifest{
		Version: 2,
		Events: []*pbv2.Event{{FrameNum: 1, Event: &pbv2.Event_General{General: &pbv2.GeneralEvent{
			Name: "captured", Message: "m", Side: "CIV", ExtraDataJson: []byte("not json"),
		}}}},
	})

	m := getV2(t, engine, "rec")

	require.Len(t, m.Events, 1)
	assert.Equal(t, "captured", m.Events[0].Type)
	assert.Equal(t, "CIV", m.Events[0].Side)
}

func TestGetManifestV2_MissingWorldAndMissionSections(t *testing.T) {
	dir := t.TempDir()
	engine := writeV2Manifest(t, dir, "rec", &pbv2.Manifest{Version: 2, FrameCount: 10})

	m := getV2(t, engine, "rec")

	assert.Empty(t, m.WorldName)
	assert.Empty(t, m.MissionName)
	assert.Empty(t, m.ExtensionVersion)
	assert.Empty(t, m.AddonVersion)
	assert.Equal(t, uint32(9), m.EndFrame)
}

// A manifest tagged version 2 but truncated must be reported by the v2 reader.
// The two readers fail differently: v1 wraps its error, so the message is what
// proves the v2 path was taken rather than a silent v1 fallback.
func TestGetManifestV2_UnmarshalFailure(t *testing.T) {
	dir := t.TempDir()
	missionDir := filepath.Join(dir, "rec")
	require.NoError(t, os.MkdirAll(missionDir, 0755))

	data := protowire.AppendTag(nil, 1, protowire.VarintType)
	data = protowire.AppendVarint(data, 2)
	data = protowire.AppendTag(data, 10, protowire.BytesType)
	data = protowire.AppendVarint(data, 50) // promises 50 bytes that never arrive

	require.NoError(t, os.WriteFile(filepath.Join(missionDir, "manifest.pb"), data, 0644))

	_, err := NewProtobufEngine(dir).GetManifest(context.Background(), "rec")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "cannot parse invalid wire-format data")
	assert.NotContains(t, err.Error(), "unmarshal manifest:",
		"must fail in readV2Manifest; the v1 reader wraps its error with this prefix")
}
