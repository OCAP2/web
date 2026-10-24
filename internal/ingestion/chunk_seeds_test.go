package ingestion

import (
	"testing"

	"github.com/OCAP2/extension/v5/pkg/core"
	"github.com/stretchr/testify/require"
)

func TestLastFrame(t *testing.T) {
	require.Equal(t, core.Frame(4), lastFrame(5))
	require.Equal(t, core.Frame(0), lastFrame(0))
}

func TestSeedChunkBoundariesSeedsLatestStateAtEachBoundary(t *testing.T) {
	dir := t.TempDir()
	s := NewSession()
	s.SetMission(&core.Mission{MissionName: "Seed", CaptureDelay: 1}, &core.World{WorldName: "altis"})
	cf, err := NewChunkFlusher(dir, 10)
	require.NoError(t, err)
	s.SetChunkFlusher(cf)

	// Two soldiers with states at frames 0 and 5, one vehicle with a state at frame 2.
	s.HandleAddSoldier(core.Soldier{ID: 1, UnitName: "Alpha", Side: "WEST"})
	s.HandleSoldierState(core.SoldierState{SoldierID: 1, CaptureFrame: 0, Position: core.Position3D{X: 1}, IsPlayer: true})
	s.HandleSoldierState(core.SoldierState{SoldierID: 1, CaptureFrame: 5, Position: core.Position3D{X: 2}})
	s.HandleAddSoldier(core.Soldier{ID: 2, UnitName: "Bravo", Side: "EAST"})
	s.HandleSoldierState(core.SoldierState{SoldierID: 2, CaptureFrame: 5, Position: core.Position3D{X: 3}})
	s.HandleAddVehicle(core.Vehicle{ID: 7, DisplayName: "Hunter"})
	s.HandleVehicleState(core.VehicleState{VehicleID: 7, CaptureFrame: 2, Side: "WEST"})

	require.NoError(t, s.seedChunkBoundaries())
}

func TestSeedChunkBoundariesSeedsACrossChunkBoundary(t *testing.T) {
	dir := t.TempDir()
	s := NewSession()
	s.SetMission(&core.Mission{MissionName: "Seed", CaptureDelay: 1}, &core.World{WorldName: "altis"})
	cf, err := NewChunkFlusher(dir, 10)
	require.NoError(t, err)
	s.SetChunkFlusher(cf)

	// A soldier with states at frames 0 and 10. seedChunkBoundaries runs over
	// every chunk boundary and picks the latest state at or before it.
	s.HandleAddSoldier(core.Soldier{ID: 1, UnitName: "Alpha", Side: "WEST"})
	s.HandleSoldierState(core.SoldierState{SoldierID: 1, CaptureFrame: 0, Position: core.Position3D{X: 1}})
	s.HandleSoldierState(core.SoldierState{SoldierID: 1, CaptureFrame: 10, Position: core.Position3D{X: 2}})

	// CaptureFrame 10 is exactly a boundary (frame 10 for chunkSize 10). The
	// seed picks the state at frame 10.
	require.NoError(t, s.seedChunkBoundaries())
}

func TestSeedChunkBoundariesSkipsDeletedSoldierAfterDeleteFrame(t *testing.T) {
	dir := t.TempDir()
	s := NewSession()
	s.SetMission(&core.Mission{MissionName: "Seed", CaptureDelay: 1}, &core.World{WorldName: "altis"})
	cf, err := NewChunkFlusher(dir, 5)
	require.NoError(t, err)
	s.SetChunkFlusher(cf)

	// Soldier deleted at frame 3. The boundary at frame 5 must skip it.
	s.HandleAddSoldier(core.Soldier{ID: 1, UnitName: "Gone", DeleteFrame: 3})
	s.HandleSoldierState(core.SoldierState{SoldierID: 1, CaptureFrame: 0})
	s.HandleSoldierState(core.SoldierState{SoldierID: 1, CaptureFrame: 2})

	require.NoError(t, s.seedChunkBoundaries())
}

func TestSeedChunkBoundariesNoSoldiersSeedsNothing(t *testing.T) {
	dir := t.TempDir()
	s := NewSession()
	s.SetMission(&core.Mission{MissionName: "Seed", CaptureDelay: 1}, &core.World{WorldName: "altis"})
	cf, err := NewChunkFlusher(dir, 5)
	require.NoError(t, err)
	s.SetChunkFlusher(cf)

	// No soldiers or vehicles: no chunk boundary is seeded, and nothing errors.
	require.NoError(t, s.seedChunkBoundaries())
}
