// server/storage/flatbuffers_test.go
package storage

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"testing"

	fbv1 "github.com/OCAP2/web/pkg/schemas/flatbuffers/v1/generated"
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

	fbv1.EntityDefStart(builder)
	fbv1.EntityDefAddId(builder, 0)
	fbv1.EntityDefAddType(builder, fbv1.EntityTypeUnit)
	fbv1.EntityDefAddName(builder, name1)
	fbv1.EntityDefAddSide(builder, fbv1.SideWest)
	fbv1.EntityDefAddGroupName(builder, group1)
	fbv1.EntityDefAddRole(builder, role1)
	fbv1.EntityDefAddStartFrame(builder, 0)
	fbv1.EntityDefAddEndFrame(builder, 100)
	fbv1.EntityDefAddIsPlayer(builder, true)
	fbv1.EntityDefAddVehicleClass(builder, class1)
	entity1 := fbv1.EntityDefEnd(builder)

	name2 := builder.CreateString("Truck")
	group2 := builder.CreateString("")
	role2 := builder.CreateString("")
	class2 := builder.CreateString("B_Truck_01")

	fbv1.EntityDefStart(builder)
	fbv1.EntityDefAddId(builder, 1)
	fbv1.EntityDefAddType(builder, fbv1.EntityTypeVehicle)
	fbv1.EntityDefAddName(builder, name2)
	fbv1.EntityDefAddSide(builder, fbv1.SideWest)
	fbv1.EntityDefAddGroupName(builder, group2)
	fbv1.EntityDefAddRole(builder, role2)
	fbv1.EntityDefAddVehicleClass(builder, class2)
	entity2 := fbv1.EntityDefEnd(builder)

	fbv1.ManifestStartEntitiesVector(builder, 2)
	builder.PrependUOffsetT(entity2)
	builder.PrependUOffsetT(entity1)
	entitiesVec := builder.EndVector(2)

	worldName := builder.CreateString("altis")
	missionName := builder.CreateString("Test Mission")

	fbv1.ManifestStart(builder)
	fbv1.ManifestAddVersion(builder, 1)
	fbv1.ManifestAddWorldName(builder, worldName)
	fbv1.ManifestAddMissionName(builder, missionName)
	fbv1.ManifestAddFrameCount(builder, 1000)
	fbv1.ManifestAddChunkSize(builder, 300)
	fbv1.ManifestAddCaptureDelayMs(builder, 1000)
	fbv1.ManifestAddChunkCount(builder, 4)
	fbv1.ManifestAddEntities(builder, entitiesVec)
	manifestOff := fbv1.ManifestEnd(builder)

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
	fbv1.EntityStateStart(builder)
	fbv1.EntityStateAddEntityId(builder, 0)
	fbv1.EntityStateAddPosX(builder, 100)
	fbv1.EntityStateAddPosY(builder, 200)
	fbv1.EntityStateAddDirection(builder, 45)
	fbv1.EntityStateAddAlive(builder, 1)
	fbv1.EntityStateAddName(builder, name0)
	state0 := fbv1.EntityStateEnd(builder)

	fbv1.FrameStartEntitiesVector(builder, 1)
	builder.PrependUOffsetT(state0)
	entities0 := builder.EndVector(1)

	fbv1.FrameStart(builder)
	fbv1.FrameAddFrameNum(builder, 0)
	fbv1.FrameAddEntities(builder, entities0)
	frame0 := fbv1.FrameEnd(builder)

	// Build frame 1
	name1 := builder.CreateString("")
	fbv1.EntityStateStart(builder)
	fbv1.EntityStateAddEntityId(builder, 0)
	fbv1.EntityStateAddPosX(builder, 101)
	fbv1.EntityStateAddPosY(builder, 201)
	fbv1.EntityStateAddDirection(builder, 46)
	fbv1.EntityStateAddAlive(builder, 1)
	fbv1.EntityStateAddName(builder, name1)
	state1 := fbv1.EntityStateEnd(builder)

	fbv1.FrameStartEntitiesVector(builder, 1)
	builder.PrependUOffsetT(state1)
	entities1 := builder.EndVector(1)

	fbv1.FrameStart(builder)
	fbv1.FrameAddFrameNum(builder, 1)
	fbv1.FrameAddEntities(builder, entities1)
	frame1 := fbv1.FrameEnd(builder)

	// Build chunk
	fbv1.ChunkStartFramesVector(builder, 2)
	builder.PrependUOffsetT(frame1)
	builder.PrependUOffsetT(frame0)
	framesVec := builder.EndVector(2)

	fbv1.ChunkStart(builder)
	fbv1.ChunkAddIndex(builder, 0)
	fbv1.ChunkAddStartFrame(builder, 0)
	fbv1.ChunkAddFrameCount(builder, 2)
	fbv1.ChunkAddFrames(builder, framesVec)
	chunkOff := fbv1.ChunkEnd(builder)

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
	fbv1.EntityStateStartCrewIdsVector(builder, 3)
	builder.PrependUint32(3)
	builder.PrependUint32(2)
	builder.PrependUint32(1)
	crewVec := builder.EndVector(3)

	name0 := builder.CreateString("")
	fbv1.EntityStateStart(builder)
	fbv1.EntityStateAddEntityId(builder, 5)
	fbv1.EntityStateAddPosX(builder, 500)
	fbv1.EntityStateAddPosY(builder, 600)
	fbv1.EntityStateAddDirection(builder, 90)
	fbv1.EntityStateAddAlive(builder, 1)
	fbv1.EntityStateAddCrewIds(builder, crewVec)
	fbv1.EntityStateAddName(builder, name0)
	vehicleState := fbv1.EntityStateEnd(builder)

	// Build unit in vehicle
	name1 := builder.CreateString("")
	fbv1.EntityStateStart(builder)
	fbv1.EntityStateAddEntityId(builder, 1)
	fbv1.EntityStateAddPosX(builder, 500)
	fbv1.EntityStateAddPosY(builder, 600)
	fbv1.EntityStateAddDirection(builder, 90)
	fbv1.EntityStateAddAlive(builder, 1)
	fbv1.EntityStateAddVehicleId(builder, 5)
	fbv1.EntityStateAddIsInVehicle(builder, true)
	fbv1.EntityStateAddName(builder, name1)
	unitState := fbv1.EntityStateEnd(builder)

	fbv1.FrameStartEntitiesVector(builder, 2)
	builder.PrependUOffsetT(unitState)
	builder.PrependUOffsetT(vehicleState)
	entitiesVec := builder.EndVector(2)

	fbv1.FrameStart(builder)
	fbv1.FrameAddFrameNum(builder, 0)
	fbv1.FrameAddEntities(builder, entitiesVec)
	frameOff := fbv1.FrameEnd(builder)

	fbv1.ChunkStartFramesVector(builder, 1)
	builder.PrependUOffsetT(frameOff)
	framesVec := builder.EndVector(1)

	fbv1.ChunkStart(builder)
	fbv1.ChunkAddIndex(builder, 0)
	fbv1.ChunkAddStartFrame(builder, 0)
	fbv1.ChunkAddFrameCount(builder, 1)
	fbv1.ChunkAddFrames(builder, framesVec)
	chunkOff := fbv1.ChunkEnd(builder)

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

	fbv1.ManifestStart(builder)
	fbv1.ManifestAddWorldName(builder, worldName)
	fbv1.ManifestAddMissionName(builder, missionName)
	fbv1.ManifestAddChunkCount(builder, 5)
	manifestOff := fbv1.ManifestEnd(builder)

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
	assert.Equal(t, "unit", fbEntityTypeToString(fbv1.EntityTypeUnit))
	assert.Equal(t, "vehicle", fbEntityTypeToString(fbv1.EntityTypeVehicle))
	assert.Equal(t, "unknown", fbEntityTypeToString(fbv1.EntityTypeUnknown))

	assert.Equal(t, fbv1.EntityTypeUnit, stringToFBEntityType("unit"))
	assert.Equal(t, fbv1.EntityTypeVehicle, stringToFBEntityType("vehicle"))
	assert.Equal(t, fbv1.EntityTypeUnknown, stringToFBEntityType("invalid"))

	// Test side conversions
	assert.Equal(t, "WEST", fbSideToString(fbv1.SideWest))
	assert.Equal(t, "EAST", fbSideToString(fbv1.SideEast))
	assert.Equal(t, "GUER", fbSideToString(fbv1.SideGuer))
	assert.Equal(t, "CIV", fbSideToString(fbv1.SideCiv))
	assert.Equal(t, "GLOBAL", fbSideToString(fbv1.SideGlobal))
	assert.Equal(t, "UNKNOWN", fbSideToString(fbv1.SideUnknown))

	assert.Equal(t, fbv1.SideWest, stringToFBSide("WEST"))
	assert.Equal(t, fbv1.SideEast, stringToFBSide("EAST"))
	assert.Equal(t, fbv1.SideGuer, stringToFBSide("GUER"))
	assert.Equal(t, fbv1.SideGuer, stringToFBSide("INDEPENDENT"))
	assert.Equal(t, fbv1.SideCiv, stringToFBSide("CIV"))
	assert.Equal(t, fbv1.SideCiv, stringToFBSide("CIVILIAN"))
	assert.Equal(t, fbv1.SideGlobal, stringToFBSide("GLOBAL"))
	assert.Equal(t, fbv1.SideUnknown, stringToFBSide("invalid"))
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

