package ingestion

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/OCAP2/extension/v5/pkg/core"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	pbv2 "github.com/OCAP2/web/pkg/schemas/protobuf/v2"
)

func TestSideStringToProto(t *testing.T) {
	cases := []struct {
		in   string
		want pbv2.Side
	}{
		{"WEST", pbv2.Side_SIDE_WEST},
		{"west", pbv2.Side_SIDE_WEST},
		{"Blufor", pbv2.Side_SIDE_WEST},
		{"BLUFOR", pbv2.Side_SIDE_WEST},
		{"EAST", pbv2.Side_SIDE_EAST},
		{"opfor", pbv2.Side_SIDE_EAST},
		{"GUER", pbv2.Side_SIDE_GUER},
		{"independent", pbv2.Side_SIDE_GUER},
		{"CIV", pbv2.Side_SIDE_CIV},
		{"civilian", pbv2.Side_SIDE_CIV},
		{"GLOBAL", pbv2.Side_SIDE_GLOBAL},
		{"", pbv2.Side_SIDE_UNKNOWN},
		{"sideways", pbv2.Side_SIDE_UNKNOWN},
	}
	for _, tc := range cases {
		t.Run(tc.in, func(t *testing.T) {
			assert.Equal(t, tc.want, sideStringToProto(tc.in))
		})
	}
}

func TestCaptureDelayMs(t *testing.T) {
	t.Run("no mission falls back to one second", func(t *testing.T) {
		assert.Equal(t, uint32(1000), captureDelayMs(NewSession()))
	})

	t.Run("zero delay falls back to one second", func(t *testing.T) {
		s := NewSession()
		s.SetMission(&core.Mission{CaptureDelay: 0}, nil)
		assert.Equal(t, uint32(1000), captureDelayMs(s))
	})

	// A non-positive delay would make playback divide by a useless interval.
	t.Run("negative delay falls back to one second", func(t *testing.T) {
		s := NewSession()
		s.SetMission(&core.Mission{CaptureDelay: -1}, nil)
		assert.Equal(t, uint32(1000), captureDelayMs(s))
	})

	t.Run("delay converts seconds to milliseconds", func(t *testing.T) {
		s := NewSession()
		s.SetMission(&core.Mission{CaptureDelay: 2.5}, nil)
		assert.Equal(t, uint32(2500), captureDelayMs(s))
	})
}

// An event record whose typed payload is missing must produce no proto event;
// emitting an empty one would surface a blank row in the timeline.
func TestEventToProto_MissingTypedPayloadReturnsNil(t *testing.T) {
	cases := []struct {
		name string
		rec  eventRecord
	}{
		{"killed without kill", eventRecord{eventType: "killed"}},
		{"hit without hit", eventRecord{eventType: "hit"}},
		{"chat without chat", eventRecord{eventType: "chat"}},
		{"general without general", eventRecord{eventType: "captured"}},
		{"unknown type without general", eventRecord{eventType: "somethingElse"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Nil(t, eventToProto(tc.rec))
		})
	}
}

func TestEventToProto_KillVehicleFlags(t *testing.T) {
	victimSoldier := uint(3)
	victimVehicle := uint(12)
	killerSoldier := uint(1)
	killerVehicle := uint(9)

	evt := eventToProto(eventRecord{
		eventType: "killed",
		frame:     55,
		kill: &core.KillEvent{
			VictimSoldierID: &victimSoldier,
			VictimVehicleID: &victimVehicle,
			KillerSoldierID: &killerSoldier,
			KillerVehicleID: &killerVehicle,
			WeaponName:      "M16A4",
			WeaponMagazine:  "30Rnd_556x45",
			EventText:       "M16A4 [30Rnd_556x45]",
			Distance:        120,
		},
	})

	require.NotNil(t, evt)
	assert.Equal(t, uint32(55), evt.FrameNum)

	kill := evt.GetKill()
	require.NotNil(t, kill)
	// The vehicle id is carried alongside the is-vehicle flag so the reader knows
	// which id field to trust.
	assert.True(t, kill.VictimIsVehicle)
	assert.Equal(t, uint32(12), kill.VictimVehicleId)
	assert.Equal(t, uint32(3), kill.VictimSoldierId)
	assert.True(t, kill.KillerIsVehicle)
	assert.Equal(t, uint32(9), kill.KillerVehicleId)
	assert.Equal(t, uint32(1), kill.KillerSoldierId)
	assert.Equal(t, "M16A4", kill.WeaponName)
	assert.Equal(t, "30Rnd_556x45", kill.WeaponMagazine)
	assert.InDelta(t, 120, kill.Distance, 1e-5)
}

