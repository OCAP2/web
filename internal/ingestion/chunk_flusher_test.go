package ingestion

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/proto"

	pbv2 "github.com/OCAP2/web/pkg/schemas/protobuf/v2"
)

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
