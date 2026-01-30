// server/storage/flatbuffers_test.go
package storage

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"testing"

	fb "github.com/OCAP2/web/pkg/schemas/flatbuffers/generated"
	pb "github.com/OCAP2/web/pkg/schemas/protobuf"
	flatbuffers "github.com/google/flatbuffers/go"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFlatBuffersEngineBasics(t *testing.T) {
	engine := NewFlatBuffersEngine("/tmp")

	assert.Equal(t, "flatbuffers", engine.Name())
	assert.True(t, engine.SupportsStreaming())
}

func TestFlatBuffersEngineGetManifest(t *testing.T) {
	dir := t.TempDir()
	missionDir := filepath.Join(dir, "test_mission")
	require.NoError(t, os.MkdirAll(missionDir, 0755))

	// Create test manifest using FlatBuffers
	builder := flatbuffers.NewBuilder(1024)

	// Build entity definitions
	name1 := builder.CreateString("Player1")
	group1 := builder.CreateString("Alpha")
	role1 := builder.CreateString("Rifleman")
	class1 := builder.CreateString("")

	fb.EntityDefStart(builder)
	fb.EntityDefAddId(builder, 0)
	fb.EntityDefAddType(builder, fb.EntityTypeUnit)
	fb.EntityDefAddName(builder, name1)
	fb.EntityDefAddSide(builder, fb.SideWest)
	fb.EntityDefAddGroupName(builder, group1)
	fb.EntityDefAddRole(builder, role1)
	fb.EntityDefAddStartFrame(builder, 0)
	fb.EntityDefAddEndFrame(builder, 100)
	fb.EntityDefAddIsPlayer(builder, true)
	fb.EntityDefAddVehicleClass(builder, class1)
	entity1 := fb.EntityDefEnd(builder)

	name2 := builder.CreateString("Truck")
	group2 := builder.CreateString("")
	role2 := builder.CreateString("")
	class2 := builder.CreateString("B_Truck_01")

	fb.EntityDefStart(builder)
	fb.EntityDefAddId(builder, 1)
	fb.EntityDefAddType(builder, fb.EntityTypeVehicle)
	fb.EntityDefAddName(builder, name2)
	fb.EntityDefAddSide(builder, fb.SideWest)
	fb.EntityDefAddGroupName(builder, group2)
	fb.EntityDefAddRole(builder, role2)
	fb.EntityDefAddVehicleClass(builder, class2)
	entity2 := fb.EntityDefEnd(builder)

	fb.ManifestStartEntitiesVector(builder, 2)
	builder.PrependUOffsetT(entity2)
	builder.PrependUOffsetT(entity1)
	entitiesVec := builder.EndVector(2)

	worldName := builder.CreateString("altis")
	missionName := builder.CreateString("Test Mission")

	fb.ManifestStart(builder)
	fb.ManifestAddVersion(builder, 1)
	fb.ManifestAddWorldName(builder, worldName)
	fb.ManifestAddMissionName(builder, missionName)
	fb.ManifestAddFrameCount(builder, 1000)
	fb.ManifestAddChunkSize(builder, 300)
	fb.ManifestAddCaptureDelayMs(builder, 1000)
	fb.ManifestAddChunkCount(builder, 4)
	fb.ManifestAddEntities(builder, entitiesVec)
	manifestOff := fb.ManifestEnd(builder)

	builder.Finish(manifestOff)
	require.NoError(t, os.WriteFile(filepath.Join(missionDir, "manifest.fb"), builder.FinishedBytes(), 0644))

	engine := NewFlatBuffersEngine(dir)
	ctx := context.Background()

	manifest, err := engine.GetManifest(ctx, "test_mission")
	require.NoError(t, err)

	assert.Equal(t, "altis", manifest.WorldName)
	assert.Equal(t, "Test Mission", manifest.MissionName)
	assert.Equal(t, uint32(1000), manifest.FrameCount)
	assert.Equal(t, uint32(4), manifest.ChunkCount)
	assert.Len(t, manifest.Entities, 2)

	// Check unit (entities are reversed due to FlatBuffers vector ordering)
	assert.Equal(t, "unit", manifest.Entities[0].Type)
	assert.Equal(t, "Player1", manifest.Entities[0].Name)
	assert.Equal(t, "WEST", manifest.Entities[0].Side)
	assert.True(t, manifest.Entities[0].IsPlayer)

	// Check vehicle
	assert.Equal(t, "vehicle", manifest.Entities[1].Type)
	assert.Equal(t, "B_Truck_01", manifest.Entities[1].VehicleClass)
}