// Soldier-only kills must not raise the vehicle flags.
func TestEventToProto_KillSoldierOnly(t *testing.T) {
	victim := uint(3)
	killer := uint(1)

	kill := eventToProto(eventRecord{
		eventType: "killed",
		kill:      &core.KillEvent{VictimSoldierID: &victim, KillerSoldierID: &killer},
	}).GetKill()

	require.NotNil(t, kill)
	assert.False(t, kill.VictimIsVehicle)
	assert.False(t, kill.KillerIsVehicle)
	assert.Equal(t, uint32(3), kill.VictimSoldierId)
	assert.Equal(t, uint32(1), kill.KillerSoldierId)
}

func TestEventToProto_HitVehicleFlags(t *testing.T) {
	victimVehicle := uint(12)
	shooterVehicle := uint(9)

	hit := eventToProto(eventRecord{
		eventType: "hit",
		hit: &core.HitEvent{
			VictimVehicleID:  &victimVehicle,
			ShooterVehicleID: &shooterVehicle,
			WeaponName:       "Titan",
			EventText:        "Titan [Titan AP]",
			Distance:         300,
		},
	}).GetHit()

	require.NotNil(t, hit)
	assert.True(t, hit.VictimIsVehicle)
	assert.Equal(t, uint32(12), hit.VictimVehicleId)
	assert.True(t, hit.ShooterIsVehicle)
	assert.Equal(t, uint32(9), hit.ShooterVehicleId)
	assert.Equal(t, "Titan", hit.WeaponName)
	assert.Equal(t, "Titan [Titan AP]", hit.EventText)
	assert.InDelta(t, 300, hit.Distance, 1e-5)
}

func TestEventToProto_HitSoldierOnly(t *testing.T) {
	victim := uint(4)
	shooter := uint(2)

	hit := eventToProto(eventRecord{
		eventType: "hit",
		hit:       &core.HitEvent{VictimSoldierID: &victim, ShooterSoldierID: &shooter},
	}).GetHit()

	require.NotNil(t, hit)
	assert.False(t, hit.VictimIsVehicle)
	assert.False(t, hit.ShooterIsVehicle)
	assert.Equal(t, uint32(4), hit.VictimSoldierId)
	assert.Equal(t, uint32(2), hit.ShooterSoldierId)
}

func TestEventToProto_Chat(t *testing.T) {
	soldierID := uint(7)

	evt := eventToProto(eventRecord{
		eventType: "chat",
		frame:     12,
		chat: &core.ChatEvent{
			Channel:   "SIDE",
			FromName:  "Nosey",
			Message:   "moving up",
			PlayerUID: "76561198000000000",
			SoldierID: &soldierID,
		},
	})

	require.NotNil(t, evt)
	assert.Equal(t, uint32(12), evt.FrameNum)
	chat := evt.GetChat()
	require.NotNil(t, chat)
	assert.Equal(t, "SIDE", chat.Channel)
	assert.Equal(t, "Nosey", chat.FromName)
	assert.Equal(t, "moving up", chat.Message)
	assert.Equal(t, "76561198000000000", chat.PlayerUid)
	assert.Equal(t, uint32(7), chat.SoldierId)
}

