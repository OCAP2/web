package ingestion

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/proto"

	pbv2 "github.com/OCAP2/web/pkg/schemas/protobuf/v2"
)

func TestWriteAtomic_FileMode(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX permission bits are not supported on Windows")
	}
	path := filepath.Join(t.TempDir(), "0000.pb")
	require.NoError(t, writeAtomic(path, []byte("data")))

	info, err := os.Stat(path)
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0644), info.Mode().Perm())
}

func TestChunkFlusher_FlushesAtBoundary(t *testing.T) {
	dir := t.TempDir()
	cf, err := NewChunkFlusher(dir, 3) // chunk size = 3 frames
	require.NoError(t, err)

	// Add states for frames 0, 1, 2 (fills chunk 0).
	for frame := uint32(0); frame < 3; frame++ {
		err := cf.AddSoldierState(frame, &pbv2.SoldierState{
			Id:       1,
			Bearing:  frame * 10,
			Position: &pbv2.Position3D{X: float32(frame), Y: 0, Z: 0},
		})
		require.NoError(t, err)
	}

	// Frame 3 crosses boundary → chunk 0 should be flushed.
	err = cf.AddSoldierState(3, &pbv2.SoldierState{Id: 1, Bearing: 30})
	require.NoError(t, err)
	assert.Equal(t, uint32(1), cf.ChunkCount())

	// Verify chunk 0 file exists and is valid.
	chunkPath := filepath.Join(dir, "chunks", "0000.pb")
	data, err := os.ReadFile(chunkPath)
	require.NoError(t, err)

	var chunk pbv2.Chunk
	require.NoError(t, proto.Unmarshal(data, &chunk))
	assert.Equal(t, uint32(0), chunk.Index)
	assert.Equal(t, uint32(0), chunk.StartFrame)
	assert.Equal(t, uint32(3), chunk.FrameCount)
	assert.Len(t, chunk.Frames, 3)

	// Flush remaining (frame 3).
	require.NoError(t, cf.Flush())
	assert.Equal(t, uint32(2), cf.ChunkCount())

	chunkPath1 := filepath.Join(dir, "chunks", "0001.pb")
	data1, err := os.ReadFile(chunkPath1)
	require.NoError(t, err)

	var chunk1 pbv2.Chunk
	require.NoError(t, proto.Unmarshal(data1, &chunk1))
	assert.Equal(t, uint32(1), chunk1.Index)
	assert.Len(t, chunk1.Frames, 1)
}

func TestChunkFlusher_VehicleStates(t *testing.T) {
	dir := t.TempDir()
	cf, err := NewChunkFlusher(dir, 5)
	require.NoError(t, err)

	for frame := uint32(0); frame < 4; frame++ {
		err := cf.AddVehicleState(frame, &pbv2.VehicleState{
			Id:   10,
			Fuel: 0.8,
		})
		require.NoError(t, err)
	}
	assert.Equal(t, uint32(0), cf.ChunkCount()) // Not yet flushed.

	require.NoError(t, cf.Flush())
	assert.Equal(t, uint32(1), cf.ChunkCount())
}

func TestChunkFlusher_EmptyFlush(t *testing.T) {
	dir := t.TempDir()
	cf, err := NewChunkFlusher(dir, 10)
	require.NoError(t, err)

	// Flushing with no data should succeed silently.
	require.NoError(t, cf.Flush())
	assert.Equal(t, uint32(0), cf.ChunkCount())
}

func TestChunkFlusher_MixedSoldierVehicle(t *testing.T) {
	dir := t.TempDir()
	cf, err := NewChunkFlusher(dir, 2)
	require.NoError(t, err)

	// Frame 0: soldier + vehicle.
	require.NoError(t, cf.AddSoldierState(0, &pbv2.SoldierState{Id: 1}))
	require.NoError(t, cf.AddVehicleState(0, &pbv2.VehicleState{Id: 10}))

	// Frame 1: only soldier.
	require.NoError(t, cf.AddSoldierState(1, &pbv2.SoldierState{Id: 1}))

	// Frame 2 crosses boundary.
	require.NoError(t, cf.AddSoldierState(2, &pbv2.SoldierState{Id: 1}))
	assert.Equal(t, uint32(1), cf.ChunkCount())

	// Verify chunk 0 has both soldiers and vehicles.
	data, err := os.ReadFile(filepath.Join(dir, "chunks", "0000.pb"))
	require.NoError(t, err)

	var chunk pbv2.Chunk
	require.NoError(t, proto.Unmarshal(data, &chunk))
	assert.Len(t, chunk.Frames, 2) // frames 0 and 1

	// Frame 0 has both soldier and vehicle.
	assert.Len(t, chunk.Frames[0].Soldiers, 1)
	assert.Len(t, chunk.Frames[0].Vehicles, 1)

	// Frame 1 has only soldier.
	assert.Len(t, chunk.Frames[1].Soldiers, 1)
	assert.Len(t, chunk.Frames[1].Vehicles, 0)
}

