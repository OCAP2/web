package ingestion

import (
	"compress/gzip"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/OCAP2/extension/v5/pkg/core"
	"github.com/OCAP2/extension/v5/pkg/streaming"
	pb "github.com/OCAP2/web/pkg/schemas/protobuf/v2"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// A soldier who rejoins arrives as a fresh AddSoldier payload with empty
// call-sign data. The recording must keep calling them a player under their
// original unit name, otherwise the UI loses who this unit is.
func TestHandleAddSoldier_RejoinKeepsPlayerIdentity(t *testing.T) {
	s := NewSession()
	s.HandleAddSoldier(core.Soldier{ID: 1, JoinFrame: 1, IsPlayer: true, UnitName: "Alpha 1-1", Side: "WEST"})

	rejoin := core.Soldier{ID: 1, JoinFrame: 40, Side: "WEST"}
	s.HandleAddSoldier(rejoin)

	rec := s.soldiers[1]
	require.NotNil(t, rec)
	assert.True(t, rec.Soldier.IsPlayer, "a rejoining player must stay a player")
	assert.Equal(t, "Alpha 1-1", rec.Soldier.UnitName, "the original unit name must survive the rejoin")
	assert.Equal(t, core.Frame(40), rec.Soldier.JoinFrame, "the fresh payload still updates unguarded fields")
}

// A vehicle Add can arrive twice (for example on respawn under the same id);
// the later payload wins.
func TestHandleAddVehicle_UpdateReplacesRecord(t *testing.T) {
	s := NewSession()
	s.HandleAddVehicle(core.Vehicle{ID: 5, JoinFrame: 1, DisplayName: "Hunter"})
	s.HandleAddVehicle(core.Vehicle{ID: 5, JoinFrame: 30, DisplayName: "Hunter (wreck)"})

	rec := s.vehicles[5]
	require.NotNil(t, rec)
	assert.Equal(t, "Hunter (wreck)", rec.Vehicle.DisplayName)
	assert.Equal(t, core.Frame(30), rec.Vehicle.JoinFrame)
}

// A vehicle state may arrive before its Add (independent extension workers
// deliver types in no guaranteed order); it must still be recorded, keyed by
// the state's own capture frame.
func TestHandleVehicleState_UnknownVehicleRegisters(t *testing.T) {
	s := NewSession()
	s.HandleVehicleState(core.VehicleState{VehicleID: 9, CaptureFrame: 7, IsAlive: true})

	rec := s.vehicles[9]
	require.NotNil(t, rec)
	assert.Equal(t, uint16(9), rec.Vehicle.ID)
	assert.Equal(t, core.Frame(7), rec.Vehicle.JoinFrame, "the record adopts the state's frame as its join frame")
	require.Len(t, rec.States, 1)
	assert.Equal(t, core.Frame(7), rec.States[0].CaptureFrame)
}

func TestFinalize_WithoutFlusherIsNoOp(t *testing.T) {
	s := NewSession()
	s.HandleAddSoldier(core.Soldier{ID: 1, JoinFrame: 1})
	assert.NoError(t, s.Finalize(t.TempDir()))
}

// A state write that fails mid-stream is remembered and surfaced by Finalize;
// the session must not finalize into a half-written recording silently. The
// recorded error is surfaced as-is, not re-wrapped as a flush failure.
func TestFinalize_ReturnsRecordedChunkError(t *testing.T) {
	dir := t.TempDir()
	s := NewSession()
	cf, err := NewChunkFlusher(dir, 2)
	require.NoError(t, err)
	s.SetChunkFlusher(cf)

	// Two chunks' worth of frames, so chunk 0 is flushed to disk and chunk 1 is
	// the open buffer.
	for _, f := range []core.Frame{0, 1, 2} {
		s.HandleSoldierState(core.SoldierState{SoldierID: 1, CaptureFrame: f})
	}

	// Losing an already-flushed chunk makes the next late amend fail while the
	// finalize-time flush still succeeds.
	require.NoError(t, os.Remove(filepath.Join(dir, "chunks", "0000.pb")))
	s.HandleSoldierState(core.SoldierState{SoldierID: 1, CaptureFrame: 0})
	require.Error(t, s.chunkErr, "the failed amend must have been recorded")

	err = s.Finalize(dir)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "0000.pb")
	assert.NotContains(t, err.Error(), "flush final chunk", "the recorded error is surfaced as-is")
}

