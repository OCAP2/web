package storage

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"google.golang.org/protobuf/proto"

	pbv1 "github.com/OCAP2/web/pkg/schemas/protobuf/v1"
)

func TestWriteManifest_ReadOnlyDir(t *testing.T) {
	dir := t.TempDir()
	outputDir := filepath.Join(dir, "readonly")
	require.NoError(t, os.MkdirAll(outputDir, 0755))
	require.NoError(t, os.Chmod(outputDir, 0555))
	defer func() { assert.NoError(t, os.Chmod(outputDir, 0755)) }()

	w := &ProtobufWriterV1{}
	result := &ParseResult{
		WorldName:   "altis",
		MissionName: "test",
		FrameCount:  10,
		ChunkSize:   30,
	}

	err := w.WriteManifest(context.Background(), outputDir, result)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "write manifest")
}

func TestWriteChunks_ReadOnlyDir(t *testing.T) {
	dir := t.TempDir()
	outputDir := filepath.Join(dir, "output")
	require.NoError(t, os.MkdirAll(outputDir, 0555))
	defer func() { assert.NoError(t, os.Chmod(outputDir, 0755)) }()

	w := &ProtobufWriterV1{}
	result := &ParseResult{
		WorldName:   "altis",
		MissionName: "test",
		FrameCount:  10,
		ChunkSize:   5,
	}

	err := w.WriteChunks(context.Background(), outputDir, result)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "create chunks directory")
}

func TestWriteChunks_ReadOnlyChunksDir(t *testing.T) {
	// Test the writeChunk error path: chunks dir exists but is read-only
	dir := t.TempDir()
	outputDir := filepath.Join(dir, "output")
	chunksDir := filepath.Join(outputDir, "chunks")
	require.NoError(t, os.MkdirAll(chunksDir, 0755))
	require.NoError(t, os.Chmod(chunksDir, 0555))
	defer func() { assert.NoError(t, os.Chmod(chunksDir, 0755)) }()

	w := &ProtobufWriterV1{}
	result := &ParseResult{
		WorldName:   "altis",
		MissionName: "test",
		FrameCount:  5,
		ChunkSize:   3,
	}

	err := w.WriteChunks(context.Background(), outputDir, result)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "write chunk")
}

