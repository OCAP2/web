package storage

import (
	"bytes"
	"context"
	"os"
	"strings"
	"testing"
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
	if err != nil {
		t.Fatalf("GetWriter returned error: %v", err)
	}
	if w == nil {
		t.Fatal("GetWriter returned nil writer")
	}
	if w.Version() != SchemaVersionV1 {
		t.Errorf("expected version %v, got %v", SchemaVersionV1, w.Version())
	}
	if w.Format() != "protobuf" {
		t.Errorf("expected format %q, got %q", "protobuf", w.Format())
	}
}

func TestGetWriterUnknownFormat(t *testing.T) {
	// Clear registry before test
	writers = make(map[string]Writer)

	// Register a protobuf writer
	mock := &mockWriter{version: SchemaVersionV1, format: "protobuf"}
	RegisterWriter(mock)

	// Test GetWriter returns error for unknown format
	w, err := GetWriter("unknown", SchemaVersionV1)
	if err == nil {
		t.Fatal("expected error for unknown format, got nil")
	}
	if w != nil {
		t.Fatal("expected nil writer for unknown format")
	}
	if !strings.Contains(err.Error(), "no writer for unknown version") {
		t.Errorf("unexpected error message: %v", err)
	}
}

func TestGetWriterUnknownVersion(t *testing.T) {
	// Clear registry before test
	writers = make(map[string]Writer)

	// Register a v1 protobuf writer
	mock := &mockWriter{version: SchemaVersionV1, format: "protobuf"}
	RegisterWriter(mock)

	// Test GetWriter returns error for unknown version
	w, err := GetWriter("protobuf", SchemaVersion(99))
	if err == nil {
		t.Fatal("expected error for unknown version, got nil")
	}
	if w != nil {
		t.Fatal("expected nil writer for unknown version")
	}
	if !strings.Contains(err.Error(), "no writer for protobuf version 99") {
		t.Errorf("unexpected error message: %v", err)
	}
}

func TestGetWriterUnregistered(t *testing.T) {
	// Clear registry before test
	writers = make(map[string]Writer)

	// Test GetWriter returns error when no writers registered
	w, err := GetWriter("protobuf", SchemaVersionV1)
	if err == nil {
		t.Fatal("expected error for unregistered writer, got nil")
	}
	if w != nil {
		t.Fatal("expected nil writer for unregistered writer")
	}
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
	if err != nil {
		t.Fatalf("GetWriter returned error: %v", err)
	}
	if w != mock2 {
		t.Error("expected second writer to overwrite first")
	}
}

func TestRegisterMultipleFormats(t *testing.T) {
	// Clear registry before test
	writers = make(map[string]Writer)

	// Register protobuf and flatbuffers writers
	protobufWriter := &mockWriter{version: SchemaVersionV1, format: "protobuf"}
	flatbuffersWriter := &mockWriter{version: SchemaVersionV1, format: "flatbuffers"}
	RegisterWriter(protobufWriter)
	RegisterWriter(flatbuffersWriter)

	// Get protobuf writer
	w, err := GetWriter("protobuf", SchemaVersionV1)
	if err != nil {
		t.Fatalf("GetWriter(protobuf) returned error: %v", err)
	}
	if w.Format() != "protobuf" {
		t.Errorf("expected protobuf format, got %q", w.Format())
	}

	// Get flatbuffers writer
	w, err = GetWriter("flatbuffers", SchemaVersionV1)
	if err != nil {
		t.Fatalf("GetWriter(flatbuffers) returned error: %v", err)
	}
	if w.Format() != "flatbuffers" {
		t.Errorf("expected flatbuffers format, got %q", w.Format())
	}
}

func TestWriteVersionPrefix(t *testing.T) {
	var buf bytes.Buffer

	err := WriteVersionPrefix(&buf, SchemaVersionV1)
	if err != nil {
		t.Fatalf("WriteVersionPrefix returned error: %v", err)
	}

	// Check the bytes are correct (little-endian uint32 = 1)
	expected := []byte{0x01, 0x00, 0x00, 0x00}
	if !bytes.Equal(buf.Bytes(), expected) {
		t.Errorf("WriteVersionPrefix wrote %v, want %v", buf.Bytes(), expected)
	}
}

func TestWriteVersionPrefixHigherVersion(t *testing.T) {
	var buf bytes.Buffer

	// Test with a higher version number (e.g., 256 = 0x100)
	err := WriteVersionPrefix(&buf, SchemaVersion(256))
	if err != nil {
		t.Fatalf("WriteVersionPrefix returned error: %v", err)
	}

	// Check the bytes are correct (little-endian uint32 = 256)
	expected := []byte{0x00, 0x01, 0x00, 0x00}
	if !bytes.Equal(buf.Bytes(), expected) {
		t.Errorf("WriteVersionPrefix wrote %v, want %v", buf.Bytes(), expected)
	}
}