// A write failure at finalize time (here: the output directory vanishing) is
// wrapped as a flush failure rather than lost.
func TestFinalize_WrapsFlushError(t *testing.T) {
	dir := t.TempDir()
	s := NewSession()
	cf, err := NewChunkFlusher(dir, 2)
	require.NoError(t, err)
	s.SetChunkFlusher(cf)

	s.HandleAddSoldier(core.Soldier{ID: 1, JoinFrame: 1})
	s.HandleSoldierState(core.SoldierState{SoldierID: 1, CaptureFrame: 1})

	require.NoError(t, os.RemoveAll(filepath.Join(dir, "chunks")))

	err = s.Finalize(dir)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "flush final chunk")
}

// Playback always requests chunk zero, even for a mission with no states, so
// finalizing an empty recording must still write the first chunk.
func TestFinalize_EmptyRecordingWritesChunkZero(t *testing.T) {
	dir := t.TempDir()
	s := NewSession()
	cf, err := NewChunkFlusher(dir, 4)
	require.NoError(t, err)
	s.SetChunkFlusher(cf)

	require.NoError(t, s.Finalize(dir))

	chunk := readChunk(t, dir, 0)
	assert.Equal(t, uint32(0), chunk.Index)
	assert.Empty(t, chunk.Frames)
}

// Chunk boundaries re-seed the last known state of every surviving entity, so
// seeking into a later chunk does not need the chunks before it. Entities whose
// last state predates the boundary are re-added from their newest sample, and
// ones deleted before the boundary are left out entirely.
func TestSeedChunkBoundaries_SeedsVehiclesAndSkipsDeleted(t *testing.T) {
	dir := t.TempDir()
	s := NewSession()
	cf, err := NewChunkFlusher(dir, 2)
	require.NoError(t, err)
	s.SetChunkFlusher(cf)

	s.HandleAddSoldier(core.Soldier{ID: 1, JoinFrame: 0, UnitName: "Survivor"})
	s.HandleAddSoldier(core.Soldier{ID: 2, JoinFrame: 0, UnitName: "Doomed"})
	s.HandleAddVehicle(core.Vehicle{ID: 5, JoinFrame: 0, DisplayName: "Hunter"})

	// The survivor is present across the whole timeline; the doomed soldier and
	// the vehicle stop at frame 1, before the first boundary at frame 2.
	for _, f := range []core.Frame{0, 1, 2, 3, 4} {
		s.HandleSoldierState(core.SoldierState{SoldierID: 1, CaptureFrame: f, Side: "WEST"})
	}
	for _, f := range []core.Frame{0, 1} {
		s.HandleSoldierState(core.SoldierState{SoldierID: 2, CaptureFrame: f, Side: "WEST"})
		s.HandleVehicleState(core.VehicleState{VehicleID: 5, CaptureFrame: f, IsAlive: true})
	}
	// Deleted at frame 2 (one-based wire frame), so the boundary at 2 is past it.
	del, err := json.Marshal(map[string]any{"id": 2, "frame": 2})
	require.NoError(t, err)
	require.NoError(t, s.HandleMessage(streaming.Envelope{Type: streaming.TypeDeleteSoldier, Payload: del}))
	require.Equal(t, core.Frame(1), s.soldiers[2].Soldier.DeleteFrame)

	// Frames 0-3 span chunks 0 and 1; frame 4 opens chunk 2 and flushes chunk 1.
	require.NoError(t, s.seedChunkBoundaries())

	chunk := readChunk(t, dir, 1)
	var frame *pb.Frame
	for _, f := range chunk.Frames {
		if f.FrameNum == 2 {
			frame = f
		}
	}
	require.NotNil(t, frame, "the boundary frame must exist in chunk 1")

	ids := []uint32{}
	for _, st := range frame.Soldiers {
		ids = append(ids, st.Id)
	}
	assert.Equal(t, []uint32{1}, ids, "only the surviving soldier is seeded; the one deleted before the boundary is not")

	vehicleIDs := []uint32{}
	for _, st := range frame.Vehicles {
		vehicleIDs = append(vehicleIDs, st.Id)
	}
	assert.Equal(t, []uint32{5}, vehicleIDs, "the vehicle's newest pre-boundary state is seeded")
}