func TestFlatBuffersEngineGetManifestMissingFile(t *testing.T) {
	dir := t.TempDir()
	engine := NewFlatBuffersEngine(dir)

	_, err := engine.GetManifest(context.Background(), "nonexistent")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "read manifest")
}

func TestFlatBuffersEngineGetChunk(t *testing.T) {
	dir := t.TempDir()
	missionDir := filepath.Join(dir, "test_mission")
	chunksDir := filepath.Join(missionDir, "chunks")
	require.NoError(t, os.MkdirAll(chunksDir, 0755))

	// Create test chunk using FlatBuffers
	builder := flatbuffers.NewBuilder(1024)

	// Build frame 0
	name0 := builder.CreateString("")
	fb.EntityStateStart(builder)
	fb.EntityStateAddEntityId(builder, 0)
	fb.EntityStateAddPosX(builder, 100)
	fb.EntityStateAddPosY(builder, 200)
	fb.EntityStateAddDirection(builder, 45)
	fb.EntityStateAddAlive(builder, 1)
	fb.EntityStateAddName(builder, name0)
	state0 := fb.EntityStateEnd(builder)

	fb.FrameStartEntitiesVector(builder, 1)
	builder.PrependUOffsetT(state0)
	entities0 := builder.EndVector(1)

	fb.FrameStart(builder)
	fb.FrameAddFrameNum(builder, 0)
	fb.FrameAddEntities(builder, entities0)
	frame0 := fb.FrameEnd(builder)

	// Build frame 1
	name1 := builder.CreateString("")
	fb.EntityStateStart(builder)
	fb.EntityStateAddEntityId(builder, 0)
	fb.EntityStateAddPosX(builder, 101)
	fb.EntityStateAddPosY(builder, 201)
	fb.EntityStateAddDirection(builder, 46)
	fb.EntityStateAddAlive(builder, 1)
	fb.EntityStateAddName(builder, name1)
	state1 := fb.EntityStateEnd(builder)

	fb.FrameStartEntitiesVector(builder, 1)
	builder.PrependUOffsetT(state1)
	entities1 := builder.EndVector(1)

	fb.FrameStart(builder)
	fb.FrameAddFrameNum(builder, 1)
	fb.FrameAddEntities(builder, entities1)
	frame1 := fb.FrameEnd(builder)

	// Build chunk
	fb.ChunkStartFramesVector(builder, 2)
	builder.PrependUOffsetT(frame1)
	builder.PrependUOffsetT(frame0)
	framesVec := builder.EndVector(2)

	fb.ChunkStart(builder)
	fb.ChunkAddIndex(builder, 0)
	fb.ChunkAddStartFrame(builder, 0)
	fb.ChunkAddFrameCount(builder, 2)
	fb.ChunkAddFrames(builder, framesVec)
	chunkOff := fb.ChunkEnd(builder)

	builder.Finish(chunkOff)
	require.NoError(t, os.WriteFile(filepath.Join(chunksDir, "0000.fb"), builder.FinishedBytes(), 0644))

	engine := NewFlatBuffersEngine(dir)
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

func TestFlatBuffersEngineGetChunkWithCrew(t *testing.T) {
	dir := t.TempDir()
	missionDir := filepath.Join(dir, "test_mission")
	chunksDir := filepath.Join(missionDir, "chunks")
	require.NoError(t, os.MkdirAll(chunksDir, 0755))

	// Create test chunk with vehicle crew
	builder := flatbuffers.NewBuilder(1024)

	// Build vehicle state with crew
	fb.EntityStateStartCrewIdsVector(builder, 3)
	builder.PrependUint32(3)
	builder.PrependUint32(2)
	builder.PrependUint32(1)
	crewVec := builder.EndVector(3)

	name0 := builder.CreateString("")
	fb.EntityStateStart(builder)
	fb.EntityStateAddEntityId(builder, 5)
	fb.EntityStateAddPosX(builder, 500)
	fb.EntityStateAddPosY(builder, 600)
	fb.EntityStateAddDirection(builder, 90)
	fb.EntityStateAddAlive(builder, 1)
	fb.EntityStateAddCrewIds(builder, crewVec)
	fb.EntityStateAddName(builder, name0)
	vehicleState := fb.EntityStateEnd(builder)

	// Build unit in vehicle
	name1 := builder.CreateString("")
	fb.EntityStateStart(builder)
	fb.EntityStateAddEntityId(builder, 1)
	fb.EntityStateAddPosX(builder, 500)
	fb.EntityStateAddPosY(builder, 600)
	fb.EntityStateAddDirection(builder, 90)
	fb.EntityStateAddAlive(builder, 1)
	fb.EntityStateAddVehicleId(builder, 5)
	fb.EntityStateAddIsInVehicle(builder, true)
	fb.EntityStateAddName(builder, name1)
	unitState := fb.EntityStateEnd(builder)

	fb.FrameStartEntitiesVector(builder, 2)
	builder.PrependUOffsetT(unitState)
	builder.PrependUOffsetT(vehicleState)
	entitiesVec := builder.EndVector(2)

	fb.FrameStart(builder)
	fb.FrameAddFrameNum(builder, 0)
	fb.FrameAddEntities(builder, entitiesVec)
	frameOff := fb.FrameEnd(builder)

	fb.ChunkStartFramesVector(builder, 1)
	builder.PrependUOffsetT(frameOff)
	framesVec := builder.EndVector(1)

	fb.ChunkStart(builder)
	fb.ChunkAddIndex(builder, 0)
	fb.ChunkAddStartFrame(builder, 0)
	fb.ChunkAddFrameCount(builder, 1)
	fb.ChunkAddFrames(builder, framesVec)
	chunkOff := fb.ChunkEnd(builder)

	builder.Finish(chunkOff)
	require.NoError(t, os.WriteFile(filepath.Join(chunksDir, "0000.fb"), builder.FinishedBytes(), 0644))

	engine := NewFlatBuffersEngine(dir)
	chunk, err := engine.GetChunk(context.Background(), "test_mission", 0)
	require.NoError(t, err)

	// Check vehicle with crew
	vehicleEntity := chunk.Frames[0].Entities[0]
	assert.Equal(t, uint32(5), vehicleEntity.EntityID)
	assert.Equal(t, []uint32{1, 2, 3}, vehicleEntity.CrewIDs)

	// Check unit in vehicle
	unitEntity := chunk.Frames[0].Entities[1]
	assert.Equal(t, uint32(5), unitEntity.VehicleID)
	assert.True(t, unitEntity.IsInVehicle)
}

func TestFlatBuffersEngineGetChunkMissingFile(t *testing.T) {
	dir := t.TempDir()
	missionDir := filepath.Join(dir, "test_mission")
	chunksDir := filepath.Join(missionDir, "chunks")
	require.NoError(t, os.MkdirAll(chunksDir, 0755))

	engine := NewFlatBuffersEngine(dir)
	_, err := engine.GetChunk(context.Background(), "test_mission", 99)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "read chunk 99")
}

