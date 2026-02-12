package storage

import (
	"context"
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/proto"

	pbv1 "github.com/OCAP2/web/pkg/schemas/protobuf/v1"
)

// mockWriter is a test writer implementation
type mockWriter struct {
	version SchemaVersion
	format  string
}

func (m *mockWriter) Version() SchemaVersion {
	return m.version
}

func (m *mockWriter) Format() string {
	return m.format
}

func (m *mockWriter) WriteManifest(ctx context.Context, outputPath string, result *ParseResult) error {
	return nil
}

func (m *mockWriter) WriteChunks(ctx context.Context, outputPath string, result *ParseResult) error {
	return nil
}

func TestRegisterAndGetWriter(t *testing.T) {
	// Clear registry before test
	writers = make(map[string]Writer)

	// Create and register a mock writer
	mock := &mockWriter{version: SchemaVersionV1, format: "protobuf"}
	RegisterWriter(mock)

	// Test GetWriter returns the registered writer
	w, err := GetWriter("protobuf", SchemaVersionV1)
	require.NoError(t, err)
	require.NotNil(t, w)
	assert.Equal(t, SchemaVersionV1, w.Version())
	assert.Equal(t, "protobuf", w.Format())
}

func TestGetWriterUnknownFormat(t *testing.T) {
	// Clear registry before test
	writers = make(map[string]Writer)

	// Register a protobuf writer
	mock := &mockWriter{version: SchemaVersionV1, format: "protobuf"}
	RegisterWriter(mock)

	// Test GetWriter returns error for unknown format
	w, err := GetWriter("unknown", SchemaVersionV1)
	require.Error(t, err)
	assert.Nil(t, w)
	assert.Contains(t, err.Error(), "no writer for unknown version")
}

func TestGetWriterUnknownVersion(t *testing.T) {
	// Clear registry before test
	writers = make(map[string]Writer)

	// Register a v1 protobuf writer
	mock := &mockWriter{version: SchemaVersionV1, format: "protobuf"}
	RegisterWriter(mock)

	// Test GetWriter returns error for unknown version
	w, err := GetWriter("protobuf", SchemaVersion(99))
	require.Error(t, err)
	assert.Nil(t, w)
	assert.Contains(t, err.Error(), "no writer for protobuf version 99")
}

func TestGetWriterUnregistered(t *testing.T) {
	// Clear registry before test
	writers = make(map[string]Writer)

	// Test GetWriter returns error when no writers registered
	w, err := GetWriter("protobuf", SchemaVersionV1)
	require.Error(t, err)
	assert.Nil(t, w)
}

func TestRegisterWriterOverwrites(t *testing.T) {
	// Clear registry before test
	writers = make(map[string]Writer)

	// Register first writer
	mock1 := &mockWriter{version: SchemaVersionV1, format: "protobuf"}
	RegisterWriter(mock1)

	// Register second writer with same format and version
	mock2 := &mockWriter{version: SchemaVersionV1, format: "protobuf"}
	RegisterWriter(mock2)

	// Should get the second writer
	w, err := GetWriter("protobuf", SchemaVersionV1)
	require.NoError(t, err)
	assert.Same(t, mock2, w)
}

// ProtobufWriterV1 tests

func TestProtobufWriterV1Registration(t *testing.T) {
	// Clear registry and re-register
	writers = make(map[string]Writer)
	RegisterWriter(&ProtobufWriterV1{})

	// Test that the writer is registered
	w, err := GetWriter("protobuf", SchemaVersionV1)
	require.NoError(t, err)
	require.NotNil(t, w)

	// Verify it's the ProtobufWriterV1
	assert.IsType(t, &ProtobufWriterV1{}, w)
}

func TestProtobufWriterV1VersionAndFormat(t *testing.T) {
	w := &ProtobufWriterV1{}

	assert.Equal(t, SchemaVersionV1, w.Version())
	assert.Equal(t, "protobuf", w.Format())
}

func TestProtobufWriterV1WriteManifest(t *testing.T) {
	w := &ProtobufWriterV1{}

	tmpDir := t.TempDir()

	result := &ParseResult{
		WorldName:      "TestWorld",
		MissionName:    "TestMission",
		FrameCount:     100,
		ChunkSize:      50,
		CaptureDelayMs: 1000,
		Entities: []EntityDef{
			{
				ID:         1,
				Type:       "unit",
				Name:       "Player1",
				Side:       "WEST",
				Group:      "Alpha",
				Role:       "rifleman",
				StartFrame: 0,
				EndFrame:   99,
				IsPlayer:   true,
			},
			{
				ID:           2,
				Type:         "vehicle",
				Name:         "Truck1",
				Side:         "WEST",
				VehicleClass: "B_Truck_01_transport_F",
				StartFrame:   0,
				EndFrame:     99,
			},
		},
		Events: []Event{
			{
				FrameNum: 10,
				Type:     "hit",
				SourceID: 1,
				TargetID: 2,
				Weapon:   "rifle",
			},
		},
		Markers: []MarkerDef{
			{
				Type:       "mil_dot",
				Text:       "Objective",
				StartFrame: 0,
				EndFrame:   100,
				PlayerID:   -1,
				Color:      "red",
				Side:       "WEST",
				Positions: []MarkerPosition{
					{FrameNum: 0, PosX: 100.0, PosY: 200.0, PosZ: 0.0},
				},
			},
		},
		Times: []TimeSample{
			{
				FrameNum:       0,
				SystemTimeUTC:  "2024-01-01T12:00:00Z",
				Date:           "2024-01-01",
				TimeMultiplier: 1.0,
				Time:           43200.0,
			},
		},
	}

	ctx := context.Background()
	require.NoError(t, w.WriteManifest(ctx, tmpDir, result))

	// Verify file was created and contains valid protobuf
	manifestPath := tmpDir + "/manifest.pb"
	data, err := os.ReadFile(manifestPath)
	require.NoError(t, err, "read manifest file")
	require.NotEmpty(t, data, "manifest file is empty")

	// Verify the data is valid protobuf (no version prefix)
	var pbManifest pbv1.Manifest
	require.NoError(t, proto.Unmarshal(data, &pbManifest), "unmarshal manifest protobuf")

	assert.Equal(t, "TestWorld", pbManifest.WorldName)
}