// A chunk file that cannot be read back (here: replaced by a directory) must
// fail seeding instead of writing a chunk that silently lost its seed.
func TestSeedChunkBoundaries_PropagatesWriteError(t *testing.T) {
	dir := t.TempDir()
	s := NewSession()
	cf, err := NewChunkFlusher(dir, 2)
	require.NoError(t, err)
	s.SetChunkFlusher(cf)

	s.HandleAddSoldier(core.Soldier{ID: 1, JoinFrame: 0})
	for _, f := range []core.Frame{0, 1, 2, 3, 4} {
		s.HandleSoldierState(core.SoldierState{SoldierID: 1, CaptureFrame: f})
	}

	// Corrupt the already-flushed chunk: seeding has to amend it.
	chunkFile := filepath.Join(dir, "chunks", "0001.pb")
	require.NoError(t, os.Remove(chunkFile))
	require.NoError(t, os.Mkdir(chunkFile, 0755))

	assert.Error(t, s.seedChunkBoundaries())
}

func TestSideToIndex(t *testing.T) {
	cases := map[string]int{
		"EAST":        0,
		"OPFOR":       0,
		"WEST":        1,
		"BLUFOR":      1,
		"GUER":        2,
		"INDEPENDENT": 2,
		"CIV":         3,
		"CIVILIAN":    3,
		"west":        1,
		"":            -1,
		"ALIEN":       -1,
	}
	for side, want := range cases {
		assert.Equal(t, want, sideToIndex(side), "side %q", side)
	}
}

// The hit position outranks the trajectory: the round landed where the hit
// says, not where the last telemetry sample was taken.
func TestProjectileEndPos(t *testing.T) {
	hitPos := core.Position3D{X: 30, Y: 40}
	lastTraj := core.Position3D{X: 20, Y: 25}

	withHit := core.ProjectileEvent{
		Hits:       []core.ProjectileHit{{Position: hitPos}},
		Trajectory: []core.TrajectoryPoint{{FrameNum: 1, Position: core.Position3D{X: 1}}, {FrameNum: 2, Position: lastTraj}},
	}
	assert.Equal(t, hitPos, projectileEndPos(withHit))

	trajectoryOnly := core.ProjectileEvent{
		Trajectory: []core.TrajectoryPoint{{FrameNum: 1, Position: lastTraj}},
	}
	assert.Equal(t, lastTraj, projectileEndPos(trajectoryOnly))

	assert.Equal(t, core.Position3D{}, projectileEndPos(core.ProjectileEvent{}))
}

func TestPositionFromExtra(t *testing.T) {
	_, ok := positionFromExtra(map[string]any{}, "pos")
	assert.False(t, ok, "a missing key is not a position")

	_, ok = positionFromExtra(map[string]any{"pos": "not an array"}, "pos")
	assert.False(t, ok, "a non-array value is not a position")

	_, ok = positionFromExtra(map[string]any{"pos": []any{1.0}}, "pos")
	assert.False(t, ok, "a single coordinate is not a position")

	arr, ok := positionFromExtra(map[string]any{"pos": []any{1.0, 2.0, 3.0}}, "pos")
	assert.True(t, ok)
	assert.Equal(t, []any{1.0, 2.0, 3.0}, arr)
}

func TestDecodePayloadRejectsEmptyAndMalformed(t *testing.T) {
	err := decodePayload[core.KillEvent](nil, func(core.KillEvent) {}, false)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "missing payload")

	err = decodePayload[core.KillEvent](json.RawMessage("null"), func(core.KillEvent) {}, false)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "missing payload")

	err = decodePayload[core.KillEvent](json.RawMessage("{not json"), func(core.KillEvent) {}, false)
	require.Error(t, err, "unmarshal failures must surface, not be swallowed")
}

// WriteJSONGzNamed writes the v1 recording into dataDir under the given name.
func TestWriteJSONGzNamed(t *testing.T) {
	s := NewSession()
	s.SetMission(&core.Mission{MissionName: "Gzip", CaptureDelay: 1}, &core.World{WorldName: "altis"})

	dir := t.TempDir()
	require.NoError(t, s.WriteJSONGzNamed(dir, "op"))

	f, err := os.Open(filepath.Join(dir, "op.json.gz"))
	require.NoError(t, err)
	defer f.Close()
	gz, err := gzip.NewReader(f)
	require.NoError(t, err, "the artifact is gzip-compressed, not raw JSON")
	var payload map[string]any
	require.NoError(t, json.NewDecoder(gz).Decode(&payload))
	assert.Equal(t, "Gzip", payload["missionName"])

	// A missing output directory fails at create time with a wrapped error.
	err = s.WriteJSONGzNamed(filepath.Join(dir, "nope"), "op")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "create file")
}