func TestFlatBuffersEngineChunkCountError(t *testing.T) {
	dir := t.TempDir()
	engine := NewFlatBuffersEngine(dir)

	// ChunkCount should fail when GetManifest fails (no manifest file)
	_, err := engine.ChunkCount(context.Background(), "nonexistent")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "read manifest")
}

func TestFlatBuffersEngineConvertInvalidJSON(t *testing.T) {
	dir := t.TempDir()
	inputPath := filepath.Join(dir, "invalid.json")
	outputPath := filepath.Join(dir, "output")

	// Create invalid JSON
	err := os.WriteFile(inputPath, []byte("{ invalid json }"), 0644)
	require.NoError(t, err)

	engine := NewFlatBuffersEngine(dir)
	err = engine.Convert(context.Background(), inputPath, outputPath)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "load JSON")
}

func TestFlatBuffersEngineConvertContextCancelled(t *testing.T) {
	dir := t.TempDir()
	inputPath := filepath.Join(dir, "test.json")
	outputPath := filepath.Join(dir, "output")

	// Create valid JSON with many frames to allow context cancellation
	testJSON := `{
		"worldName": "altis",
		"missionName": "Context Cancel Test",
		"endFrame": 1000,
		"captureDelay": 1,
		"entities": [
			{
				"id": 0,
				"type": "unit",
				"name": "Player1",
				"startFrameNum": 0,
				"positions": []
			}
		]
	}`

	err := os.WriteFile(inputPath, []byte(testJSON), 0644)
	require.NoError(t, err)

	engine := NewFlatBuffersEngine(dir)

	// Create already cancelled context
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	err = engine.Convert(ctx, inputPath, outputPath)
	require.Error(t, err)
	assert.ErrorIs(t, err, context.Canceled)
}