func TestReadVersionPrefix(t *testing.T) {
	// Create a buffer with version 1 in little-endian
	data := []byte{0x01, 0x00, 0x00, 0x00}
	buf := bytes.NewReader(data)

	version, err := ReadVersionPrefix(buf)
	if err != nil {
		t.Fatalf("ReadVersionPrefix returned error: %v", err)
	}
	if version != SchemaVersionV1 {
		t.Errorf("ReadVersionPrefix = %v, want %v", version, SchemaVersionV1)
	}
}

func TestReadVersionPrefixHigherVersion(t *testing.T) {
	// Create a buffer with version 256 in little-endian
	data := []byte{0x00, 0x01, 0x00, 0x00}
	buf := bytes.NewReader(data)

	version, err := ReadVersionPrefix(buf)
	if err != nil {
		t.Fatalf("ReadVersionPrefix returned error: %v", err)
	}
	if version != SchemaVersion(256) {
		t.Errorf("ReadVersionPrefix = %v, want %v", version, SchemaVersion(256))
	}
}

func TestReadVersionPrefixTooShort(t *testing.T) {
	// Create a buffer with only 2 bytes
	data := []byte{0x01, 0x00}
	buf := bytes.NewReader(data)

	_, err := ReadVersionPrefix(buf)
	if err == nil {
		t.Fatal("expected error for too short data, got nil")
	}
}

func TestReadVersionPrefixEmpty(t *testing.T) {
	// Create an empty buffer
	buf := bytes.NewReader([]byte{})

	_, err := ReadVersionPrefix(buf)
	if err == nil {
		t.Fatal("expected error for empty data, got nil")
	}
}

func TestVersionPrefixRoundTrip(t *testing.T) {
	testCases := []SchemaVersion{
		SchemaVersionUnknown,
		SchemaVersionV1,
		SchemaVersion(2),
		SchemaVersion(100),
		SchemaVersion(65535),
		SchemaVersion(0xFFFFFFFF), // Max uint32
	}

	for _, version := range testCases {
		t.Run(version.String(), func(t *testing.T) {
			var buf bytes.Buffer

			// Write version
			err := WriteVersionPrefix(&buf, version)
			if err != nil {
				t.Fatalf("WriteVersionPrefix returned error: %v", err)
			}

			// Read it back
			readVersion, err := ReadVersionPrefix(bytes.NewReader(buf.Bytes()))
			if err != nil {
				t.Fatalf("ReadVersionPrefix returned error: %v", err)
			}

			if readVersion != version {
				t.Errorf("round-trip failed: wrote %v, read %v", version, readVersion)
			}
		})
	}
}

func TestVersionPrefixSize(t *testing.T) {
	var buf bytes.Buffer

	err := WriteVersionPrefix(&buf, SchemaVersionV1)
	if err != nil {
		t.Fatalf("WriteVersionPrefix returned error: %v", err)
	}

	// Version prefix should always be exactly 4 bytes
	if buf.Len() != 4 {
		t.Errorf("version prefix size = %d bytes, want 4 bytes", buf.Len())
	}
}

// ProtobufWriterV1 tests

func TestProtobufWriterV1Registration(t *testing.T) {
	// Clear registry and re-register
	writers = make(map[string]Writer)
	RegisterWriter(&ProtobufWriterV1{})

	// Test that the writer is registered
	w, err := GetWriter("protobuf", SchemaVersionV1)
	if err != nil {
		t.Fatalf("GetWriter returned error: %v", err)
	}
	if w == nil {
		t.Fatal("GetWriter returned nil writer")
	}

	// Verify it's the ProtobufWriterV1
	_, ok := w.(*ProtobufWriterV1)
	if !ok {
		t.Errorf("expected *ProtobufWriterV1, got %T", w)
	}
}

func TestProtobufWriterV1VersionAndFormat(t *testing.T) {
	w := &ProtobufWriterV1{}

	if w.Version() != SchemaVersionV1 {
		t.Errorf("Version() = %v, want %v", w.Version(), SchemaVersionV1)
	}

	if w.Format() != "protobuf" {
		t.Errorf("Format() = %q, want %q", w.Format(), "protobuf")
	}
}