// Placed objects become markers with an icon derived from their magazine, and
// their lifecycle events become marker end frames and hit events attributed to
// the placer.
func TestDerivePlacedObjects(t *testing.T) {
	s := NewSession()
	s.SetMission(&core.Mission{MissionName: "Placed", CaptureDelay: 1}, nil)
	// Vehicle 5 so a hit against it can be attributed to the vehicle.
	s.HandleAddVehicle(core.Vehicle{ID: 5, JoinFrame: 1})

	handle := func(kind string, payload any) {
		raw, err := json.Marshal(payload)
		require.NoError(t, err)
		require.NoError(t, s.HandleMessage(streaming.Envelope{Type: kind, Payload: raw}))
	}

	// Magazine icon fallback, explicit icon, and no icon at all.
	handle(streaming.TypeAddPlaced, map[string]any{"id": 7, "joinFrame": 2, "ownerId": 3, "magazineIcon": "mag_rifle", "displayName": "APERS", "position": map[string]any{"x": 10.0, "y": 20.0}})
	handle(streaming.TypeAddPlaced, map[string]any{"id": 8, "joinFrame": 2, "ownerId": 3, "displayName": "Minefield", "position": map[string]any{"x": 50.0, "y": 60.0}})
	handle(streaming.TypeAddPlaced, map[string]any{"id": 9, "joinFrame": 2, "ownerId": 3, "markerIcon": "trench_x", "displayName": "Trench", "position": map[string]any{"x": 1.0, "y": 2.0}, "direction": 90})

	// deleted wins over a later detonation; the earlier frame is kept. Frames go
	// through the one-based protocol path, so wire frame 9 is stored as 8.
	handle(streaming.TypePlacedEvent, map[string]any{"placedId": 7, "captureFrame": 12, "eventType": "detonated"})
	handle(streaming.TypePlacedEvent, map[string]any{"placedId": 7, "captureFrame": 9, "eventType": "deleted"})
	handle(streaming.TypePlacedEvent, map[string]any{"placedId": 8, "captureFrame": 15, "eventType": "deleted"})

	// Hits: one against an unknown soldier id, one against the known vehicle,
	// one referencing an unregistered placed object, one with no victim.
	handle(streaming.TypePlacedEvent, map[string]any{"placedId": 7, "captureFrame": 11, "eventType": "hit", "position": map[string]any{"x": 13.0, "y": 20.0}, "hitEntityId": 30})
	handle(streaming.TypePlacedEvent, map[string]any{"placedId": 8, "captureFrame": 14, "eventType": "hit", "position": map[string]any{"x": 50.0, "y": 60.0}, "hitEntityId": 5})
	handle(streaming.TypePlacedEvent, map[string]any{"placedId": 99, "captureFrame": 14, "eventType": "hit", "position": map[string]any{"x": 0.0, "y": 0.0}, "hitEntityId": 30})
	handle(streaming.TypePlacedEvent, map[string]any{"placedId": 9, "captureFrame": 14, "eventType": "hit", "position": map[string]any{"x": 1.0, "y": 2.0}})

	v1 := s.ToV1JSON()
	markers, ok := v1["Markers"].([]any)
	require.True(t, ok, "Markers must be a list, got %T", v1["Markers"])

	byName := map[string][]any{}
	for _, m := range markers {
		arr := m.([]any)
		byName[fmt.Sprint(arr[1])] = arr
	}
	// Marker v1 shape: [type, text, captureFrame, endFrame, owner, color, sideIndex, positions, size, shape, brush].
	require.Contains(t, byName, "APERS")
	apers := byName["APERS"]
	assert.Equal(t, "magIcons/mag_rifle", apers[0], "the magazine icon becomes the marker type")
	assert.Equal(t, 8, apers[3], "the earliest lifecycle event is the end frame")
	assert.Equal(t, 3, apers[4], "the placer is the owner")

	require.Contains(t, byName, "Minefield")
	minefield := byName["Minefield"]
	assert.Equal(t, "Minefield", minefield[0], "an object with no icons at all falls back to the minefield type")
	assert.Equal(t, 14, minefield[3])

	require.Contains(t, byName, "Trench")
	assert.Equal(t, "trench_x", byName["Trench"][0], "an explicit marker icon is used verbatim")

	events, ok := v1["events"].([]any)
	require.True(t, ok)
	var hits [][]any
	for _, e := range events {
		arr, ok := e.([]any)
		if ok && len(arr) >= 3 && arr[1] == "hit" {
			hits = append(hits, arr)
		}
	}
	require.Len(t, hits, 2, "the unknown placed object and the victim-less hit produce no event")

	// Placed 7 hit the soldier id 30: v1 shape is [frame, "hit", victim, [source, text], distance].
	assert.Equal(t, core.Frame(10), hits[0][0])
	assert.Equal(t, uint(30), hits[0][2], "a hit against an unknown id keeps the raw game id")
	assert.Equal(t, uint(3), hits[0][3].([]any)[0], "the placer is the attribution source")
	// sqrt((13-10)^2) with equal y.
	assert.InDelta(t, 3.0, hits[0][4].(float32), 0.001)

	// Placed 8 hit the registered vehicle 5: the vehicle wins the victim slot.
	assert.Equal(t, core.Frame(13), hits[1][0])
	assert.Equal(t, uint(5), hits[1][2], "a hit against a vehicle is attributed to the vehicle id")
}

