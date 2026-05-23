package ingestion

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/OCAP2/extension/v5/pkg/core"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/proto"

	pbv2 "github.com/OCAP2/web/pkg/schemas/protobuf/v2"
)

func TestWriteV2Manifest_Roundtrip(t *testing.T) {
	session := NewSession()

	session.SetMission(
		&core.Mission{
			MissionName:      "Test Mission",
			BriefingName:     "Briefing",
			Author:           "TestAuthor",
			ServerName:       "TestServer",
			ExtensionVersion: "5.0.0",
			AddonVersion:     "1.2.3",
			ExtensionBuild:   "abc123",
			Tag:              "test",
			CaptureDelay:     1.0,
			PlayableSlots:    core.PlayableSlots{West: 10, East: 8, Independent: 4, Civilian: 2},
			SideFriendly:     core.SideFriendly{EastWest: false, EastIndependent: true, WestIndependent: false},
			Addons:           []core.Addon{{Name: "CBA_A3", WorkshopID: "450814997"}},
		},
		&core.World{
			WorldName:   "Altis",
			WorldSize:   30720,
			Latitude:    -35.09,
			Longitude:   16.81,
			Author:      "BIS",
			DisplayName: "Altis",
		},
	)

	// Add a soldier.
	session.HandleAddSoldier(core.Soldier{
		ID:              1,
		UnitName:        "TestUnit",
		Side:            "WEST",
		GroupID:         "Alpha",
		RoleDescription: "Rifleman",
		JoinFrame:       0,
		IsPlayer:        true,
		ClassName:       "B_Soldier_F",
		PlayerUID:       "76561198000000000",
	})

	// Add soldier states.
	session.HandleSoldierState(core.SoldierState{
		SoldierID:    1,
		CaptureFrame: 0,
		Position:     core.Position3D{X: 100, Y: 200, Z: 10},
		Bearing:      90,
		Lifestate:    1,
		IsPlayer:     true,
		UnitName:     "TestUnit",
		GroupID:      "Alpha",
		Side:         "WEST",
		CurrentRole:  "Rifleman",
		Stance:       "STAND",
	})

	// Add a vehicle.
	session.HandleAddVehicle(core.Vehicle{
		ID:          10,
		DisplayName: "Hunter",
		OcapType:    "car",
		ClassName:   "B_MRAP_01_F",
		JoinFrame:   0,
	})

	// Add vehicle state.
	session.HandleVehicleState(core.VehicleState{
		VehicleID:    10,
		CaptureFrame: 0,
		Position:     core.Position3D{X: 150, Y: 250, Z: 5},
		Bearing:      180,
		IsAlive:      true,
		Fuel:         0.75,
		Damage:       0.1,
		Side:         "WEST",
	})

	// Add events.
	victimID := uint(1)
	killerID := uint(2)
	session.HandleKillEvent(core.KillEvent{
		CaptureFrame:    50,
		VictimSoldierID: &victimID,
		KillerSoldierID: &killerID,
		WeaponName:      "arifle_MX_F",
		WeaponMagazine:  "30Rnd_65x39_caseless_mag",
		EventText:       "Player1 killed Player2",
		Distance:        150.5,
	})

	session.HandleChatEvent(core.ChatEvent{
		CaptureFrame: 10,
		Channel:      "side",
		FromName:     "TestUnit",
		Message:      "Hello world",
		PlayerUID:    "76561198000000000",
	})

	session.HandleTimeState(core.TimeState{
		CaptureFrame:  0,
		SystemTimeUTC: "2025-01-15T10:30:00Z",
		MissionDate:   "2035/6/15",
		TimeMultiplier: 1.0,
		MissionTime:    28800,
	})

	// Add a fired event.
	session.HandleFiredEvent(core.FiredEvent{
		SoldierID:    1,
		CaptureFrame: 45,
		Weapon:       "arifle_MX_F",
		Magazine:     "30Rnd_65x39_caseless_mag",
		FiringMode:   "Single",
		StartPos:     core.Position3D{X: 100, Y: 200, Z: 11},
		EndPos:       core.Position3D{X: 200, Y: 300, Z: 10},
	})

	// Write.
	dir := t.TempDir()
	require.NoError(t, WriteV2Manifest(session, dir, 1))

	// Read back protobuf manifest.
	data, err := os.ReadFile(filepath.Join(dir, "manifest.pb"))
	require.NoError(t, err)

	var manifest pbv2.Manifest
	require.NoError(t, proto.Unmarshal(data, &manifest))

	// Verify top-level fields.
	assert.Equal(t, uint32(2), manifest.Version)
	assert.Equal(t, uint32(1), manifest.ChunkCount)

	// Verify world.
	require.NotNil(t, manifest.World)
	assert.Equal(t, "Altis", manifest.World.WorldName)
	assert.InDelta(t, float32(30720), manifest.World.WorldSize, 0.01)
	assert.InDelta(t, float32(-35.09), manifest.World.Latitude, 0.01)

	// Verify mission.
	require.NotNil(t, manifest.Mission)
	assert.Equal(t, "Test Mission", manifest.Mission.MissionName)
	assert.Equal(t, "TestServer", manifest.Mission.ServerName)
	assert.Equal(t, "5.0.0", manifest.Mission.ExtensionVersion)
	require.NotNil(t, manifest.Mission.PlayableSlots)
	assert.Equal(t, uint32(10), manifest.Mission.PlayableSlots.West)
	require.Len(t, manifest.Mission.Addons, 1)
	assert.Equal(t, "CBA_A3", manifest.Mission.Addons[0].Name)

	// Verify soldiers.
	require.Len(t, manifest.Soldiers, 1)
	sol := manifest.Soldiers[0]
	assert.Equal(t, uint32(1), sol.Id)
	assert.Equal(t, "TestUnit", sol.Name)
	assert.Equal(t, pbv2.Side_SIDE_WEST, sol.Side)
	assert.True(t, sol.IsPlayer)
	assert.Equal(t, "B_Soldier_F", sol.ClassName)
	require.Len(t, sol.FramesFired, 1)
	assert.Equal(t, "arifle_MX_F", sol.FramesFired[0].Weapon)

	// Verify vehicles.
	require.Len(t, manifest.Vehicles, 1)
	veh := manifest.Vehicles[0]
	assert.Equal(t, uint32(10), veh.Id)
	assert.Equal(t, "Hunter", veh.Name)
	assert.Equal(t, "car", veh.VehicleClass)

	// Verify events.
	require.GreaterOrEqual(t, len(manifest.Events), 2)
	var foundKill, foundChat bool
	for _, evt := range manifest.Events {
		if kill := evt.GetKill(); kill != nil {
			foundKill = true
			assert.Equal(t, uint32(1), kill.VictimSoldierId)
			assert.Equal(t, uint32(2), kill.KillerSoldierId)
			assert.Equal(t, "arifle_MX_F", kill.WeaponName)
			assert.InDelta(t, float32(150.5), kill.Distance, 0.1)
		}
		if chat := evt.GetChat(); chat != nil {
			foundChat = true
			assert.Equal(t, "side", chat.Channel)
			assert.Equal(t, "Hello world", chat.Message)
		}
	}
	assert.True(t, foundKill, "expected kill event in manifest")
	assert.True(t, foundChat, "expected chat event in manifest")

	// Verify times.
	require.Len(t, manifest.Times, 1)
	assert.Equal(t, "2025-01-15T10:30:00Z", manifest.Times[0].SystemTimeUtc)

	// Verify JSON archive also exists.
	jsonData, err := os.ReadFile(filepath.Join(dir, "manifest.json"))
	require.NoError(t, err)
	assert.Contains(t, string(jsonData), "Test Mission")
}