func TestFlatBuffersEngineChunkCount(t *testing.T) {
	dir := t.TempDir()
	missionDir := filepath.Join(dir, "test_mission")
	require.NoError(t, os.MkdirAll(missionDir, 0755))

	// Create manifest with chunk count
	builder := flatbuffers.NewBuilder(256)
	worldName := builder.CreateString("test")
	missionName := builder.CreateString("test")

	fb.ManifestStart(builder)
	fb.ManifestAddWorldName(builder, worldName)
	fb.ManifestAddMissionName(builder, missionName)
	fb.ManifestAddChunkCount(builder, 5)
	manifestOff := fb.ManifestEnd(builder)

	builder.Finish(manifestOff)
	require.NoError(t, os.WriteFile(filepath.Join(missionDir, "manifest.fb"), builder.FinishedBytes(), 0644))

	engine := NewFlatBuffersEngine(dir)
	count, err := engine.ChunkCount(context.Background(), "test_mission")
	require.NoError(t, err)
	assert.Equal(t, 5, count)
}

func TestFlatBuffersEngineGetChunkReader(t *testing.T) {
	dir := t.TempDir()
	missionDir := filepath.Join(dir, "test_mission")
	chunksDir := filepath.Join(missionDir, "chunks")
	require.NoError(t, os.MkdirAll(chunksDir, 0755))

	// Create a chunk file with known content
	testData := []byte("test flatbuffers chunk data")
	require.NoError(t, os.WriteFile(filepath.Join(chunksDir, "0000.fb"), testData, 0644))

	engine := NewFlatBuffersEngine(dir)
	reader, err := engine.GetChunkReader(context.Background(), "test_mission", 0)
	require.NoError(t, err)
	defer reader.Close()

	data, err := io.ReadAll(reader)
	require.NoError(t, err)
	assert.Equal(t, testData, data)
}