// The v1 hit event prefers vehicle ids when the event carries them.
func TestEventsToV1_VehicleVictimAndShooter(t *testing.T) {
	s := NewSession()
	s.HandleHitEvent(core.HitEvent{
		CaptureFrame:     4,
		VictimVehicleID:  ptrUint(9),
		ShooterVehicleID: ptrUint(3),
	})
	s.HandleKillEvent(core.KillEvent{
		CaptureFrame:    5,
		VictimVehicleID: ptrUint(9),
		KillerVehicleID: ptrUint(3),
	})

	events := s.eventsToV1()
	require.Len(t, events, 2)

	hit := events[0].([]any)
	assert.Equal(t, "hit", hit[1])
	assert.Equal(t, uint(9), hit[2], "the vehicle id wins the victim slot")
	assert.Equal(t, uint(3), hit[3].([]any)[0], "the vehicle id wins the shooter slot")

	killed := events[1].([]any)
	assert.Equal(t, "killed", killed[1])
	assert.Equal(t, uint(9), killed[2])
	assert.Equal(t, uint(3), killed[3].([]any)[0])
}

// A polyline marker exports its geometry as the position array; a marker with
// states appends one position entry per state.
func TestMarkersToV1_PolylineAndStates(t *testing.T) {
	s := NewSession()
	s.HandleAddMarker(core.Marker{
		ID:           1,
		MarkerName:   "route",
		Text:         "route",
		CaptureFrame: 2,
		Shape:        "POLYLINE",
		Side:         "west",
		Polyline:     core.Polyline{{X: 1, Y: 2}, {X: 3, Y: 4}},
	})
	s.HandleMarkerState(core.MarkerState{MarkerID: 1, CaptureFrame: 6, Position: core.Position3D{X: 5, Y: 6}, Direction: 45, Alpha: 0.5})
	s.HandleAddMarker(core.Marker{
		ID:           2,
		MarkerName:   "moving",
		Text:         "moving",
		CaptureFrame: 3,
		Shape:        "ICON",
		Position:     core.Position3D{X: 1, Y: 1},
		Side:         "EAST",
	})
	s.HandleMarkerState(core.MarkerState{MarkerID: 2, CaptureFrame: 9, Position: core.Position3D{X: 8, Y: 9}, Direction: 90, Alpha: 0.25})

	markers := s.markersToV1()
	require.Len(t, markers, 2)
	byName := map[string][]any{}
	for _, mk := range markers {
		arr := mk.([]any)
		byName[fmt.Sprint(arr[1])] = arr
	}

	route := byName["route"]
	positions := route[7].([][]any)
	require.Len(t, positions, 1, "a polyline carries only its geometry; states are dropped")
	assert.Equal(t, []any{core.Frame(2), [][]float64{{1, 2}, {3, 4}}, float32(0), float32(0)}, positions[0])
	assert.Equal(t, 1, route[6], "sides are normalised case-insensitively to their index")

	moving := byName["moving"]
	movingPositions := moving[7].([][]any)
	require.Len(t, movingPositions, 2, "the initial position plus one entry per state")
	assert.Equal(t, []any{core.Frame(3), []float64{1, 1, 0}, float32(0), float32(0)}, movingPositions[0])
	assert.Equal(t, []any{core.Frame(9), []float64{8, 9, 0}, float32(90), float32(0.25)}, movingPositions[1])
}

// The flusher keeps its temporary file name from colliding with a chunk that
// is actually a directory; the rename then fails and the error surfaces.
func TestWriteChunk_TargetPathIsDirectory(t *testing.T) {
	dir := t.TempDir()
	cf, err := NewChunkFlusher(dir, 2)
	require.NoError(t, err)

	// A pre-existing chunk directory blocks the rename into place.
	require.NoError(t, os.Mkdir(filepath.Join(dir, "chunks", "0000.pb"), 0755))

	err = cf.FlushThrough(1)
	require.Error(t, err)
	assert.True(t, strings.Contains(err.Error(), "rename") || os.IsExist(err), "got: %v", err)
}