// readChunk loads a flushed chunk straight off disk.
func readChunk(t *testing.T, dir string, idx uint32) *pbv2.Chunk {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(dir, "chunks", fmt.Sprintf("%04d.pb", idx)))
	require.NoError(t, err)
	var chunk pbv2.Chunk
	require.NoError(t, proto.Unmarshal(data, &chunk))
	return &chunk
}

func frameAt(t *testing.T, chunk *pbv2.Chunk, frame uint32) *pbv2.Frame {
	t.Helper()
	for _, f := range chunk.Frames {
		if f.FrameNum == frame {
			return f
		}
	}
	t.Fatalf("frame %d not in chunk %d", frame, chunk.Index)
	return nil
}

func soldierBearing(f *pbv2.Frame, id uint32) (uint32, bool) {
	for _, s := range f.Soldiers {
		if s.Id == id {
			return s.Bearing, true
		}
	}
	return 0, false
}

func vehicleFuel(f *pbv2.Frame, id uint32) (float32, bool) {
	for _, v := range f.Vehicles {
		if v.Id == id {
			return v.Fuel, true
		}
	}
	return 0, false
}

func TestNewChunkFlusher_RejectsZeroChunkSize(t *testing.T) {
	cf, err := NewChunkFlusher(t.TempDir(), 0)
	require.Error(t, err)
	assert.Nil(t, cf)
	assert.Contains(t, err.Error(), "chunk size must be positive")
}

// A boundary with no samples still needs the latest known states so playback can
// seek there and render a complete frame.
func TestChunkFlusher_SeedFrameSeedsEmptyBoundary(t *testing.T) {
	dir := t.TempDir()
	cf, err := NewChunkFlusher(dir, 2)
	require.NoError(t, err)

	require.NoError(t, cf.SeedFrame(2,
		[]*pbv2.SoldierState{{Id: 1, Bearing: 90}, {Id: 2, Bearing: 180}},
		[]*pbv2.VehicleState{{Id: 10, Fuel: 0.75}},
	))
	require.NoError(t, cf.Flush())

	frame := frameAt(t, readChunk(t, dir, 1), 2)
	require.Len(t, frame.Soldiers, 2)
	require.Len(t, frame.Vehicles, 1)

	bearing, ok := soldierBearing(frame, 2)
	assert.True(t, ok)
	assert.Equal(t, uint32(180), bearing)
	fuel, ok := vehicleFuel(frame, 10)
	assert.True(t, ok)
	assert.InDelta(t, 0.75, fuel, 1e-5)
}

// A real sample at the boundary is authoritative; the seed may only fill in
// entities the frame does not already carry.
func TestChunkFlusher_SeedFrameDoesNotOverrideRealSamples(t *testing.T) {
	dir := t.TempDir()
	cf, err := NewChunkFlusher(dir, 4)
	require.NoError(t, err)

	require.NoError(t, cf.AddSoldierState(0, &pbv2.SoldierState{Id: 1, Bearing: 99}))
	require.NoError(t, cf.AddVehicleState(0, &pbv2.VehicleState{Id: 10, Fuel: 0.25}))

	require.NoError(t, cf.SeedFrame(0,
		[]*pbv2.SoldierState{{Id: 1, Bearing: 7}, {Id: 2, Bearing: 5}},
		[]*pbv2.VehicleState{{Id: 10, Fuel: 0.9}, {Id: 11, Fuel: 0.4}},
	))
	require.NoError(t, cf.Flush())

	frame := frameAt(t, readChunk(t, dir, 0), 0)

	require.Len(t, frame.Soldiers, 2, "the seeded duplicate must not be appended twice")
	bearing, ok := soldierBearing(frame, 1)
	assert.True(t, ok)
	assert.Equal(t, uint32(99), bearing, "real sample wins over the seed")
	bearing, ok = soldierBearing(frame, 2)
	assert.True(t, ok)
	assert.Equal(t, uint32(5), bearing, "unseen soldier is seeded")

	require.Len(t, frame.Vehicles, 2)
	fuel, ok := vehicleFuel(frame, 10)
	assert.True(t, ok)
	assert.InDelta(t, 0.25, fuel, 1e-5, "real sample wins over the seed")
	fuel, ok = vehicleFuel(frame, 11)
	assert.True(t, ok)
	assert.InDelta(t, 0.4, fuel, 1e-5, "unseen vehicle is seeded")
}

