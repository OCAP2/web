package storage

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	pbv1 "github.com/OCAP2/web/pkg/schemas/protobuf/v1"
)

func TestChunkBucket_WriteAndRead(t *testing.T) {
	bucket, err := NewChunkBucket(t.TempDir())
	require.NoError(t, err)
	defer bucket.Cleanup()

	// Write states to chunk 0
	states := []*pbv1.EntityState{
		{EntityId: 1, FrameNum: 0, PosX: 100, PosY: 200, Alive: 1},
		{EntityId: 2, FrameNum: 0, PosX: 300, PosY: 400, Alive: 1},
		{EntityId: 1, FrameNum: 1, PosX: 101, PosY: 201, Alive: 1},
	}
	for _, s := range states {
		require.NoError(t, bucket.Write(0, s))
	}

	// Write states to chunk 1
	require.NoError(t, bucket.Write(1, &pbv1.EntityState{
		EntityId: 1, FrameNum: 300, PosX: 500, PosY: 600, Alive: 1,
	}))

	// Flush before reading
	require.NoError(t, bucket.Flush())

	// Read chunk 0
	got, err := bucket.Read(0)
	require.NoError(t, err)
	require.Len(t, got, 3)
	assert.Equal(t, uint32(1), got[0].EntityId)
	assert.Equal(t, uint32(0), got[0].FrameNum)
	assert.Equal(t, float32(100), got[0].PosX)
	assert.Equal(t, uint32(2), got[1].EntityId)
	assert.Equal(t, uint32(1), got[2].FrameNum)

	// Read chunk 1
	got, err = bucket.Read(1)
	require.NoError(t, err)
	require.Len(t, got, 1)
	assert.Equal(t, uint32(300), got[0].FrameNum)

	// Read nonexistent chunk returns empty
	got, err = bucket.Read(99)
	require.NoError(t, err)
	assert.Empty(t, got)
}

func TestChunkBucket_Cleanup(t *testing.T) {
	dir := t.TempDir()
	bucket, err := NewChunkBucket(dir)
	require.NoError(t, err)

	require.NoError(t, bucket.Write(0, &pbv1.EntityState{EntityId: 1}))
	require.NoError(t, bucket.Flush())
	require.NoError(t, bucket.Cleanup())

	// After cleanup, reading should return empty (files deleted)
	got, err := bucket.Read(0)
	require.NoError(t, err)
	assert.Empty(t, got)
}

func TestChunkBucket_LargeRecord(t *testing.T) {
	bucket, err := NewChunkBucket(t.TempDir())
	require.NoError(t, err)
	defer bucket.Cleanup()

	// Write a state with many crew IDs
	crewIDs := make([]uint32, 100)
	for i := range crewIDs {
		crewIDs[i] = uint32(i)
	}
	state := &pbv1.EntityState{
		EntityId: 1, FrameNum: 5, PosX: 1.5, PosY: 2.5,
		CrewIds: crewIDs, Name: "TestVehicle", GroupName: "Alpha",
	}
	require.NoError(t, bucket.Write(0, state))
	require.NoError(t, bucket.Flush())

	got, err := bucket.Read(0)
	require.NoError(t, err)
	require.Len(t, got, 1)
	assert.Equal(t, 100, len(got[0].CrewIds))
	assert.Equal(t, "TestVehicle", got[0].Name)
}