// A chat without a resolved soldier id keeps the default rather than a bogus one.
func TestEventToProto_ChatWithoutSoldierID(t *testing.T) {
	chat := eventToProto(eventRecord{eventType: "chat", chat: &core.ChatEvent{Message: "hi"}}).GetChat()
	require.NotNil(t, chat)
	assert.Equal(t, uint32(0), chat.SoldierId)
}

// General events carry their structured payload as JSON and lift the three keys
// the timeline filters on into real fields.
func TestEventToProto_GeneralExtraData(t *testing.T) {
	evt := eventToProto(eventRecord{
		eventType: "captured",
		frame:     80,
		general: &core.GeneralEvent{
			CaptureFrame: 80,
			Name:         "captured",
			Message:      "flag captured",
			ExtraData: map[string]any{
				"objectType": "Flag_USEC_F",
				"unitName":   "Nosey",
				"side":       "WEST",
				"position":   []any{12.0, 34.0},
			},
		},
	})

	require.NotNil(t, evt)
	assert.Equal(t, uint32(80), evt.FrameNum)

	ge := evt.GetGeneral()
	require.NotNil(t, ge)
	// The proto name comes from the record type, which is what the reader keys on.
	assert.Equal(t, "captured", ge.Name)
	assert.Equal(t, "flag captured", ge.Message)
	assert.Equal(t, "Flag_USEC_F", ge.ObjectType)
	assert.Equal(t, "Nosey", ge.UnitName)
	assert.Equal(t, "WEST", ge.Side)
	assert.JSONEq(t, `{"objectType":"Flag_USEC_F","unitName":"Nosey","side":"WEST","position":[12,34]}`, string(ge.ExtraDataJson))
}

// Non-string extra-data values must not panic or poison the lifted fields.
func TestEventToProto_GeneralExtraDataWrongTypes(t *testing.T) {
	evt := eventToProto(eventRecord{
		eventType: "contested",
		general: &core.GeneralEvent{
			Name:      "contested",
			Message:   "m",
			ExtraData: map[string]any{"objectType": 1, "unitName": nil, "side": true},
		},
	})

	ge := evt.GetGeneral()
	require.NotNil(t, ge)
	assert.Empty(t, ge.ObjectType)
	assert.Empty(t, ge.UnitName)
	assert.Empty(t, ge.Side)
}

func TestEventToProto_GeneralWithoutExtraData(t *testing.T) {
	ge := eventToProto(eventRecord{eventType: "killedFlag", general: &core.GeneralEvent{Message: "m"}}).GetGeneral()
	require.NotNil(t, ge)
	assert.Equal(t, "killedFlag", ge.Name)
	assert.Empty(t, ge.ObjectType)
}

func TestMarkerToProto_BasicIconMarker(t *testing.T) {
	marker := markerToProto(&markerRecord{Marker: core.Marker{
		CaptureFrame: 4,
		EndFrame:     90,
		MarkerType:   "mil_dot",
		Text:         "AAP",
		OwnerID:      12,
		Color:        "#FF0000",
		Side:         "OPFOR",
		Shape:        "ICON",
		Brush:        "Solid",
		Size:         "[32,32]",
		Alpha:        0.8,
		Direction:    45,
		Position:     core.Position3D{X: 100, Y: 200, Z: 5},
	}})

	assert.Equal(t, "mil_dot", marker.Type)
	assert.Equal(t, "AAP", marker.Text)
	assert.Equal(t, uint32(4), marker.StartFrame)
	assert.Equal(t, uint32(90), marker.EndFrame)
	assert.Equal(t, int32(12), marker.PlayerId)
	// The leading "#" is a UI convention; the stored form is a bare hex code.
	assert.Equal(t, "FF0000", marker.Color)
	assert.Equal(t, pbv2.Side_SIDE_EAST, marker.Side)
	assert.Equal(t, "ICON", marker.Shape)
	assert.Equal(t, "Solid", marker.Brush)
	assert.Equal(t, []float32{32, 32}, marker.Size)
	assert.Nil(t, marker.DeletedFrame)

	require.Len(t, marker.Positions, 1)
	require.NotNil(t, marker.Positions[0].Position)
	assert.InDelta(t, 100, marker.Positions[0].Position.X, 1e-5)
	assert.InDelta(t, 0.8, marker.Positions[0].Alpha, 1e-5)
	assert.InDelta(t, 45, marker.Positions[0].Direction, 1e-5)
	assert.False(t, marker.Positions[0].HasStyle)
}

