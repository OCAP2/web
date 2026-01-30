// server/storage/protobuf_test.go
package storage

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/proto"

	pb "github.com/OCAP2/web/pkg/schemas/protobuf"
)

func TestProtobufEngineBasics(t *testing.T) {
	engine := NewProtobufEngine("/tmp")

	assert.Equal(t, "protobuf", engine.Name())
	assert.True(t, engine.SupportsStreaming())
}

func TestProtobufEngineGetManifest(t *testing.T) {
	dir := t.TempDir()
	missionDir := filepath.Join(dir, "test_mission")
	require.NoError(t, os.MkdirAll(missionDir, 0755))

	// Create test manifest
	pbManifest := &pb.Manifest{
		Version:        1,
		WorldName:      "altis",
		MissionName:    "Test Mission",
		FrameCount:     1000,
		ChunkSize:      300,
		CaptureDelayMs: 1000,
		ChunkCount:     4,
		Entities: []*pb.EntityDef{
			{Id: 0, Type: pb.EntityType_ENTITY_TYPE_UNIT, Name: "Player1", Side: pb.Side_SIDE_WEST, IsPlayer: true},
			{Id: 1, Type: pb.EntityType_ENTITY_TYPE_VEHICLE, Name: "Truck", VehicleClass: "B_Truck_01"},
		},
	}

	data, err := proto.Marshal(pbManifest)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(missionDir, "manifest.pb"), data, 0644))

	engine := NewProtobufEngine(dir)
	ctx := context.Background()

	manifest, err := engine.GetManifest(ctx, "test_mission")
	require.NoError(t, err)

	assert.Equal(t, "altis", manifest.WorldName)
	assert.Equal(t, "Test Mission", manifest.MissionName)
	assert.Equal(t, uint32(1000), manifest.FrameCount)
	assert.Equal(t, uint32(4), manifest.ChunkCount)
	assert.Len(t, manifest.Entities, 2)

	// Check unit
	assert.Equal(t, "unit", manifest.Entities[0].Type)
	assert.Equal(t, "Player1", manifest.Entities[0].Name)
	assert.Equal(t, "WEST", manifest.Entities[0].Side)
	assert.True(t, manifest.Entities[0].IsPlayer)

	// Check vehicle
	assert.Equal(t, "vehicle", manifest.Entities[1].Type)
	assert.Equal(t, "B_Truck_01", manifest.Entities[1].VehicleClass)
}

func TestProtobufEngineGetManifestMissingFile(t *testing.T) {
	dir := t.TempDir()
	engine := NewProtobufEngine(dir)

	_, err := engine.GetManifest(context.Background(), "nonexistent")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "read manifest")
}

func TestProtobufEngineGetManifestInvalidData(t *testing.T) {
	dir := t.TempDir()
	missionDir := filepath.Join(dir, "test_mission")
	require.NoError(t, os.MkdirAll(missionDir, 0755))

	// Write invalid protobuf data
	require.NoError(t, os.WriteFile(filepath.Join(missionDir, "manifest.pb"), []byte("invalid data"), 0644))

	engine := NewProtobufEngine(dir)
	_, err := engine.GetManifest(context.Background(), "test_mission")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unmarshal manifest")
}