func TestFlatBuffersEngineGetChunkReaderMissingFile(t *testing.T) {
	dir := t.TempDir()
	engine := NewFlatBuffersEngine(dir)

	_, err := engine.GetChunkReader(context.Background(), "nonexistent", 0)
	require.Error(t, err)
}

func TestFlatBuffersTypeConversions(t *testing.T) {
	// Test entity type conversions
	assert.Equal(t, "unit", fbEntityTypeToString(fb.EntityTypeUnit))
	assert.Equal(t, "vehicle", fbEntityTypeToString(fb.EntityTypeVehicle))
	assert.Equal(t, "unknown", fbEntityTypeToString(fb.EntityTypeUnknown))

	assert.Equal(t, fb.EntityTypeUnit, stringToFBEntityType("unit"))
	assert.Equal(t, fb.EntityTypeVehicle, stringToFBEntityType("vehicle"))
	assert.Equal(t, fb.EntityTypeUnknown, stringToFBEntityType("invalid"))

	// Test side conversions
	assert.Equal(t, "WEST", fbSideToString(fb.SideWest))
	assert.Equal(t, "EAST", fbSideToString(fb.SideEast))
	assert.Equal(t, "GUER", fbSideToString(fb.SideGuer))
	assert.Equal(t, "CIV", fbSideToString(fb.SideCiv))
	assert.Equal(t, "GLOBAL", fbSideToString(fb.SideGlobal))
	assert.Equal(t, "UNKNOWN", fbSideToString(fb.SideUnknown))

	assert.Equal(t, fb.SideWest, stringToFBSide("WEST"))
	assert.Equal(t, fb.SideEast, stringToFBSide("EAST"))
	assert.Equal(t, fb.SideGuer, stringToFBSide("GUER"))
	assert.Equal(t, fb.SideGuer, stringToFBSide("INDEPENDENT"))
	assert.Equal(t, fb.SideCiv, stringToFBSide("CIV"))
	assert.Equal(t, fb.SideCiv, stringToFBSide("CIVILIAN"))
	assert.Equal(t, fb.SideGlobal, stringToFBSide("GLOBAL"))
	assert.Equal(t, fb.SideUnknown, stringToFBSide("invalid"))
}

func TestFlatBuffersEngineGetManifestReader(t *testing.T) {
	dir := t.TempDir()
	missionDir := filepath.Join(dir, "test_mission")
	require.NoError(t, os.MkdirAll(missionDir, 0755))

	// Create test manifest data
	testData := []byte("test flatbuffers manifest data")
	require.NoError(t, os.WriteFile(filepath.Join(missionDir, "manifest.fb"), testData, 0644))

	engine := NewFlatBuffersEngine(dir)
	reader, err := engine.GetManifestReader(context.Background(), "test_mission")
	require.NoError(t, err)
	defer reader.Close()

	data, err := io.ReadAll(reader)
	require.NoError(t, err)
	assert.Equal(t, testData, data)
}

func TestFlatBuffersEngineGetManifestReaderMissingFile(t *testing.T) {
	dir := t.TempDir()
	engine := NewFlatBuffersEngine(dir)

	_, err := engine.GetManifestReader(context.Background(), "nonexistent")
	require.Error(t, err)
}