func TestFlatBuffersEngineConvertWithEvents(t *testing.T) {
	dir := t.TempDir()
	inputPath := filepath.Join(dir, "events.json")
	outputPath := filepath.Join(dir, "output")

	// Create JSON with events
	testJSON := `{
		"worldName": "altis",
		"missionName": "Events Test",
		"endFrame": 5,
		"captureDelay": 1,
		"entities": [
			{
				"id": 0,
				"type": "unit",
				"name": "Shooter",
				"side": "WEST",
				"startFrameNum": 0,
				"positions": [
					[[100, 200], 45, 1, 0, "Shooter", 1],
					[[100, 200], 45, 1, 0, "Shooter", 1],
					[[100, 200], 45, 1, 0, "Shooter", 1],
					[[100, 200], 45, 1, 0, "Shooter", 1],
					[[100, 200], 45, 1, 0, "Shooter", 1]
				]
			},
			{
				"id": 1,
				"type": "unit",
				"name": "Target",
				"side": "EAST",
				"startFrameNum": 0,
				"positions": [
					[[150, 250], 180, 1, 0, "Target", 0],
					[[150, 250], 180, 1, 0, "Target", 0],
					[[150, 250], 180, 0, 0, "Target", 0],
					[[150, 250], 180, 0, 0, "Target", 0],
					[[150, 250], 180, 0, 0, "Target", 0]
				]
			}
		],
		"events": [
			[1, "hit", 0, 1, "arifle_MX", 50],
			[2, "killed", 0, 1, "arifle_MX"]
		]
	}`

	err := os.WriteFile(inputPath, []byte(testJSON), 0644)
	require.NoError(t, err)

	engine := NewFlatBuffersEngine(dir)
	err = engine.Convert(context.Background(), inputPath, outputPath)
	require.NoError(t, err)

	// Verify manifest has events
	newEngine := NewFlatBuffersEngine(filepath.Dir(outputPath))
	manifest, err := newEngine.GetManifest(context.Background(), "output")
	require.NoError(t, err)

	assert.Len(t, manifest.Events, 2)
	assert.Equal(t, "hit", manifest.Events[0].Type)
	assert.Equal(t, "killed", manifest.Events[1].Type)
}