func TestProtobufWriterV1WriteManifest(t *testing.T) {
	w := &ProtobufWriterV1{}

	// Create a temp directory
	tmpDir := t.TempDir()

	// Create test ParseResult
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

	// Write manifest
	ctx := context.Background()
	err := w.WriteManifest(ctx, tmpDir, result)
	if err != nil {
		t.Fatalf("WriteManifest returned error: %v", err)
	}

	// Verify file was created
	manifestPath := tmpDir + "/manifest.pb"
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatalf("failed to read manifest file: %v", err)
	}

	// Check version prefix (first 4 bytes)
	if len(data) < 4 {
		t.Fatalf("manifest file too short: %d bytes", len(data))
	}
	version, err := ReadVersionPrefix(bytes.NewReader(data[:4]))
	if err != nil {
		t.Fatalf("ReadVersionPrefix returned error: %v", err)
	}
	if version != SchemaVersionV1 {
		t.Errorf("version prefix = %v, want %v", version, SchemaVersionV1)
	}

	// Verify protobuf data can be parsed
	manifestData := data[4:]
	if len(manifestData) == 0 {
		t.Fatal("manifest protobuf data is empty")
	}
}

func TestProtobufWriterV1WriteChunks(t *testing.T) {
	w := &ProtobufWriterV1{}

	// Create a temp directory
	tmpDir := t.TempDir()

	// Create test ParseResult with position data
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

	// Write chunks
	ctx := context.Background()
	err := w.WriteChunks(ctx, tmpDir, result)
	if err != nil {
		t.Fatalf("WriteChunks returned error: %v", err)
	}

	// Verify chunks directory was created
	chunksDir := tmpDir + "/chunks"
	entries, err := os.ReadDir(chunksDir)
	if err != nil {
		t.Fatalf("failed to read chunks directory: %v", err)
	}

	// Should have 2 chunks (100 frames / 50 chunk size = 2)
	if len(entries) != 2 {
		t.Errorf("expected 2 chunk files, got %d", len(entries))
	}

	// Verify first chunk file
	chunkPath := chunksDir + "/0000.pb"
	data, err := os.ReadFile(chunkPath)
	if err != nil {
		t.Fatalf("failed to read chunk file: %v", err)
	}

	// Check version prefix
	if len(data) < 4 {
		t.Fatalf("chunk file too short: %d bytes", len(data))
	}
	version, err := ReadVersionPrefix(bytes.NewReader(data[:4]))
	if err != nil {
		t.Fatalf("ReadVersionPrefix returned error: %v", err)
	}
	if version != SchemaVersionV1 {
		t.Errorf("version prefix = %v, want %v", version, SchemaVersionV1)
	}
}

func TestProtobufWriterV1WriteChunksCancellation(t *testing.T) {
	w := &ProtobufWriterV1{}

	// Create a temp directory
	tmpDir := t.TempDir()

	// Create test ParseResult with many frames
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
	if err == nil {
		t.Fatal("expected error for cancelled context, got nil")
	}
	if err != context.Canceled {
		t.Errorf("expected context.Canceled error, got: %v", err)
	}
}

func TestProtobufWriterV1StringToEntityType(t *testing.T) {
	w := &ProtobufWriterV1{}

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
			result := w.stringToEntityType(tt.input)
			if result.String() != tt.expected {
				t.Errorf("stringToEntityType(%q) = %v, want %v", tt.input, result, tt.expected)
			}
		})
	}
}

func TestProtobufWriterV1StringToSide(t *testing.T) {
	w := &ProtobufWriterV1{}

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
			result := w.stringToSide(tt.input)
			if result.String() != tt.expected {
				t.Errorf("stringToSide(%q) = %v, want %v", tt.input, result, tt.expected)
			}
		})
	}
}

func TestProtobufWriterV1EmptyResult(t *testing.T) {
	w := &ProtobufWriterV1{}

	// Create a temp directory
	tmpDir := t.TempDir()

	// Create minimal ParseResult
	result := &ParseResult{
		WorldName:      "EmptyWorld",
		MissionName:    "EmptyMission",
		FrameCount:     0,
		ChunkSize:      50,
		CaptureDelayMs: 1000,
	}

	ctx := context.Background()

	// Write manifest should succeed
	err := w.WriteManifest(ctx, tmpDir, result)
	if err != nil {
		t.Fatalf("WriteManifest returned error: %v", err)
	}

	// Write chunks should succeed (creates at least 1 chunk)
	err = w.WriteChunks(ctx, tmpDir, result)
	if err != nil {
		t.Fatalf("WriteChunks returned error: %v", err)
	}

	// Verify chunk was created
	chunksDir := tmpDir + "/chunks"
	entries, err := os.ReadDir(chunksDir)
	if err != nil {
		t.Fatalf("failed to read chunks directory: %v", err)
	}

	// Should have at least 1 chunk even with 0 frames
	if len(entries) < 1 {
		t.Errorf("expected at least 1 chunk file, got %d", len(entries))
	}
}