// EndFrame 0 means "persists for the whole mission", not "ends immediately".
func TestMarkerToProto_ZeroEndFrameIsPreserved(t *testing.T) {
	marker := markerToProto(&markerRecord{Marker: core.Marker{CaptureFrame: 1, EndFrame: 0}})
	assert.Equal(t, uint32(0), marker.EndFrame)
	assert.Nil(t, marker.DeletedFrame)
}

func TestMarkerToProto_DeletedMarkerRecordsDeletedFrame(t *testing.T) {
	marker := markerToProto(&markerRecord{Marker: core.Marker{
		CaptureFrame: 3,
		EndFrame:     42,
		IsDeleted:    true,
	}})

	require.NotNil(t, marker.DeletedFrame, "a deleted marker must record when it disappeared")
	assert.Equal(t, uint32(42), *marker.DeletedFrame)
}

// A polyline marker stores flattened coordinate pairs instead of a position.
func TestMarkerToProto_Polyline(t *testing.T) {
	marker := markerToProto(&markerRecord{Marker: core.Marker{
		CaptureFrame: 7,
		Shape:        "POLYLINE",
		Polyline:     core.Polyline{{X: 1, Y: 2}, {X: 3, Y: 4}, {X: 5, Y: 6}},
	}})

	require.Len(t, marker.Positions, 1)
	mp := marker.Positions[0]
	assert.Nil(t, mp.Position, "a polyline carries line coordinates, not a single position")
	assert.Equal(t, []float32{1, 2, 3, 4, 5, 6}, mp.LineCoords)
	assert.Equal(t, uint32(7), mp.FrameNum)
}

// A POLYLINE shape with no points does not satisfy the line branch, so it falls
// back to the ordinary single-position form rather than storing empty geometry.
func TestMarkerToProto_PolylineWithoutPoints(t *testing.T) {
	marker := markerToProto(&markerRecord{Marker: core.Marker{CaptureFrame: 2, Shape: "POLYLINE"}})

	require.Len(t, marker.Positions, 1)
	mp := marker.Positions[0]
	assert.Empty(t, mp.LineCoords)
	require.NotNil(t, mp.Position)
	assert.Equal(t, uint32(2), mp.FrameNum)
}

// A polyline with a single point is still a line, so it keeps the line shape.
func TestMarkerToProto_PolylineSinglePoint(t *testing.T) {
	marker := markerToProto(&markerRecord{Marker: core.Marker{
		CaptureFrame: 3,
		Shape:        "POLYLINE",
		Polyline:     core.Polyline{{X: 9, Y: 8}},
	}})

	require.Len(t, marker.Positions, 1)
	assert.Nil(t, marker.Positions[0].Position)
	assert.Equal(t, []float32{9, 8}, marker.Positions[0].LineCoords)
}

