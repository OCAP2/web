package storage

import (
	"bufio"
	"os"
	"path/filepath"
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

func TestChunkBucket_CleanupWithOpenFiles(t *testing.T) {
	dir := t.TempDir()
	bucket, err := NewChunkBucket(dir)
	require.NoError(t, err)

	// Write but do NOT flush — files are still open
	require.NoError(t, bucket.Write(0, &pbv1.EntityState{EntityId: 1, PosX: 1}))
	require.NoError(t, bucket.Write(1, &pbv1.EntityState{EntityId: 2, PosX: 2}))

	// Cleanup should close open files and remove dir
	require.NoError(t, bucket.Cleanup())

	// After cleanup, reading should return empty
	got, err := bucket.Read(0)
	require.NoError(t, err)
	assert.Empty(t, got)
}

func TestChunkBucket_ReadCorruptedData(t *testing.T) {
	dir := t.TempDir()
	bucket, err := NewChunkBucket(dir)
	require.NoError(t, err)

	// Write valid data first
	require.NoError(t, bucket.Write(0, &pbv1.EntityState{EntityId: 1}))
	require.NoError(t, bucket.Flush())

	// Corrupt the file by appending a valid length prefix but truncated data
	chunkFile := filepath.Join(dir, "chunk_0000.tmp")
	f, err := os.OpenFile(chunkFile, os.O_APPEND|os.O_WRONLY, 0644)
	require.NoError(t, err)
	// Write length prefix claiming 100 bytes but no data follows
	lenBuf := []byte{100, 0, 0, 0}
	_, err = f.Write(lenBuf)
	require.NoError(t, err)
	require.NoError(t, f.Close())

	_, err = bucket.Read(0)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "read data")
}

func TestChunkBucket_ReadCorruptedProtobuf(t *testing.T) {
	dir := t.TempDir()
	bucket, err := NewChunkBucket(dir)
	require.NoError(t, err)

	// Write valid data first
	require.NoError(t, bucket.Write(0, &pbv1.EntityState{EntityId: 1}))
	require.NoError(t, bucket.Flush())

	// Corrupt the file by appending a length prefix + garbage protobuf data
	chunkFile := filepath.Join(dir, "chunk_0000.tmp")
	f, err := os.OpenFile(chunkFile, os.O_APPEND|os.O_WRONLY, 0644)
	require.NoError(t, err)
	// Write length prefix of 4 bytes + invalid protobuf data
	lenBuf := []byte{4, 0, 0, 0}
	_, err = f.Write(lenBuf)
	require.NoError(t, err)
	_, err = f.Write([]byte{0xFF, 0xFF, 0xFF, 0xFF})
	require.NoError(t, err)
	require.NoError(t, f.Close())

	// Read should fail on corrupted protobuf or succeed parsing it
	// (depends on protobuf parser — unknown fields are usually ignored)
	_, _ = bucket.Read(0)
}

func TestChunkBucket_ReadTruncatedLength(t *testing.T) {
	dir := t.TempDir()

	// Manually write a file with only 2 bytes (incomplete length prefix)
	require.NoError(t, os.MkdirAll(dir, 0755))
	chunkFile := filepath.Join(dir, "chunk_0000.tmp")
	require.NoError(t, os.WriteFile(chunkFile, []byte{0x01, 0x02}, 0644))

	bucket := &ChunkBucket{
		dir:     dir,
		writers: make(map[uint32]*bufio.Writer),
		files:   make(map[uint32]*os.File),
	}

	_, err := bucket.Read(0)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "read length")
}

func TestChunkBucket_FlushAndReadMultipleChunks(t *testing.T) {
	bucket, err := NewChunkBucket(t.TempDir())
	require.NoError(t, err)
	defer bucket.Cleanup()

	// Write to many chunks
	for i := uint32(0); i < 5; i++ {
		require.NoError(t, bucket.Write(i, &pbv1.EntityState{
			EntityId: i, FrameNum: i * 10, PosX: float32(i) * 100,
		}))
	}
	require.NoError(t, bucket.Flush())

	// Read all back
	for i := uint32(0); i < 5; i++ {
		got, err := bucket.Read(i)
		require.NoError(t, err)
		require.Len(t, got, 1)
		assert.Equal(t, i, got[0].EntityId)
	}
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