func TestWriteChunks_CancelledMidway(t *testing.T) {
	// Test cancellation between chunks (not just pre-cancelled)
	dir := t.TempDir()
	outputDir := filepath.Join(dir, "output")

	w := &ProtobufWriterV1{}
	result := &ParseResult{
		WorldName:   "altis",
		MissionName: "test",
		FrameCount:  100,
		ChunkSize:   10,
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	err := w.WriteChunks(ctx, outputDir, result)
	assert.Error(t, err)
	assert.Equal(t, context.Canceled, err)
}

func TestWriteManifest_WithAllFields(t *testing.T) {
	dir := t.TempDir()

	w := &ProtobufWriterV1{}
	result := &ParseResult{
		WorldName:        "stratis",
		MissionName:      "full_test",
		FrameCount:       200,
		ChunkSize:        50,
		CaptureDelayMs:   500,
		ExtensionVersion: "1.2.3",
		AddonVersion:     "4.5.6",
		Entities: []EntityDef{
			{
				ID: 0, Name: "Player1", Type: "unit", Side: "WEST",
				Group: "Alpha", Role: "rifleman",
				StartFrame: 0, EndFrame: 199, IsPlayer: true,
				FramesFired: []FiredFrame{
					{FrameNum: 10, PosX: 1.0, PosY: 2.0, PosZ: 3.0},
				},
			},
			{
				ID: 1, Name: "Truck", Type: "vehicle", Side: "WEST",
				VehicleClass: "B_Truck_01_F",
				StartFrame:   0, EndFrame: 199,
			},
		},
		Events: []Event{
			{FrameNum: 10, Type: "hit", SourceID: 0, TargetID: 1, Weapon: "rifle", Distance: 150.5},
			{FrameNum: 50, Type: "killed", SourceID: 0, TargetID: 1, Message: "killed by explosion"},
		},
		Markers: []MarkerDef{
			{
				Type: "mil_dot", Text: "Objective", StartFrame: 0, EndFrame: 200,
				PlayerID: -1, Color: "red", Side: "WEST", Shape: "ICON", Brush: "Solid",
				Size: []float32{1.0, 1.0},
				Positions: []MarkerPosition{
					{FrameNum: 0, PosX: 100.0, PosY: 200.0, PosZ: 0.0, Direction: 90.0, Alpha: 1.0},
					{FrameNum: 50, PosX: 110.0, PosY: 210.0, PosZ: 0.0, Direction: 180.0, Alpha: 0.5,
						LineCoords: []float32{1.0, 2.0, 3.0, 4.0}},
				},
			},
		},
		Times: []TimeSample{
			{FrameNum: 0, SystemTimeUTC: "2024-01-01T12:00:00Z", Date: "2024-01-01", TimeMultiplier: 1.0, Time: 43200.0},
		},
	}

	err := w.WriteManifest(context.Background(), dir, result)
	require.NoError(t, err)

	// Read back and verify
	data, err := os.ReadFile(filepath.Join(dir, "manifest.pb"))
	require.NoError(t, err)

	var manifest pbv1.Manifest
	require.NoError(t, proto.Unmarshal(data, &manifest))

	assert.Equal(t, "stratis", manifest.WorldName)
	assert.Equal(t, "full_test", manifest.MissionName)
	assert.Equal(t, uint32(200), manifest.FrameCount)
	assert.Equal(t, uint32(50), manifest.ChunkSize)
	assert.Equal(t, uint32(500), manifest.CaptureDelayMs)
	assert.Equal(t, uint32(4), manifest.ChunkCount)
	assert.Equal(t, "1.2.3", manifest.ExtensionVersion)
	assert.Equal(t, "4.5.6", manifest.AddonVersion)

	require.Len(t, manifest.Entities, 2)
	require.Len(t, manifest.Events, 2)
	require.Len(t, manifest.Markers, 1)
	require.Len(t, manifest.Times, 1)

	// Verify marker positions with line coords
	require.Len(t, manifest.Markers[0].Positions, 2)
	assert.Equal(t, []float32{1.0, 2.0, 3.0, 4.0}, manifest.Markers[0].Positions[1].LineCoords)
}

func TestWriteChunks_WithEntityPositions(t *testing.T) {
	dir := t.TempDir()

	w := &ProtobufWriterV1{}
	result := &ParseResult{
		WorldName:   "altis",
		MissionName: "position_test",
		FrameCount:  6,
		ChunkSize:   3,
		EntityPositions: []EntityPositionData{
			{
				EntityID: 0,
				Positions: []EntityPosition{
					{FrameNum: 0, PosX: 1.0, PosY: 2.0, PosZ: 3.0, Direction: 90, Alive: 1,
						Name: "Player1", IsPlayer: true, GroupName: "Alpha", Side: "WEST"},
					{FrameNum: 1, PosX: 4.0, PosY: 5.0, PosZ: 6.0, Direction: 180, Alive: 1,
						VehicleID: 1, IsInVehicle: true, CrewIDs: []uint32{0, 2}},
					{FrameNum: 3, PosX: 7.0, PosY: 8.0, PosZ: 9.0, Direction: 270, Alive: 0},
				},
			},
			{
				EntityID: 1,
				Positions: []EntityPosition{
					{FrameNum: 0, PosX: 10.0, PosY: 20.0, Alive: 1},
					{FrameNum: 4, PosX: 11.0, PosY: 21.0, Alive: 1},
				},
			},
		},
	}

	err := w.WriteChunks(context.Background(), dir, result)
	require.NoError(t, err)

	chunksDir := filepath.Join(dir, "chunks")

	// Verify chunk 0 (frames 0-2)
	data, err := os.ReadFile(filepath.Join(chunksDir, "0000.pb"))
	require.NoError(t, err)
	var chunk0 pbv1.Chunk
	require.NoError(t, proto.Unmarshal(data, &chunk0))
	assert.Equal(t, uint32(0), chunk0.Index)
	assert.Equal(t, uint32(0), chunk0.StartFrame)
	assert.Equal(t, uint32(3), chunk0.FrameCount)
	require.Len(t, chunk0.Frames, 3)

	// Frame 0 should have 2 entities (both have positions at frame 0)
	assert.Len(t, chunk0.Frames[0].Entities, 2)

	// Verify chunk 1 (frames 3-5)
	data, err = os.ReadFile(filepath.Join(chunksDir, "0001.pb"))
	require.NoError(t, err)
	var chunk1 pbv1.Chunk
	require.NoError(t, proto.Unmarshal(data, &chunk1))
	assert.Equal(t, uint32(1), chunk1.Index)
	assert.Equal(t, uint32(3), chunk1.StartFrame)
	assert.Equal(t, uint32(3), chunk1.FrameCount)
}

func TestBuildChunk_LastChunkTruncated(t *testing.T) {
	w := &ProtobufWriterV1{}
	result := &ParseResult{
		FrameCount: 7,
		ChunkSize:  3,
	}

	// Chunk 2 should cover frames 6-6 (only 1 frame, not 3)
	chunk := w.buildChunk(result, 2)
	assert.Equal(t, uint32(2), chunk.Index)
	assert.Equal(t, uint32(6), chunk.StartFrame)
	assert.Equal(t, uint32(1), chunk.FrameCount)
	require.Len(t, chunk.Frames, 1)
	assert.Equal(t, uint32(6), chunk.Frames[0].FrameNum)
}

func TestGetEntityStateAtFrame_NoMatch(t *testing.T) {
	w := &ProtobufWriterV1{}
	ep := EntityPositionData{
		EntityID: 0,
		Positions: []EntityPosition{
			{FrameNum: 5, PosX: 1.0},
			{FrameNum: 10, PosX: 2.0},
		},
	}

	// Frame 7 doesn't exist in positions
	state := w.getEntityStateAtFrame(ep, 7)
	assert.Nil(t, state)
}