// Moving markers append their trajectory as states; style is only flagged when
// something actually changed, which keeps unchanged frames cheap to store.
func TestMarkerToProto_StatesAndStyleFlags(t *testing.T) {
	marker := markerToProto(&markerRecord{
		Marker: core.Marker{CaptureFrame: 0, Shape: "ICON", MarkerType: "mil_dot", Position: core.Position3D{X: 0}},
		States: []core.MarkerState{
			{CaptureFrame: 1, Position: core.Position3D{X: 10, Y: 20, Z: 1}},
			{CaptureFrame: 2, Position: core.Position3D{X: 20, Y: 30}, Text: "renamed", Color: "#00FF00"},
			{CaptureFrame: 3, Position: core.Position3D{X: 30}, MarkerType: "mil_box", Size: "[64,64]", Brush: "Vertical", Shape: "ELLIPSE"},
		},
	})

	// One initial position plus one entry per state.
	require.Len(t, marker.Positions, 4)

	moved := marker.Positions[1]
	assert.Equal(t, uint32(1), moved.FrameNum)
	assert.False(t, moved.HasStyle, "a move alone changes no style")
	require.NotNil(t, moved.Position)
	assert.InDelta(t, 10, moved.Position.X, 1e-5)

	restyled := marker.Positions[2]
	assert.True(t, restyled.HasStyle)
	assert.Equal(t, "renamed", restyled.Text)
	assert.Equal(t, "00FF00", restyled.Color, "state colours drop the leading # too")

	reshaped := marker.Positions[3]
	assert.True(t, reshaped.HasStyle)
	assert.Equal(t, "mil_box", reshaped.Type)
	assert.Equal(t, []float32{64, 64}, reshaped.Size)
	assert.Equal(t, "Vertical", reshaped.Brush)
	assert.Equal(t, "ELLIPSE", reshaped.Shape)
}

// Every style field has to flip HasStyle on its own. Dropping any one of them
// from the check means a restyle that changes only that field is stored without
// its style, so the map keeps drawing the old text, colour or icon.
func TestMarkerToProto_EachStyleFieldFlipsHasStyle(t *testing.T) {
	cases := []struct {
		name        string
		style       core.MarkerState
		expectStyle bool
		check       func(t *testing.T, mp *pbv2.MarkerPosition)
	}{
		{
			name:        "text only",
			style:       core.MarkerState{Text: "renamed"},
			expectStyle: true,
			check:       func(t *testing.T, mp *pbv2.MarkerPosition) { assert.Equal(t, "renamed", mp.Text) },
		},
		{
			name:        "colour only",
			style:       core.MarkerState{Color: "#00FF00"},
			expectStyle: true,
			check:       func(t *testing.T, mp *pbv2.MarkerPosition) { assert.Equal(t, "00FF00", mp.Color) },
		},
		{
			name:        "size only",
			style:       core.MarkerState{Size: "[8,8]"},
			expectStyle: true,
			check:       func(t *testing.T, mp *pbv2.MarkerPosition) { assert.Equal(t, []float32{8, 8}, mp.Size) },
		},
		{
			name:        "marker type only",
			style:       core.MarkerState{MarkerType: "mil_box"},
			expectStyle: true,
			check:       func(t *testing.T, mp *pbv2.MarkerPosition) { assert.Equal(t, "mil_box", mp.Type) },
		},
		{
			name:        "brush only",
			style:       core.MarkerState{Brush: "Vertical"},
			expectStyle: true,
			check:       func(t *testing.T, mp *pbv2.MarkerPosition) { assert.Equal(t, "Vertical", mp.Brush) },
		},
		{
			name:        "shape only",
			style:       core.MarkerState{Shape: "ELLIPSE"},
			expectStyle: true,
			check:       func(t *testing.T, mp *pbv2.MarkerPosition) { assert.Equal(t, "ELLIPSE", mp.Shape) },
		},
		{
			name:        "position only",
			expectStyle: false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			state := tc.style
			state.CaptureFrame = 1
			state.Position = core.Position3D{X: 5, Y: 6}

			marker := markerToProto(&markerRecord{
				Marker: core.Marker{CaptureFrame: 0, Shape: "ICON", MarkerType: "mil_dot"},
				States: []core.MarkerState{state},
			})

			require.Len(t, marker.Positions, 2)
			mp := marker.Positions[1]
			if tc.expectStyle {
				assert.True(t, mp.HasStyle, "a change to %s must be flagged as a style change", tc.name)
			} else {
				assert.False(t, mp.HasStyle, "a move alone is not a style change")
			}
			if tc.check != nil {
				tc.check(t, mp)
			}
		})
	}
}