func TestFlatBuffersEngineConvertWithCrewInVehicle(t *testing.T) {
	dir := t.TempDir()
	inputPath := filepath.Join(dir, "crew.json")
	outputPath := filepath.Join(dir, "output")

	// Create JSON with vehicle crew
	testJSON := `{
		"worldName": "altis",
		"missionName": "Crew Test",
		"endFrame": 3,
		"captureDelay": 1,
		"entities": [
			{
				"id": 0,
				"type": "unit",
				"name": "Driver",
				"side": "WEST",
				"startFrameNum": 0,
				"positions": [
					[[100, 200], 45, 1, 1, "Driver", 1],
					[[100, 200], 45, 1, 1, "Driver", 1],
					[[100, 200], 45, 1, 1, "Driver", 1]
				]
			},
			{
				"id": 1,
				"type": "vehicle",
				"name": "Truck",
				"class": "B_Truck_01",
				"startFrameNum": 0,
				"positions": [
					[[100, 200], 90, 1, [0]],
					[[101, 201], 91, 1, [0]],
					[[102, 202], 92, 1, [0]]
				]
			}
		]
	}`

	err := os.WriteFile(inputPath, []byte(testJSON), 0644)
	require.NoError(t, err)

	engine := NewFlatBuffersEngine(dir)
	err = engine.Convert(context.Background(), inputPath, outputPath)
	require.NoError(t, err)

	// Verify chunk has crew data
	newEngine := NewFlatBuffersEngine(filepath.Dir(outputPath))
	chunk, err := newEngine.GetChunk(context.Background(), "output", 0)
	require.NoError(t, err)

	// Find vehicle entity in chunk
	for _, frame := range chunk.Frames {
		for _, entity := range frame.Entities {
			if entity.EntityID == 1 { // Vehicle
				assert.NotEmpty(t, entity.CrewIDs, "Vehicle should have crew")
			}
		}
	}
}

// writeVersionPrefixFB writes a version prefix to file data
func writeVersionPrefixFB(data []byte, version SchemaVersion) []byte {
	prefix := make([]byte, 4)
	prefix[0] = byte(version)
	prefix[1] = byte(version >> 8)
	prefix[2] = byte(version >> 16)
	prefix[3] = byte(version >> 24)
	return append(prefix, data...)
}