func TestSoldierStateToProto(t *testing.T) {
	vehicleID := uint16(10)
	st := core.SoldierState{
		SoldierID:         1,
		CaptureFrame:      5,
		Position:          core.Position3D{X: 100, Y: 200, Z: 10},
		Bearing:           90,
		Lifestate:         1,
		InVehicle:         true,
		InVehicleObjectID: &vehicleID,
		VehicleRole:       "driver",
		UnitName:          "TestUnit",
		IsPlayer:          true,
		GroupID:           "Alpha",
		Side:              "WEST",
		CurrentRole:       "Rifleman",
		Stance:            "CROUCH",
		HasStableVitals:   true,
		IsDraggedCarried:  false,
		Scores: core.SoldierScores{
			InfantryKills: 2,
			VehicleKills:  1,
			Deaths:        0,
			TotalScore:    5,
		},
	}

	pb := SoldierStateToProto(st)
	assert.Equal(t, uint32(1), pb.Id)
	assert.InDelta(t, float32(100), pb.Position.X, 0.01)
	assert.Equal(t, uint32(90), pb.Bearing)
	assert.Equal(t, uint32(1), pb.Lifestate)
	assert.True(t, pb.InVehicle)
	assert.Equal(t, uint32(10), pb.VehicleId)
	assert.Equal(t, "driver", pb.VehicleRole)
	assert.Equal(t, "CROUCH", pb.Stance)
	assert.True(t, pb.HasStableVitals)
	require.NotNil(t, pb.Scores)
	assert.Equal(t, uint32(2), pb.Scores.InfantryKills)
	assert.Equal(t, uint32(5), pb.Scores.TotalScore)
}

func TestVehicleStateToProto(t *testing.T) {
	st := core.VehicleState{
		VehicleID:       10,
		CaptureFrame:    5,
		Position:        core.Position3D{X: 150, Y: 250, Z: 5},
		Bearing:         180,
		IsAlive:         true,
		Crew:            "[1,2,3]",
		Fuel:            0.6,
		Damage:          0.2,
		Locked:          true,
		EngineOn:        true,
		Side:            "EAST",
		TurretAzimuth:   45.0,
		TurretElevation: -5.0,
	}

	pb := VehicleStateToProto(st)
	assert.Equal(t, uint32(10), pb.Id)
	assert.InDelta(t, float32(150), pb.Position.X, 0.01)
	assert.Equal(t, uint32(180), pb.Bearing)
	assert.True(t, pb.Alive)
	assert.Equal(t, []uint32{1, 2, 3}, pb.CrewIds)
	assert.InDelta(t, float32(0.6), pb.Fuel, 0.01)
	assert.InDelta(t, float32(0.2), pb.Damage, 0.01)
	assert.True(t, pb.Locked)
	assert.True(t, pb.EngineOn)
	assert.Equal(t, "EAST", pb.Side)
	assert.InDelta(t, float32(45.0), pb.TurretAzimuth, 0.1)
}