func TestProtobufEngineGetChunk(t *testing.T) {
	dir := t.TempDir()
	missionDir := filepath.Join(dir, "test_mission")
	chunksDir := filepath.Join(missionDir, "chunks")
	require.NoError(t, os.MkdirAll(chunksDir, 0755))

	// Create test chunk
	pbChunk := &pb.Chunk{
		Index:      0,
		StartFrame: 0,
		FrameCount: 2,
		Frames: []*pb.Frame{
			{
				FrameNum: 0,
				Entities: []*pb.EntityState{
					{EntityId: 0, PosX: 100, PosY: 200, Direction: 45, Alive: 1},
				},
			},
			{
				FrameNum: 1,
				Entities: []*pb.EntityState{
					{EntityId: 0, PosX: 101, PosY: 201, Direction: 46, Alive: 1},
				},
			},
		},
	}

	data, err := proto.Marshal(pbChunk)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(chunksDir, "0000.pb"), data, 0644))

	engine := NewProtobufEngine(dir)
	ctx := context.Background()

	chunk, err := engine.GetChunk(ctx, "test_mission", 0)
	require.NoError(t, err)

	assert.Equal(t, uint32(0), chunk.Index)
	assert.Equal(t, uint32(0), chunk.StartFrame)
	assert.Equal(t, uint32(2), chunk.FrameCount)
	assert.Len(t, chunk.Frames, 2)

	// Check first frame
	assert.Equal(t, uint32(0), chunk.Frames[0].FrameNum)
	assert.Len(t, chunk.Frames[0].Entities, 1)
	assert.Equal(t, float32(100), chunk.Frames[0].Entities[0].PosX)
	assert.Equal(t, float32(200), chunk.Frames[0].Entities[0].PosY)
}

func TestProtobufEngineGetChunkWithCrew(t *testing.T) {
	dir := t.TempDir()
	missionDir := filepath.Join(dir, "test_mission")
	chunksDir := filepath.Join(missionDir, "chunks")
	require.NoError(t, os.MkdirAll(chunksDir, 0755))

	// Create test chunk with vehicle crew
	pbChunk := &pb.Chunk{
		Index:      0,
		StartFrame: 0,
		FrameCount: 1,
		Frames: []*pb.Frame{
			{
				FrameNum: 0,
				Entities: []*pb.EntityState{
					{EntityId: 5, PosX: 500, PosY: 600, Direction: 90, Alive: 1, CrewIds: []uint32{1, 2, 3}},
					{EntityId: 1, PosX: 500, PosY: 600, Direction: 90, Alive: 1, VehicleId: 5, IsInVehicle: true},
				},
			},
		},
	}

	data, err := proto.Marshal(pbChunk)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(chunksDir, "0000.pb"), data, 0644))

	engine := NewProtobufEngine(dir)
	chunk, err := engine.GetChunk(context.Background(), "test_mission", 0)
	require.NoError(t, err)

	// Check vehicle with crew
	vehicleState := chunk.Frames[0].Entities[0]
	assert.Equal(t, uint32(5), vehicleState.EntityID)
	assert.Equal(t, []uint32{1, 2, 3}, vehicleState.CrewIDs)

	// Check unit in vehicle
	unitState := chunk.Frames[0].Entities[1]
	assert.Equal(t, uint32(5), unitState.VehicleID)
}

func TestProtobufEngineGetChunkMissingFile(t *testing.T) {
	dir := t.TempDir()
	missionDir := filepath.Join(dir, "test_mission")
	chunksDir := filepath.Join(missionDir, "chunks")
	require.NoError(t, os.MkdirAll(chunksDir, 0755))

	engine := NewProtobufEngine(dir)
	_, err := engine.GetChunk(context.Background(), "test_mission", 99)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "read chunk 99")
}

func TestProtobufEngineChunkCount(t *testing.T) {
	dir := t.TempDir()
	missionDir := filepath.Join(dir, "test_mission")
	require.NoError(t, os.MkdirAll(missionDir, 0755))

	pbManifest := &pb.Manifest{ChunkCount: 5}
	data, err := proto.Marshal(pbManifest)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(missionDir, "manifest.pb"), data, 0644))

	engine := NewProtobufEngine(dir)
	count, err := engine.ChunkCount(context.Background(), "test_mission")
	require.NoError(t, err)
	assert.Equal(t, 5, count)
}