func TestFlatBuffersEngineGetManifestWithVersionPrefix(t *testing.T) {
	dir := t.TempDir()
	missionDir := filepath.Join(dir, "test_mission")
	require.NoError(t, os.MkdirAll(missionDir, 0755))

	// Create test manifest using FlatBuffers
	builder := flatbuffers.NewBuilder(1024)

	// Build entity definition
	name := builder.CreateString("Player1")
	group := builder.CreateString("Alpha")
	role := builder.CreateString("Rifleman")
	class := builder.CreateString("")

	fbv1.EntityDefStart(builder)
	fbv1.EntityDefAddId(builder, 0)
	fbv1.EntityDefAddType(builder, fbv1.EntityTypeUnit)
	fbv1.EntityDefAddName(builder, name)
	fbv1.EntityDefAddSide(builder, fbv1.SideWest)
	fbv1.EntityDefAddGroupName(builder, group)
	fbv1.EntityDefAddRole(builder, role)
	fbv1.EntityDefAddStartFrame(builder, 0)
	fbv1.EntityDefAddEndFrame(builder, 100)
	fbv1.EntityDefAddIsPlayer(builder, true)
	fbv1.EntityDefAddVehicleClass(builder, class)
	entity := fbv1.EntityDefEnd(builder)

	fbv1.ManifestStartEntitiesVector(builder, 1)
	builder.PrependUOffsetT(entity)
	entitiesVec := builder.EndVector(1)

	worldName := builder.CreateString("altis")
	missionName := builder.CreateString("Versioned Test")

	fbv1.ManifestStart(builder)
	fbv1.ManifestAddVersion(builder, 1)
	fbv1.ManifestAddWorldName(builder, worldName)
	fbv1.ManifestAddMissionName(builder, missionName)
	fbv1.ManifestAddFrameCount(builder, 500)
	fbv1.ManifestAddChunkSize(builder, 300)
	fbv1.ManifestAddCaptureDelayMs(builder, 1000)
	fbv1.ManifestAddChunkCount(builder, 2)
	fbv1.ManifestAddEntities(builder, entitiesVec)
	manifestOff := fbv1.ManifestEnd(builder)

	builder.Finish(manifestOff)

	// Add version prefix
	versionedData := writeVersionPrefixFB(builder.FinishedBytes(), SchemaVersionV1)
	require.NoError(t, os.WriteFile(filepath.Join(missionDir, "manifest.fb"), versionedData, 0644))

	engine := NewFlatBuffersEngine(dir)
	ctx := context.Background()

	manifest, err := engine.GetManifest(ctx, "test_mission")
	require.NoError(t, err)

	assert.Equal(t, "altis", manifest.WorldName)
	assert.Equal(t, "Versioned Test", manifest.MissionName)
	assert.Equal(t, uint32(500), manifest.FrameCount)
	assert.Equal(t, uint32(2), manifest.ChunkCount)
	assert.Len(t, manifest.Entities, 1)
	assert.Equal(t, "Player1", manifest.Entities[0].Name)
	assert.True(t, manifest.Entities[0].IsPlayer)
}

func TestFlatBuffersEngineGetManifestWithoutVersionPrefix(t *testing.T) {
	// This test verifies backward compatibility with legacy files (no version prefix)
	// The existing TestFlatBuffersEngineGetManifest test also covers this case
	dir := t.TempDir()
	missionDir := filepath.Join(dir, "test_mission")
	require.NoError(t, os.MkdirAll(missionDir, 0755))

	// Create test manifest WITHOUT version prefix (legacy format)
	builder := flatbuffers.NewBuilder(256)
	worldName := builder.CreateString("stratis")
	missionName := builder.CreateString("Legacy Test")

	fbv1.ManifestStart(builder)
	fbv1.ManifestAddVersion(builder, 1)
	fbv1.ManifestAddWorldName(builder, worldName)
	fbv1.ManifestAddMissionName(builder, missionName)
	fbv1.ManifestAddFrameCount(builder, 200)
	fbv1.ManifestAddChunkSize(builder, 100)
	fbv1.ManifestAddCaptureDelayMs(builder, 500)
	fbv1.ManifestAddChunkCount(builder, 2)
	manifestOff := fbv1.ManifestEnd(builder)

	builder.Finish(manifestOff)

	// Write directly without version prefix
	require.NoError(t, os.WriteFile(filepath.Join(missionDir, "manifest.fb"), builder.FinishedBytes(), 0644))

	engine := NewFlatBuffersEngine(dir)
	ctx := context.Background()

	manifest, err := engine.GetManifest(ctx, "test_mission")
	require.NoError(t, err)

	assert.Equal(t, "stratis", manifest.WorldName)
	assert.Equal(t, "Legacy Test", manifest.MissionName)
	assert.Equal(t, uint32(200), manifest.FrameCount)
}