// FlatBuffersWriterV1 tests

func TestFlatBuffersWriterV1Registration(t *testing.T) {
	// Clear registry and re-register
	writers = make(map[string]Writer)
	RegisterWriter(&FlatBuffersWriterV1{})

	// Test that the writer is registered
	w, err := GetWriter("flatbuffers", SchemaVersionV1)
	if err != nil {
		t.Fatalf("GetWriter returned error: %v", err)
	}
	if w == nil {
		t.Fatal("GetWriter returned nil writer")
	}

	// Verify it's the FlatBuffersWriterV1
	_, ok := w.(*FlatBuffersWriterV1)
	if !ok {
		t.Errorf("expected *FlatBuffersWriterV1, got %T", w)
	}
}

func TestFlatBuffersWriterV1VersionAndFormat(t *testing.T) {
	w := &FlatBuffersWriterV1{}

	if w.Version() != SchemaVersionV1 {
		t.Errorf("Version() = %v, want %v", w.Version(), SchemaVersionV1)
	}

	if w.Format() != "flatbuffers" {
		t.Errorf("Format() = %q, want %q", w.Format(), "flatbuffers")
	}
}

func TestFlatBuffersWriterV1WriteManifest(t *testing.T) {
	w := &FlatBuffersWriterV1{}

	// Create a temp directory
	tmpDir := t.TempDir()

	// Create test ParseResult
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

	// Write manifest
	ctx := context.Background()
	err := w.WriteManifest(ctx, tmpDir, result)
	if err != nil {
		t.Fatalf("WriteManifest returned error: %v", err)
	}

	// Verify file was created
	manifestPath := tmpDir + "/manifest.fb"
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatalf("failed to read manifest file: %v", err)
	}

	// Check version prefix (first 4 bytes)
	if len(data) < 4 {
		t.Fatalf("manifest file too short: %d bytes", len(data))
	}
	version, err := ReadVersionPrefix(bytes.NewReader(data[:4]))
	if err != nil {
		t.Fatalf("ReadVersionPrefix returned error: %v", err)
	}
	if version != SchemaVersionV1 {
		t.Errorf("version prefix = %v, want %v", version, SchemaVersionV1)
	}

	// Verify FlatBuffer data can be parsed (just check it's not empty)
	fbData := data[4:]
	if len(fbData) == 0 {
		t.Fatal("manifest FlatBuffer data is empty")
	}
}

func TestFlatBuffersWriterV1WriteChunks(t *testing.T) {
	w := &FlatBuffersWriterV1{}

	// Create a temp directory
	tmpDir := t.TempDir()

	// Create test ParseResult with position data
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

	// Write chunks
	ctx := context.Background()
	err := w.WriteChunks(ctx, tmpDir, result)
	if err != nil {
		t.Fatalf("WriteChunks returned error: %v", err)
	}

	// Verify chunks directory was created
	chunksDir := tmpDir + "/chunks"
	entries, err := os.ReadDir(chunksDir)
	if err != nil {
		t.Fatalf("failed to read chunks directory: %v", err)
	}

	// Should have 2 chunks (100 frames / 50 chunk size = 2)
	if len(entries) != 2 {
		t.Errorf("expected 2 chunk files, got %d", len(entries))
	}

	// Verify first chunk file
	chunkPath := chunksDir + "/0000.fb"
	data, err := os.ReadFile(chunkPath)
	if err != nil {
		t.Fatalf("failed to read chunk file: %v", err)
	}

	// Check version prefix
	if len(data) < 4 {
		t.Fatalf("chunk file too short: %d bytes", len(data))
	}
	version, err := ReadVersionPrefix(bytes.NewReader(data[:4]))
	if err != nil {
		t.Fatalf("ReadVersionPrefix returned error: %v", err)
	}
	if version != SchemaVersionV1 {
		t.Errorf("version prefix = %v, want %v", version, SchemaVersionV1)
	}
}

func TestFlatBuffersWriterV1WriteChunksCancellation(t *testing.T) {
	w := &FlatBuffersWriterV1{}

	// Create a temp directory
	tmpDir := t.TempDir()

	// Create test ParseResult with many frames
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
	if err == nil {
		t.Fatal("expected error for cancelled context, got nil")
	}
	if err != context.Canceled {
		t.Errorf("expected context.Canceled error, got: %v", err)
	}
}

