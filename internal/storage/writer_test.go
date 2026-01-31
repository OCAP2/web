package storage

import (
	"bytes"
	"context"
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