// A polyline is geometry rather than a moving icon, so its states are dropped
// instead of being written as extra positions. Pinned as intended behaviour.
func TestMarkerToProto_PolylineDropsStates(t *testing.T) {
	marker := markerToProto(&markerRecord{
		Marker: core.Marker{
			CaptureFrame: 1,
			Shape:        "POLYLINE",
			Polyline:     core.Polyline{{X: 1, Y: 2}, {X: 3, Y: 4}},
		},
		States: []core.MarkerState{{CaptureFrame: 5, Position: core.Position3D{X: 9, Y: 9}, Text: "ignored"}},
	})

	require.Len(t, marker.Positions, 1, "only the initial geometry is carried")
	assert.Equal(t, []float32{1, 2, 3, 4}, marker.Positions[0].LineCoords)
	assert.Empty(t, marker.Positions[0].Text)
}

func TestProjectileToProtoEvent(t *testing.T) {
	vehicleID := uint16(9)
	soldierVictim := uint16(8)
	vehicleVictim := uint16(11)

	evt := projectileToProtoEvent(core.ProjectileEvent{
		CaptureFrame:    30,
		FirerObjectID:   5,
		VehicleObjectID: &vehicleID,
		WeaponDisplay:   "Titan launcher",
		MagazineDisplay: "Titan AP",
		MuzzleDisplay:   "Titan",
		MagazineIcon:    "z\\addons\\titan.paa",
		SimulationType:  "shotRocket",
		Trajectory: []core.TrajectoryPoint{
			{FrameNum: 30, Position: core.Position3D{X: 0, Y: 0, Z: 2}},
			{FrameNum: 33, Position: core.Position3D{X: 60, Y: 10, Z: 20}},
		},
		Hits: []core.ProjectileHit{
			{CaptureFrame: 34, Position: core.Position3D{X: 70, Y: 12, Z: 0}, SoldierID: &soldierVictim, ComponentsHit: []string{"hitbody"}},
			{CaptureFrame: 35, Position: core.Position3D{X: 80, Y: 14, Z: 0}, VehicleID: &vehicleVictim, ComponentsHit: []string{"hitengine"}},
		},
	})

	require.NotNil(t, evt)
	assert.Equal(t, uint32(30), evt.FrameNum)

	proj := evt.GetProjectile()
	require.NotNil(t, proj)
	assert.Equal(t, uint32(5), proj.FirerId)
	assert.Equal(t, uint32(9), proj.VehicleId)
	assert.Equal(t, "Titan launcher", proj.Weapon)
	assert.Equal(t, "Titan AP", proj.Magazine)
	assert.Equal(t, "Titan", proj.Muzzle)
	assert.Equal(t, "z\\addons\\titan.paa", proj.MagazineIcon)
	assert.Equal(t, "shotRocket", proj.SimulationType)

	require.Len(t, proj.Trajectory, 2)
	require.NotNil(t, proj.Trajectory[1].Position)
	assert.Equal(t, uint32(33), proj.Trajectory[1].FrameNum)
	assert.InDelta(t, 60, proj.Trajectory[1].Position.X, 1e-5)
	assert.InDelta(t, 20, proj.Trajectory[1].Position.Z, 1e-5)

	require.Len(t, proj.Hits, 2)

	assert.True(t, proj.Hits[0].HitSoldier)
	assert.False(t, proj.Hits[0].HitVehicle)
	assert.Equal(t, uint32(8), proj.Hits[0].SoldierId)
	assert.Equal(t, uint32(34), proj.Hits[0].FrameNum)
	assert.Equal(t, []string{"hitbody"}, proj.Hits[0].ComponentsHit)

	assert.True(t, proj.Hits[1].HitVehicle)
	assert.False(t, proj.Hits[1].HitSoldier)
	assert.Equal(t, uint32(11), proj.Hits[1].VehicleId)
	assert.Equal(t, []string{"hitengine"}, proj.Hits[1].ComponentsHit)
}