func TestFlatBuffersEngineConvert(t *testing.T) {
	dir := t.TempDir()
	inputPath := filepath.Join(dir, "test.json")
	outputPath := filepath.Join(dir, "output")

	// Create test JSON data
	testJSON := `{
		"worldName": "altis",
		"missionName": "FlatBuffers Convert Test",
		"endFrame": 10,
		"captureDelay": 1,
		"entities": [
			{
				"id": 0,
				"type": "unit",
				"name": "Player1",
				"side": "WEST",
				"group": "Alpha",
				"role": "Rifleman",
				"startFrameNum": 0,
				"isPlayer": 1,
				"positions": [
					[[100, 200], 45, 1, 0, "Player1", 1],
					[[101, 201], 46, 1, 0, "Player1", 1],
					[[102, 202], 47, 1, 0, "Player1", 1],
					[[103, 203], 48, 1, 0, "Player1", 1],
					[[104, 204], 49, 1, 0, "Player1", 1],
					[[105, 205], 50, 1, 0, "Player1", 1],
					[[106, 206], 51, 1, 0, "Player1", 1],
					[[107, 207], 52, 1, 0, "Player1", 1],
					[[108, 208], 53, 1, 0, "Player1", 1],
					[[109, 209], 54, 0, 0, "Player1", 1]
				]
			},
			{
				"id": 1,
				"type": "vehicle",
				"name": "Truck",
				"class": "B_Truck_01",
				"startFrameNum": 0,
				"positions": [
					[[500, 600], 180, 1, []],
					[[501, 601], 181, 1, []],
					[[502, 602], 182, 1, []],
					[[503, 603], 183, 1, []],
					[[504, 604], 184, 1, []],
					[[505, 605], 185, 1, []],
					[[506, 606], 186, 1, []],
					[[507, 607], 187, 1, []],
					[[508, 608], 188, 1, []],
					[[509, 609], 189, 1, []]
				]
			}
		],
		"events": [
			[9, "killed", 0, 0, "arifle_MX"]
		],
		"Markers": [],
		"times": []
	}`

	require.NoError(t, os.WriteFile(inputPath, []byte(testJSON), 0644))

	engine := NewFlatBuffersEngine(dir)
	ctx := context.Background()

	err := engine.Convert(ctx, inputPath, outputPath)
	require.NoError(t, err)

	// Verify manifest was created
	manifestPath := filepath.Join(outputPath, "manifest.fb")
	_, err = os.Stat(manifestPath)
	require.NoError(t, err)

	// Verify we can read the manifest
	newEngine := NewFlatBuffersEngine(filepath.Dir(outputPath))
	manifest, err := newEngine.GetManifest(ctx, "output")
	require.NoError(t, err)

	assert.Equal(t, "altis", manifest.WorldName)
	assert.Equal(t, "FlatBuffers Convert Test", manifest.MissionName)
	assert.Equal(t, uint32(10), manifest.FrameCount)
	assert.Len(t, manifest.Entities, 2)

	// Verify first entity
	assert.Equal(t, "unit", manifest.Entities[0].Type)
	assert.Equal(t, "Player1", manifest.Entities[0].Name)
	assert.Equal(t, "WEST", manifest.Entities[0].Side)
	assert.True(t, manifest.Entities[0].IsPlayer)

	// Verify vehicle
	assert.Equal(t, "vehicle", manifest.Entities[1].Type)
	assert.Equal(t, "Truck", manifest.Entities[1].Name)
	assert.Equal(t, "B_Truck_01", manifest.Entities[1].VehicleClass)

	// Verify chunks were created
	chunksDir := filepath.Join(outputPath, "chunks")
	_, err = os.Stat(filepath.Join(chunksDir, "0000.fb"))
	require.NoError(t, err)

	// Read and verify chunk
	chunk, err := newEngine.GetChunk(ctx, "output", 0)
	require.NoError(t, err)
	assert.Greater(t, len(chunk.Frames), 0)
}

func TestFlatBuffersEngineConvertMissingFile(t *testing.T) {
	dir := t.TempDir()
	engine := NewFlatBuffersEngine(dir)

	err := engine.Convert(context.Background(), "nonexistent.json", "output")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "load JSON")
}