func TestProtobufWriterV1WriteChunks(t *testing.T) {
	w := &ProtobufWriterV1{}

	tmpDir := t.TempDir()

	result := &ParseResult{
		WorldName:      "TestWorld",
		MissionName:    "TestMission",
		FrameCount:     100,
		ChunkSize:      50,
		CaptureDelayMs: 1000,
		EntityPositions: []EntityPositionData{
			{
				EntityID: 1,
				Positions: []EntityPosition{
					{FrameNum: 0, PosX: 100.0, PosY: 200.0, Direction: 90, Alive: 1},
					{FrameNum: 1, PosX: 101.0, PosY: 201.0, Direction: 90, Alive: 1},
				},
			},
		},
	}

	ctx := context.Background()
	require.NoError(t, w.WriteChunks(ctx, tmpDir, result))

	// Verify chunks directory was created
	chunksDir := tmpDir + "/chunks"
	entries, err := os.ReadDir(chunksDir)
	require.NoError(t, err, "read chunks directory")

	// Should have 2 chunks (100 frames / 50 chunk size = 2)
	assert.Len(t, entries, 2)

	// Verify first chunk file contains valid protobuf (no version prefix)
	chunkPath := chunksDir + "/0000.pb"
	data, err := os.ReadFile(chunkPath)
	require.NoError(t, err, "read chunk file")
	require.NotEmpty(t, data, "chunk file is empty")

	var pbChunk pbv1.Chunk
	require.NoError(t, proto.Unmarshal(data, &pbChunk), "unmarshal chunk protobuf")
	assert.Equal(t, uint32(0), pbChunk.Index)
}

func TestProtobufWriterV1WriteChunksCancellation(t *testing.T) {
	w := &ProtobufWriterV1{}

	tmpDir := t.TempDir()

	result := &ParseResult{
		WorldName:      "TestWorld",
		MissionName:    "TestMission",
		FrameCount:     1000,
		ChunkSize:      100,
		CaptureDelayMs: 1000,
	}

	// Create a cancelled context
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	// Write chunks should return context error
	err := w.WriteChunks(ctx, tmpDir, result)
	assert.Equal(t, context.Canceled, err)
}

func TestStringToEntityType(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"unit", "ENTITY_TYPE_UNIT"},
		{"Unit", "ENTITY_TYPE_UNIT"},
		{"UNIT", "ENTITY_TYPE_UNIT"},
		{"vehicle", "ENTITY_TYPE_VEHICLE"},
		{"Vehicle", "ENTITY_TYPE_VEHICLE"},
		{"VEHICLE", "ENTITY_TYPE_VEHICLE"},
		{"unknown", "ENTITY_TYPE_UNKNOWN"},
		{"", "ENTITY_TYPE_UNKNOWN"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			assert.Equal(t, tt.expected, stringToEntityType(tt.input).String())
		})
	}
}

func TestStringToSide(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"WEST", "SIDE_WEST"},
		{"west", "SIDE_WEST"},
		{"West", "SIDE_WEST"},
		{"EAST", "SIDE_EAST"},
		{"east", "SIDE_EAST"},
		{"GUER", "SIDE_GUER"},
		{"INDEPENDENT", "SIDE_GUER"},
		{"CIV", "SIDE_CIV"},
		{"CIVILIAN", "SIDE_CIV"},
		{"GLOBAL", "SIDE_GLOBAL"},
		{"unknown", "SIDE_UNKNOWN"},
		{"", "SIDE_UNKNOWN"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			assert.Equal(t, tt.expected, stringToSide(tt.input).String())
		})
	}
}

func TestProtobufWriterV1EmptyResult(t *testing.T) {
	w := &ProtobufWriterV1{}

	tmpDir := t.TempDir()

	result := &ParseResult{
		WorldName:      "EmptyWorld",
		MissionName:    "EmptyMission",
		FrameCount:     0,
		ChunkSize:      50,
		CaptureDelayMs: 1000,
	}

	ctx := context.Background()

	// Write manifest should succeed
	require.NoError(t, w.WriteManifest(ctx, tmpDir, result))

	// Write chunks should succeed (creates at least 1 chunk)
	require.NoError(t, w.WriteChunks(ctx, tmpDir, result))

	// Verify chunk was created
	chunksDir := tmpDir + "/chunks"
	entries, err := os.ReadDir(chunksDir)
	require.NoError(t, err, "read chunks directory")

	// Should have at least 1 chunk even with 0 frames
	assert.GreaterOrEqual(t, len(entries), 1)
}