// A foot-mobile projectile carries no vehicle id, and one with no hits carries
// an empty hit list rather than a zero-valued entry.
func TestProjectileToProtoEvent_FootSoldierWithoutHits(t *testing.T) {
	proj := projectileToProtoEvent(core.ProjectileEvent{
		FirerObjectID:  5,
		SimulationType: "shotBullet",
		Trajectory:     []core.TrajectoryPoint{{FrameNum: 1}},
	}).GetProjectile()

	require.NotNil(t, proj)
	assert.Equal(t, uint32(0), proj.VehicleId)
	assert.Empty(t, proj.Hits)
	require.Len(t, proj.Trajectory, 1)
}

func TestTelemetryToProtoEvent(t *testing.T) {
	evt := telemetryToProtoEvent(core.TelemetryEvent{
		CaptureFrame: 500,
		FpsAverage:   58.5,
		FpsMin:       31,
		SideEntityCounts: core.SideEntityCounts{
			East: core.SideEntityCount{
				Local:  core.EntityLocality{UnitsTotal: 10, UnitsAlive: 8, UnitsDead: 2, Groups: 3, Vehicles: 2, WeaponHolders: 1},
				Remote: core.EntityLocality{UnitsTotal: 5, UnitsAlive: 5, Groups: 1},
			},
			West: core.SideEntityCount{
				Local: core.EntityLocality{UnitsTotal: 12, UnitsAlive: 12},
			},
		},
		GlobalCounts: core.GlobalEntityCount{
			UnitsAlive: 40, UnitsDead: 4, Groups: 9, Vehicles: 7,
			WeaponHolders: 2, PlayersAlive: 11, PlayersDead: 1, PlayersConnected: 13,
		},
		Scripts: core.ScriptCounts{Spawn: 100, ExecVM: 3, Exec: 44, ExecFSM: 5, PFH: 6},
		Weather: core.WeatherData{
			Fog: 0.2, Overcast: 0.6, Rain: 0.1, Humidity: 0.5, Waves: 0.3,
			WindDir: 270, WindStr: 12, Gusts: 0.4, Lightnings: 0.9,
			MoonIntensity: 0.7, MoonPhase: 0.25, SunOrMoon: 1,
		},
		Players: []core.PlayerNetworkData{
			{UID: "76561198000000000", Name: "Nosey", Ping: 24, BW: 900, Desync: 0.4},
			{UID: "76561198000000001", Name: "Boop", Ping: 51, BW: 700, Desync: 1.2},
		},
	})

	require.NotNil(t, evt)
	assert.Equal(t, uint32(500), evt.FrameNum)

	tele := evt.GetTelemetry()
	require.NotNil(t, tele)
	assert.InDelta(t, 58.5, tele.FpsAverage, 1e-5)
	assert.InDelta(t, 31, tele.FpsMin, 1e-5)

	require.NotNil(t, tele.SideEntityCounts)
	require.NotNil(t, tele.SideEntityCounts.East)
	assert.Equal(t, uint32(10), tele.SideEntityCounts.East.Local.UnitsTotal)
	assert.Equal(t, uint32(8), tele.SideEntityCounts.East.Local.UnitsAlive)
	assert.Equal(t, uint32(2), tele.SideEntityCounts.East.Local.UnitsDead)
	assert.Equal(t, uint32(3), tele.SideEntityCounts.East.Local.Groups)
	assert.Equal(t, uint32(2), tele.SideEntityCounts.East.Local.Vehicles)
	assert.Equal(t, uint32(1), tele.SideEntityCounts.East.Local.WeaponHolders)
	assert.Equal(t, uint32(5), tele.SideEntityCounts.East.Remote.UnitsTotal)

	require.NotNil(t, tele.SideEntityCounts.West)
	assert.Equal(t, uint32(12), tele.SideEntityCounts.West.Local.UnitsTotal)
	// Sides with no traffic still get an entry rather than a nil gap.
	require.NotNil(t, tele.SideEntityCounts.Independent)
	require.NotNil(t, tele.SideEntityCounts.Civilian)
	assert.Equal(t, uint32(0), tele.SideEntityCounts.Independent.Local.UnitsTotal)

	require.NotNil(t, tele.GlobalCounts)
	assert.Equal(t, uint32(40), tele.GlobalCounts.UnitsAlive)
	assert.Equal(t, uint32(4), tele.GlobalCounts.UnitsDead)
	assert.Equal(t, uint32(9), tele.GlobalCounts.Groups)
	assert.Equal(t, uint32(7), tele.GlobalCounts.Vehicles)
	assert.Equal(t, uint32(2), tele.GlobalCounts.WeaponHolders)
	assert.Equal(t, uint32(11), tele.GlobalCounts.PlayersAlive)
	assert.Equal(t, uint32(1), tele.GlobalCounts.PlayersDead)
	assert.Equal(t, uint32(13), tele.GlobalCounts.PlayersConnected)

	require.NotNil(t, tele.Scripts)
	assert.Equal(t, uint32(100), tele.Scripts.Spawn)
	assert.Equal(t, uint32(3), tele.Scripts.ExecVm)
	assert.Equal(t, uint32(44), tele.Scripts.Exec)
	assert.Equal(t, uint32(5), tele.Scripts.ExecFsm)
	assert.Equal(t, uint32(6), tele.Scripts.Pfh)

	require.NotNil(t, tele.Weather)
	assert.InDelta(t, 0.2, tele.Weather.Fog, 1e-5)
	assert.InDelta(t, 0.6, tele.Weather.Overcast, 1e-5)
	assert.InDelta(t, 0.1, tele.Weather.Rain, 1e-5)
	assert.InDelta(t, 0.5, tele.Weather.Humidity, 1e-5)
	assert.InDelta(t, 0.3, tele.Weather.Waves, 1e-5)
	assert.InDelta(t, 12, tele.Weather.WindStr, 1e-5)
	assert.InDelta(t, 270, tele.Weather.WindDir, 1e-5)
	assert.InDelta(t, 0.4, tele.Weather.Gusts, 1e-5)
	assert.InDelta(t, 0.9, tele.Weather.Lightnings, 1e-5)
	assert.InDelta(t, 0.7, tele.Weather.MoonIntensity, 1e-5)
	assert.InDelta(t, 0.25, tele.Weather.MoonPhase, 1e-5)
	assert.InDelta(t, 1, tele.Weather.SunOrMoon, 1e-5)

	require.Len(t, tele.Players, 2)
	assert.Equal(t, "76561198000000000", tele.Players[0].Uid)
	assert.Equal(t, "Nosey", tele.Players[0].Name)
	assert.InDelta(t, 24, tele.Players[0].Ping, 1e-5)
	assert.InDelta(t, 900, tele.Players[0].Bw, 1e-5)
	assert.InDelta(t, 0.4, tele.Players[0].Desync, 1e-5)
	assert.Equal(t, "Boop", tele.Players[1].Name)
}

// Telemetry with no per-player rows must not allocate a phantom entry.
func TestTelemetryToProtoEvent_WithoutPlayers(t *testing.T) {
	tele := telemetryToProtoEvent(core.TelemetryEvent{CaptureFrame: 1}).GetTelemetry()
	require.NotNil(t, tele)
	assert.Empty(t, tele.Players)
	assert.InDelta(t, 0, tele.Weather.Fog, 1e-5)
}

// The manifest write must fail loudly rather than silently dropping a recording
// when its output directory cannot be used.
func TestWriteV2Manifest_UnusableOutputDirectory(t *testing.T) {
	dir := t.TempDir()
	blocker := filepath.Join(dir, "blocker")
	require.NoError(t, os.WriteFile(blocker, []byte("not a directory"), 0644))

	session := NewSession()
	session.SetMission(&core.Mission{MissionName: "M"}, &core.World{WorldName: "altis"})

	err := WriteV2Manifest(session, filepath.Join(blocker, "recording"), 1)
	require.Error(t, err)
}