func TestPbEntityTypeToString(t *testing.T) {
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
			result := pbEntityTypeToString(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestPbSideToString(t *testing.T) {
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
			result := pbSideToString(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestPbManifestToStorageManifest(t *testing.T) {
	pbManifest := &pb.Manifest{
		Version:        2,
		WorldName:      "stratis",
		MissionName:    "Conversion Test",
		FrameCount:     500,
		ChunkSize:      100,
		CaptureDelayMs: 1000,
		ChunkCount:     5,
		Entities: []*pb.EntityDef{
			{
				Id:           1,
				Type:         pb.EntityType_ENTITY_TYPE_UNIT,
				Name:         "Squad Leader",
				Side:         pb.Side_SIDE_GUER,
				GroupName:    "Bravo",
				Role:         "Leader",
				StartFrame:   0,
				EndFrame:     450,
				IsPlayer:     true,
				VehicleClass: "",
			},
			{
				Id:           2,
				Type:         pb.EntityType_ENTITY_TYPE_VEHICLE,
				Name:         "Transport",
				Side:         pb.Side_SIDE_WEST,
				GroupName:    "",
				Role:         "",
				StartFrame:   10,
				EndFrame:     400,
				IsPlayer:     false,
				VehicleClass: "B_Heli_Transport",
			},
		},
		Events: []*pb.Event{
			{
				FrameNum: 100,
				Type:     "hit",
				SourceId: 1,
				TargetId: 2,
				Message:  "",
				Distance: 50.5,
				Weapon:   "arifle_MX",
			},
		},
	}

	manifest := pbManifestToStorageManifest(pbManifest)

	// Verify basic fields
	assert.Equal(t, uint32(2), manifest.Version)
	assert.Equal(t, "stratis", manifest.WorldName)
	assert.Equal(t, "Conversion Test", manifest.MissionName)
	assert.Equal(t, uint32(500), manifest.FrameCount)
	assert.Equal(t, uint32(100), manifest.ChunkSize)
	assert.Equal(t, uint32(1000), manifest.CaptureDelayMs)
	assert.Equal(t, uint32(5), manifest.ChunkCount)

	// Verify entities
	require.Len(t, manifest.Entities, 2)

	ent0 := manifest.Entities[0]
	assert.Equal(t, uint32(1), ent0.ID)
	assert.Equal(t, "unit", ent0.Type)
	assert.Equal(t, "Squad Leader", ent0.Name)
	assert.Equal(t, "GUER", ent0.Side)
	assert.Equal(t, "Bravo", ent0.Group)
	assert.Equal(t, "Leader", ent0.Role)
	assert.Equal(t, uint32(0), ent0.StartFrame)
	assert.Equal(t, uint32(450), ent0.EndFrame)
	assert.True(t, ent0.IsPlayer)
	assert.Empty(t, ent0.VehicleClass)

	ent1 := manifest.Entities[1]
	assert.Equal(t, uint32(2), ent1.ID)
	assert.Equal(t, "vehicle", ent1.Type)
	assert.Equal(t, "Transport", ent1.Name)
	assert.Equal(t, "WEST", ent1.Side)
	assert.Equal(t, "B_Heli_Transport", ent1.VehicleClass)
	assert.False(t, ent1.IsPlayer)

	// Verify events
	require.Len(t, manifest.Events, 1)
	evt := manifest.Events[0]
	assert.Equal(t, uint32(100), evt.FrameNum)
	assert.Equal(t, "hit", evt.Type)
	assert.Equal(t, uint32(1), evt.SourceID)
	assert.Equal(t, uint32(2), evt.TargetID)
	assert.Equal(t, float32(50.5), evt.Distance)
	assert.Equal(t, "arifle_MX", evt.Weapon)
}

func TestPbManifestToStorageManifestEmpty(t *testing.T) {
	pbManifest := &pb.Manifest{
		Version:     1,
		WorldName:   "empty",
		MissionName: "Empty Test",
	}

	manifest := pbManifestToStorageManifest(pbManifest)

	assert.Equal(t, "empty", manifest.WorldName)
	assert.Empty(t, manifest.Entities)
	assert.Empty(t, manifest.Events)
}