func TestProtobufEngineGetChunkReader(t *testing.T) {
	dir := t.TempDir()
	missionDir := filepath.Join(dir, "test_mission")
	chunksDir := filepath.Join(missionDir, "chunks")
	require.NoError(t, os.MkdirAll(chunksDir, 0755))

	// Create a chunk file with known content
	testData := []byte("test chunk data")
	require.NoError(t, os.WriteFile(filepath.Join(chunksDir, "0000.pb"), testData, 0644))

	engine := NewProtobufEngine(dir)
	reader, err := engine.GetChunkReader(context.Background(), "test_mission", 0)
	require.NoError(t, err)
	defer reader.Close()

	data, err := io.ReadAll(reader)
	require.NoError(t, err)
	assert.Equal(t, testData, data)
}

func TestProtobufEngineGetChunkReaderMissingFile(t *testing.T) {
	dir := t.TempDir()
	engine := NewProtobufEngine(dir)

	_, err := engine.GetChunkReader(context.Background(), "nonexistent", 0)
	require.Error(t, err)
}

func TestProtobufEngineConvert(t *testing.T) {
	dir := t.TempDir()
	engine := NewProtobufEngine(dir)

	// Test with missing input file - should fail
	err := engine.Convert(context.Background(), "nonexistent.json", "output")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "load JSON")
}

func TestEntityTypeToString(t *testing.T) {
	tests := []struct {
		input    pb.EntityType
		expected string
	}{
		{pb.EntityType_ENTITY_TYPE_UNIT, "unit"},
		{pb.EntityType_ENTITY_TYPE_VEHICLE, "vehicle"},
		{pb.EntityType_ENTITY_TYPE_UNKNOWN, "unknown"},
	}

	for _, tt := range tests {
		t.Run(tt.expected, func(t *testing.T) {
			result := entityTypeToString(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestSideToString(t *testing.T) {
	tests := []struct {
		input    pb.Side
		expected string
	}{
		{pb.Side_SIDE_WEST, "WEST"},
		{pb.Side_SIDE_EAST, "EAST"},
		{pb.Side_SIDE_GUER, "GUER"},
		{pb.Side_SIDE_CIV, "CIV"},
		{pb.Side_SIDE_GLOBAL, "GLOBAL"},
		{pb.Side_SIDE_UNKNOWN, "UNKNOWN"},
	}

	for _, tt := range tests {
		t.Run(tt.expected, func(t *testing.T) {
			result := sideToString(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestProtobufEngineFullEntityDef(t *testing.T) {
	dir := t.TempDir()
	missionDir := filepath.Join(dir, "test_mission")
	require.NoError(t, os.MkdirAll(missionDir, 0755))

	// Create manifest with fully populated entity definition
	pbManifest := &pb.Manifest{
		Version:     1,
		WorldName:   "stratis",
		MissionName: "Full Test",
		FrameCount:  500,
		ChunkSize:   100,
		ChunkCount:  5,
		Entities: []*pb.EntityDef{
			{
				Id:           42,
				Type:         pb.EntityType_ENTITY_TYPE_UNIT,
				Name:         "Squad Leader",
				Side:         pb.Side_SIDE_GUER,
				GroupName:    "Alpha",
				Role:         "Leader",
				StartFrame:   10,
				EndFrame:     450,
				IsPlayer:     true,
				VehicleClass: "",
			},
		},
	}

	data, err := proto.Marshal(pbManifest)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(missionDir, "manifest.pb"), data, 0644))

	engine := NewProtobufEngine(dir)
	manifest, err := engine.GetManifest(context.Background(), "test_mission")
	require.NoError(t, err)

	require.Len(t, manifest.Entities, 1)
	ent := manifest.Entities[0]

	assert.Equal(t, uint32(42), ent.ID)
	assert.Equal(t, "unit", ent.Type)
	assert.Equal(t, "Squad Leader", ent.Name)
	assert.Equal(t, "GUER", ent.Side)
	assert.Equal(t, "Alpha", ent.Group)
	assert.Equal(t, "Leader", ent.Role)
	assert.Equal(t, uint32(10), ent.StartFrame)
	assert.Equal(t, uint32(450), ent.EndFrame)
	assert.True(t, ent.IsPlayer)
	assert.Empty(t, ent.VehicleClass)
}