func TestFlatBuffersEngineGetChunkWithVersionPrefix(t *testing.T) {
	dir := t.TempDir()
	missionDir := filepath.Join(dir, "test_mission")
	chunksDir := filepath.Join(missionDir, "chunks")
	require.NoError(t, os.MkdirAll(chunksDir, 0755))

	// Create test chunk using FlatBuffers
	builder := flatbuffers.NewBuilder(1024)

	// Build frame 0
	name0 := builder.CreateString("")
	fbv1.EntityStateStart(builder)
	fbv1.EntityStateAddEntityId(builder, 0)
	fbv1.EntityStateAddPosX(builder, 100)
	fbv1.EntityStateAddPosY(builder, 200)
	fbv1.EntityStateAddDirection(builder, 45)
	fbv1.EntityStateAddAlive(builder, 1)
	fbv1.EntityStateAddName(builder, name0)
	state0 := fbv1.EntityStateEnd(builder)

	fbv1.FrameStartEntitiesVector(builder, 1)
	builder.PrependUOffsetT(state0)
	entities0 := builder.EndVector(1)

	fbv1.FrameStart(builder)
	fbv1.FrameAddFrameNum(builder, 0)
	fbv1.FrameAddEntities(builder, entities0)
	frame0 := fbv1.FrameEnd(builder)

	// Build frame 1
	name1 := builder.CreateString("")
	fbv1.EntityStateStart(builder)
	fbv1.EntityStateAddEntityId(builder, 0)
	fbv1.EntityStateAddPosX(builder, 101)
	fbv1.EntityStateAddPosY(builder, 201)
	fbv1.EntityStateAddDirection(builder, 46)
	fbv1.EntityStateAddAlive(builder, 1)
	fbv1.EntityStateAddName(builder, name1)
	state1 := fbv1.EntityStateEnd(builder)

	fbv1.FrameStartEntitiesVector(builder, 1)
	builder.PrependUOffsetT(state1)
	entities1 := builder.EndVector(1)

	fbv1.FrameStart(builder)
	fbv1.FrameAddFrameNum(builder, 1)
	fbv1.FrameAddEntities(builder, entities1)
	frame1 := fbv1.FrameEnd(builder)

	// Build chunk
	fbv1.ChunkStartFramesVector(builder, 2)
	builder.PrependUOffsetT(frame1)
	builder.PrependUOffsetT(frame0)
	framesVec := builder.EndVector(2)

	fbv1.ChunkStart(builder)
	fbv1.ChunkAddIndex(builder, 0)
	fbv1.ChunkAddStartFrame(builder, 0)
	fbv1.ChunkAddFrameCount(builder, 2)
	fbv1.ChunkAddFrames(builder, framesVec)
	chunkOff := fbv1.ChunkEnd(builder)

	builder.Finish(chunkOff)

	// Add version prefix
	versionedData := writeVersionPrefixFB(builder.FinishedBytes(), SchemaVersionV1)
	require.NoError(t, os.WriteFile(filepath.Join(chunksDir, "0000.fb"), versionedData, 0644))

	engine := NewFlatBuffersEngine(dir)
	ctx := context.Background()

	chunk, err := engine.GetChunk(ctx, "test_mission", 0)
	require.NoError(t, err)

	assert.Equal(t, uint32(0), chunk.Index)
	assert.Equal(t, uint32(0), chunk.StartFrame)
	assert.Equal(t, uint32(2), chunk.FrameCount)
	assert.Len(t, chunk.Frames, 2)
	assert.Equal(t, float32(100), chunk.Frames[0].Entities[0].PosX)
	assert.Equal(t, float32(200), chunk.Frames[0].Entities[0].PosY)
}