// Late messages amend chunks already on disk, because independent extension
// workers do not deliver entity types in frame order.
func TestChunkFlusher_SeedFrameLateAmendReachesFlushedChunk(t *testing.T) {
	dir := t.TempDir()
	cf, err := NewChunkFlusher(dir, 2)
	require.NoError(t, err)

	require.NoError(t, cf.AddSoldierState(0, &pbv2.SoldierState{Id: 1, Bearing: 10}))
	require.NoError(t, cf.AddSoldierState(1, &pbv2.SoldierState{Id: 1, Bearing: 20}))
	// Crossing into chunk 1 flushes chunk 0.
	require.NoError(t, cf.AddSoldierState(2, &pbv2.SoldierState{Id: 1, Bearing: 30}))
	require.Equal(t, uint32(1), cf.ChunkCount())
	require.Len(t, frameAt(t, readChunk(t, dir, 0), 0).Soldiers, 1)

	require.NoError(t, cf.SeedFrame(0, []*pbv2.SoldierState{{Id: 2, Bearing: 40}}, nil))

	frame := frameAt(t, readChunk(t, dir, 0), 0)
	require.Len(t, frame.Soldiers, 2, "the late seed is written back into the flushed chunk")
	bearing, ok := soldierBearing(frame, 1)
	assert.True(t, ok)
	assert.Equal(t, uint32(10), bearing, "the original sample survives the rewrite")
	bearing, ok = soldierBearing(frame, 2)
	assert.True(t, ok)
	assert.Equal(t, uint32(40), bearing)
}

// Two states for the same entity in one frame replace rather than accumulate, so
// replay cannot show the same unit twice in a frame.
func TestChunkFlusher_SoldierStateReplacesSameIDInFrame(t *testing.T) {
	dir := t.TempDir()
	cf, err := NewChunkFlusher(dir, 4)
	require.NoError(t, err)

	require.NoError(t, cf.AddSoldierState(0, &pbv2.SoldierState{Id: 1, Bearing: 10}))
	require.NoError(t, cf.AddSoldierState(0, &pbv2.SoldierState{Id: 1, Bearing: 20}))
	require.NoError(t, cf.Flush())

	frame := frameAt(t, readChunk(t, dir, 0), 0)
	require.Len(t, frame.Soldiers, 1)
	assert.Equal(t, uint32(20), frame.Soldiers[0].Bearing, "last write wins")
}

func TestChunkFlusher_VehicleStateReplacesSameIDInFrame(t *testing.T) {
	dir := t.TempDir()
	cf, err := NewChunkFlusher(dir, 4)
	require.NoError(t, err)

	require.NoError(t, cf.AddVehicleState(0, &pbv2.VehicleState{Id: 10, Fuel: 0.8}))
	require.NoError(t, cf.AddVehicleState(0, &pbv2.VehicleState{Id: 10, Fuel: 0.2}))
	require.NoError(t, cf.Flush())

	frame := frameAt(t, readChunk(t, dir, 0), 0)
	require.Len(t, frame.Vehicles, 1)
	assert.InDelta(t, 0.2, frame.Vehicles[0].Fuel, 1e-5, "last write wins")
}

func TestChunkFlusher_LateStateReachesFlushedChunk(t *testing.T) {
	dir := t.TempDir()
	cf, err := NewChunkFlusher(dir, 2)
	require.NoError(t, err)

	require.NoError(t, cf.AddVehicleState(0, &pbv2.VehicleState{Id: 10, Fuel: 0.5}))
	require.NoError(t, cf.AddVehicleState(1, &pbv2.VehicleState{Id: 10, Fuel: 0.5}))
	require.NoError(t, cf.AddVehicleState(2, &pbv2.VehicleState{Id: 10, Fuel: 0.5}))
	require.Equal(t, uint32(1), cf.ChunkCount())

	require.NoError(t, cf.AddVehicleState(0, &pbv2.VehicleState{Id: 11, Fuel: 0.1}))

	frame := frameAt(t, readChunk(t, dir, 0), 0)
	require.Len(t, frame.Vehicles, 2, "late vehicle joins the already-flushed frame")
}