func TestFlatBuffersWriterV1StringToEntityType(t *testing.T) {
	w := &FlatBuffersWriterV1{}

	tests := []struct {
		input    string
		expected string
	}{
		{"unit", "Unit"},
		{"Unit", "Unit"},
		{"UNIT", "Unit"},
		{"vehicle", "Vehicle"},
		{"Vehicle", "Vehicle"},
		{"VEHICLE", "Vehicle"},
		{"unknown", "Unknown"},
		{"", "Unknown"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := w.stringToFBEntityType(tt.input)
			if result.String() != tt.expected {
				t.Errorf("stringToFBEntityType(%q) = %v, want %v", tt.input, result, tt.expected)
			}
		})
	}
}

func TestFlatBuffersWriterV1StringToSide(t *testing.T) {
	w := &FlatBuffersWriterV1{}

	tests := []struct {
		input    string
		expected string
	}{
		{"WEST", "West"},
		{"west", "West"},
		{"West", "West"},
		{"EAST", "East"},
		{"east", "East"},
		{"GUER", "Guer"},
		{"INDEPENDENT", "Guer"},
		{"CIV", "Civ"},
		{"CIVILIAN", "Civ"},
		{"GLOBAL", "Global"},
		{"unknown", "Unknown"},
		{"", "Unknown"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			result := w.stringToFBSide(tt.input)
			if result.String() != tt.expected {
				t.Errorf("stringToFBSide(%q) = %v, want %v", tt.input, result, tt.expected)
			}
		})
	}
}

func TestFlatBuffersWriterV1EmptyResult(t *testing.T) {
	w := &FlatBuffersWriterV1{}

	// Create a temp directory
	tmpDir := t.TempDir()

	// Create minimal ParseResult
	result := &ParseResult{
		WorldName:      "EmptyWorld",
		MissionName:    "EmptyMission",
		FrameCount:     0,
		ChunkSize:      50,
		CaptureDelayMs: 1000,
	}

	ctx := context.Background()

	// Write manifest should succeed
	err := w.WriteManifest(ctx, tmpDir, result)
	if err != nil {
		t.Fatalf("WriteManifest returned error: %v", err)
	}

	// Write chunks should succeed (creates at least 1 chunk)
	err = w.WriteChunks(ctx, tmpDir, result)
	if err != nil {
		t.Fatalf("WriteChunks returned error: %v", err)
	}

	// Verify chunk was created
	chunksDir := tmpDir + "/chunks"
	entries, err := os.ReadDir(chunksDir)
	if err != nil {
		t.Fatalf("failed to read chunks directory: %v", err)
	}

	// Should have at least 1 chunk even with 0 frames
	if len(entries) < 1 {
		t.Errorf("expected at least 1 chunk file, got %d", len(entries))
	}
}

func TestFlatBuffersWriterV1MarkerWithSize(t *testing.T) {
	w := &FlatBuffersWriterV1{}

	// Create a temp directory
	tmpDir := t.TempDir()

	// Create test ParseResult with marker that has size
	result := &ParseResult{
		WorldName:      "TestWorld",
		MissionName:    "TestMission",
		FrameCount:     100,
		ChunkSize:      50,
		CaptureDelayMs: 1000,
		Markers: []MarkerDef{
			{
				Type:       "rectangle",
				Text:       "Area",
				StartFrame: 0,
				EndFrame:   100,
				PlayerID:   -1,
				Color:      "blue",
				Side:       "WEST",
				Size:       []float32{100.0, 200.0},
				Shape:      "RECTANGLE",
				Brush:      "Solid",
				Positions: []MarkerPosition{
					{FrameNum: 0, PosX: 100.0, PosY: 200.0, PosZ: 0.0, Direction: 45.0, Alpha: 0.5},
				},
			},
		},
	}

	// Write manifest
	ctx := context.Background()
	err := w.WriteManifest(ctx, tmpDir, result)
	if err != nil {
		t.Fatalf("WriteManifest returned error: %v", err)
	}

	// Verify file was created
	manifestPath := tmpDir + "/manifest.fb"
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatalf("failed to read manifest file: %v", err)
	}

	// Check version prefix (first 4 bytes)
	if len(data) < 4 {
		t.Fatalf("manifest file too short: %d bytes", len(data))
	}
	version, err := ReadVersionPrefix(bytes.NewReader(data[:4]))
	if err != nil {
		t.Fatalf("ReadVersionPrefix returned error: %v", err)
	}
	if version != SchemaVersionV1 {
		t.Errorf("version prefix = %v, want %v", version, SchemaVersionV1)
	}
}