func TestFlatBuffersEngineGetChunkWithoutVersionPrefix(t *testing.T) {
	// This test verifies backward compatibility with legacy chunk files
	// The existing TestFlatBuffersEngineGetChunk test also covers this case
	dir := t.TempDir()
	missionDir := filepath.Join(dir, "test_mission")
	chunksDir := filepath.Join(missionDir, "chunks")
	require.NoError(t, os.MkdirAll(chunksDir, 0755))

	// Create test chunk WITHOUT version prefix
	builder := flatbuffers.NewBuilder(512)

	name := builder.CreateString("")
	fbv1.EntityStateStart(builder)
	fbv1.EntityStateAddEntityId(builder, 5)
	fbv1.EntityStateAddPosX(builder, 500)
	fbv1.EntityStateAddPosY(builder, 600)
	fbv1.EntityStateAddDirection(builder, 90)
	fbv1.EntityStateAddAlive(builder, 1)
	fbv1.EntityStateAddName(builder, name)
	state := fbv1.EntityStateEnd(builder)

	fbv1.FrameStartEntitiesVector(builder, 1)
	builder.PrependUOffsetT(state)
	entitiesVec := builder.EndVector(1)

	fbv1.FrameStart(builder)
	fbv1.FrameAddFrameNum(builder, 0)
	fbv1.FrameAddEntities(builder, entitiesVec)
	frame := fbv1.FrameEnd(builder)

	fbv1.ChunkStartFramesVector(builder, 1)
	builder.PrependUOffsetT(frame)
	framesVec := builder.EndVector(1)

	fbv1.ChunkStart(builder)
	fbv1.ChunkAddIndex(builder, 0)
	fbv1.ChunkAddStartFrame(builder, 0)
	fbv1.ChunkAddFrameCount(builder, 1)
	fbv1.ChunkAddFrames(builder, framesVec)
	chunkOff := fbv1.ChunkEnd(builder)

	builder.Finish(chunkOff)

	// Write directly without version prefix
	require.NoError(t, os.WriteFile(filepath.Join(chunksDir, "0000.fb"), builder.FinishedBytes(), 0644))

	engine := NewFlatBuffersEngine(dir)
	chunk, err := engine.GetChunk(context.Background(), "test_mission", 0)
	require.NoError(t, err)

	assert.Equal(t, uint32(0), chunk.Index)
	assert.Len(t, chunk.Frames, 1)
	assert.Equal(t, float32(500), chunk.Frames[0].Entities[0].PosX)
}

func TestFlatBuffersEngineUnsupportedVersion(t *testing.T) {
	dir := t.TempDir()
	missionDir := filepath.Join(dir, "test_mission")
	require.NoError(t, os.MkdirAll(missionDir, 0755))

	// Create test manifest
	builder := flatbuffers.NewBuilder(256)
	worldName := builder.CreateString("altis")
	missionName := builder.CreateString("Test")

	fbv1.ManifestStart(builder)
	fbv1.ManifestAddWorldName(builder, worldName)
	fbv1.ManifestAddMissionName(builder, missionName)
	manifestOff := fbv1.ManifestEnd(builder)

	builder.Finish(manifestOff)

	// Add unsupported version prefix (version 2)
	// Note: We use a small version number (< 16) so it's detected as a version prefix.
	// Larger version numbers (>= 16) can't be reliably distinguished from FlatBuffers
	// root offsets and will be treated as legacy files.
	versionedData := writeVersionPrefixFB(builder.FinishedBytes(), SchemaVersion(2))
	require.NoError(t, os.WriteFile(filepath.Join(missionDir, "manifest.fb"), versionedData, 0644))

	engine := NewFlatBuffersEngine(dir)
	_, err := engine.GetManifest(context.Background(), "test_mission")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unsupported flatbuffers schema version: 2")
}

func TestFlatBuffersEngineChunkCountWithVersionPrefix(t *testing.T) {
	dir := t.TempDir()
	missionDir := filepath.Join(dir, "test_mission")
	require.NoError(t, os.MkdirAll(missionDir, 0755))

	// Create manifest with chunk count
	builder := flatbuffers.NewBuilder(256)
	worldName := builder.CreateString("test")
	missionName := builder.CreateString("test")

	fbv1.ManifestStart(builder)
	fbv1.ManifestAddWorldName(builder, worldName)
	fbv1.ManifestAddMissionName(builder, missionName)
	fbv1.ManifestAddChunkCount(builder, 7)
	manifestOff := fbv1.ManifestEnd(builder)

	builder.Finish(manifestOff)

	// Add version prefix
	versionedData := writeVersionPrefixFB(builder.FinishedBytes(), SchemaVersionV1)
	require.NoError(t, os.WriteFile(filepath.Join(missionDir, "manifest.fb"), versionedData, 0644))

	engine := NewFlatBuffersEngine(dir)
	count, err := engine.ChunkCount(context.Background(), "test_mission")
	require.NoError(t, err)
	assert.Equal(t, 7, count)
}
