// internal/storage/parser_test.go
package storage

import (
	"testing"
)

func TestParserRegistry_Unknown(t *testing.T) {
	_, err := GetParser(JSONVersionUnknown)
	if err == nil {
		t.Error("expected error for unknown version")
	}
}

func TestParserRegistry(t *testing.T) {
	parser, err := GetParser(JSONVersionV1)
	if err != nil {
		t.Fatalf("GetParser(V1) error: %v", err)
	}
	if parser == nil {
		t.Fatal("parser is nil")
	}
}

func TestParserV1_Parse(t *testing.T) {
	data := map[string]interface{}{
		"worldName":    "Altis",
		"missionName":  "Test Mission",
		"endFrame":     10.0,
		"captureDelay": 1.0,
		"entities": []interface{}{
			map[string]interface{}{
				"id":            0.0,
				"type":          "unit",
				"name":          "Player1",
				"side":          "WEST",
				"group":         "Alpha",
				"role":          "Rifleman",
				"startFrameNum": 0.0,
				"isPlayer":      1.0,
				"positions": []interface{}{
					[]interface{}{[]interface{}{100.0, 200.0, 0.0}, 90.0, 1.0, 0.0, "Player1", 1.0},
				},
			},
		},
		"events": []interface{}{},
	}

	parser, err := GetParser(JSONVersionV1)
	if err != nil {
		t.Fatalf("GetParser error: %v", err)
	}

	result, err := parser.Parse(data, 300)
	if err != nil {
		t.Fatalf("Parse error: %v", err)
	}

	if result.Manifest.WorldName != "Altis" {
		t.Errorf("expected Altis, got %s", result.Manifest.WorldName)
	}
	if result.Manifest.Version != 1 {
		t.Errorf("expected version 1, got %d", result.Manifest.Version)
	}
	if len(result.Manifest.Entities) != 1 {
		t.Errorf("expected 1 entity, got %d", len(result.Manifest.Entities))
	}
	if len(result.EntityPositions) != 1 {
		t.Errorf("expected 1 position data, got %d", len(result.EntityPositions))
	}
}
