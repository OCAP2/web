package storage

import (
	"strings"
	"testing"
)

// mockParser is a test parser implementation
type mockParser struct {
	version JSONInputVersion
}

func (m *mockParser) Version() JSONInputVersion {
	return m.version
}

func (m *mockParser) Parse(data map[string]interface{}, chunkSize uint32) (*ParseResult, error) {
	return &ParseResult{
		WorldName:   "TestWorld",
		MissionName: "TestMission",
	}, nil
}

func TestRegisterAndGetParser(t *testing.T) {
	// Clear registry before test
	parsers = make(map[JSONInputVersion]Parser)

	// Create and register a mock parser
	mock := &mockParser{version: JSONInputVersionV1}
	RegisterParser(mock)

	// Test GetParser returns the registered parser
	p, err := GetParser(JSONInputVersionV1)
	if err != nil {
		t.Fatalf("GetParser returned error: %v", err)
	}
	if p == nil {
		t.Fatal("GetParser returned nil parser")
	}
	if p.Version() != JSONInputVersionV1 {
		t.Errorf("expected version %v, got %v", JSONInputVersionV1, p.Version())
	}

	// Verify the parser works
	result, err := p.Parse(nil, 100)
	if err != nil {
		t.Fatalf("Parse returned error: %v", err)
	}
	if result.WorldName != "TestWorld" {
		t.Errorf("expected WorldName 'TestWorld', got %q", result.WorldName)
	}
}

func TestGetParserUnknownVersion(t *testing.T) {
	// Clear registry before test
	parsers = make(map[JSONInputVersion]Parser)

	// Test GetParser returns error for unknown version
	p, err := GetParser(JSONInputVersionUnknown)
	if err == nil {
		t.Fatal("expected error for unknown version, got nil")
	}
	if p != nil {
		t.Fatal("expected nil parser for unknown version")
	}
	if !strings.Contains(err.Error(), "no parser for JSON version") {
		t.Errorf("unexpected error message: %v", err)
	}
}

func TestGetParserUnregisteredVersion(t *testing.T) {
	// Clear registry before test
	parsers = make(map[JSONInputVersion]Parser)

	// Test GetParser returns error for unregistered version
	p, err := GetParser(JSONInputVersionV1)
	if err == nil {
		t.Fatal("expected error for unregistered version, got nil")
	}
	if p != nil {
		t.Fatal("expected nil parser for unregistered version")
	}
}

func TestRegisterParserOverwrites(t *testing.T) {
	// Clear registry before test
	parsers = make(map[JSONInputVersion]Parser)

	// Register first parser
	mock1 := &mockParser{version: JSONInputVersionV1}
	RegisterParser(mock1)

	// Register second parser with same version
	mock2 := &mockParser{version: JSONInputVersionV1}
	RegisterParser(mock2)

	// Should get the second parser
	p, err := GetParser(JSONInputVersionV1)
	if err != nil {
		t.Fatalf("GetParser returned error: %v", err)
	}
	if p != mock2 {
		t.Error("expected second parser to overwrite first")
	}
}
