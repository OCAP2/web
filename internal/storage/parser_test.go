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

// ParserV1 Tests

func TestParserV1_Version(t *testing.T) {
	p := &ParserV1{}
	if p.Version() != JSONInputVersionV1 {
		t.Errorf("Version() = %v, want %v", p.Version(), JSONInputVersionV1)
	}
}

func TestParserV1_Parse_MinimalData(t *testing.T) {
	p := &ParserV1{}
	data := map[string]interface{}{
		"worldName":    "Altis",
		"missionName":  "Test Mission",
		"endFrame":     100.0,
		"captureDelay": 1.5,
		"entities":     []interface{}{},
	}

	result, err := p.Parse(data, 50)
	if err != nil {
		t.Fatalf("Parse returned error: %v", err)
	}

	if result.WorldName != "Altis" {
		t.Errorf("WorldName = %q, want %q", result.WorldName, "Altis")
	}
	if result.MissionName != "Test Mission" {
		t.Errorf("MissionName = %q, want %q", result.MissionName, "Test Mission")
	}
	if result.FrameCount != 100 {
		t.Errorf("FrameCount = %d, want %d", result.FrameCount, 100)
	}
	if result.ChunkSize != 50 {
		t.Errorf("ChunkSize = %d, want %d", result.ChunkSize, 50)
	}
	if result.CaptureDelayMs != 1500 {
		t.Errorf("CaptureDelayMs = %d, want %d", result.CaptureDelayMs, 1500)
	}
}

func TestParserV1_Parse_EdgeCases(t *testing.T) {
	p := &ParserV1{}

	t.Run("invalid entity type in array (not a map)", func(t *testing.T) {
		data := map[string]interface{}{
			"worldName":    "Altis",
			"missionName":  "Test",
			"endFrame":     10.0,
			"captureDelay": 1.0,
			"entities": []interface{}{
				"not a map",                        // Invalid - should be skipped
				[]interface{}{"also not a map"},    // Invalid - should be skipped
				map[string]interface{}{"id": 0.0, "type": "unit", "name": "Valid"}, // Valid
			},
		}
		result, err := p.Parse(data, 100)
		if err != nil {
			t.Fatalf("Parse returned error: %v", err)
		}
		if len(result.Entities) != 1 {
			t.Errorf("len(Entities) = %d, want %d (invalid entries skipped)", len(result.Entities), 1)
		}
	})

	t.Run("invalid event type in array (not an array)", func(t *testing.T) {
		data := map[string]interface{}{
			"worldName":    "Altis",
			"missionName":  "Test",
			"endFrame":     10.0,
			"captureDelay": 1.0,
			"entities":     []interface{}{},
			"events": []interface{}{
				"not an array",                         // Invalid - should be skipped
				map[string]interface{}{"frame": 0.0},   // Invalid - should be skipped
				[]interface{}{0.0},                     // Too short - should be skipped
				[]interface{}{0.0, "valid"},            // Valid
			},
		}
		result, err := p.Parse(data, 100)
		if err != nil {
			t.Fatalf("Parse returned error: %v", err)
		}
		if len(result.Events) != 1 {
			t.Errorf("len(Events) = %d, want %d (invalid entries skipped)", len(result.Events), 1)
		}
	})

	t.Run("invalid marker type in array (not an array)", func(t *testing.T) {
		data := map[string]interface{}{
			"worldName":    "Altis",
			"missionName":  "Test",
			"endFrame":     10.0,
			"captureDelay": 1.0,
			"entities":     []interface{}{},
			"Markers": []interface{}{
				"not an array",                         // Invalid - should be skipped
				map[string]interface{}{"type": "ICON"}, // Invalid - should be skipped
				[]interface{}{"ICON", "text", 0.0, 10.0, 0.0, "color", 0.0}, // Valid
			},
		}
		result, err := p.Parse(data, 100)
		if err != nil {
			t.Fatalf("Parse returned error: %v", err)
		}
		if len(result.Markers) != 1 {
			t.Errorf("len(Markers) = %d, want %d (invalid entries skipped)", len(result.Markers), 1)
		}
	})

	t.Run("invalid time entry type (not a map)", func(t *testing.T) {
		data := map[string]interface{}{
			"worldName":    "Altis",
			"missionName":  "Test",
			"endFrame":     10.0,
			"captureDelay": 1.0,
			"entities":     []interface{}{},
			"times": []interface{}{
				"not a map",              // Invalid - should be skipped
				[]interface{}{0.0, 1.0},  // Invalid - should be skipped
				map[string]interface{}{"frameNum": 0.0, "time": 100.0}, // Valid
			},
		}
		result, err := p.Parse(data, 100)
		if err != nil {
			t.Fatalf("Parse returned error: %v", err)
		}
		if len(result.Times) != 1 {
			t.Errorf("len(Times) = %d, want %d (invalid entries skipped)", len(result.Times), 1)
		}
	})

	t.Run("entity with nil position data", func(t *testing.T) {
		data := map[string]interface{}{
			"worldName":    "Altis",
			"missionName":  "Test",
			"endFrame":     10.0,
			"captureDelay": 1.0,
			"entities": []interface{}{
				map[string]interface{}{
					"id":   0.0,
					"type": "unit",
					"name": "NoPositions",
					// No positions key
				},
			},
		}
		result, err := p.Parse(data, 100)
		if err != nil {
			t.Fatalf("Parse returned error: %v", err)
		}
		if len(result.Entities) != 1 {
			t.Errorf("len(Entities) = %d, want %d", len(result.Entities), 1)
		}
		if len(result.EntityPositions) != 0 {
			t.Errorf("len(EntityPositions) = %d, want %d (nil positions)", len(result.EntityPositions), 0)
		}
	})
}

func TestParserV1_Parse_Entities(t *testing.T) {
	p := &ParserV1{}
	data := map[string]interface{}{
		"worldName":    "Altis",
		"missionName":  "Test",
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
					[]interface{}{[]interface{}{101.0, 201.0, 0.0}, 91.0, 1.0, 0.0, "Player1", 1.0},
				},
			},
			map[string]interface{}{
				"id":            1.0,
				"type":          "vehicle",
				"name":          "Truck",
				"class":         "B_Truck_01",
				"startFrameNum": 0.0,
				"positions": []interface{}{
					[]interface{}{[]interface{}{500.0, 600.0, 0.0}, 180.0, 1.0, []interface{}{0.0}},
				},
			},
		},
	}

	result, err := p.Parse(data, 100)
	if err != nil {
		t.Fatalf("Parse returned error: %v", err)
	}

	// Verify entities
	if len(result.Entities) != 2 {
		t.Fatalf("len(Entities) = %d, want %d", len(result.Entities), 2)
	}

	// First entity (unit)
	ent := result.Entities[0]
	if ent.ID != 0 {
		t.Errorf("Entity[0].ID = %d, want %d", ent.ID, 0)
	}
	if ent.Type != "unit" {
		t.Errorf("Entity[0].Type = %q, want %q", ent.Type, "unit")
	}
	if ent.Name != "Player1" {
		t.Errorf("Entity[0].Name = %q, want %q", ent.Name, "Player1")
	}
	if ent.Side != "WEST" {
		t.Errorf("Entity[0].Side = %q, want %q", ent.Side, "WEST")
	}
	if ent.Group != "Alpha" {
		t.Errorf("Entity[0].Group = %q, want %q", ent.Group, "Alpha")
	}
	if !ent.IsPlayer {
		t.Errorf("Entity[0].IsPlayer = %v, want %v", ent.IsPlayer, true)
	}
	if ent.StartFrame != 0 {
		t.Errorf("Entity[0].StartFrame = %d, want %d", ent.StartFrame, 0)
	}
	if ent.EndFrame != 1 { // startFrame + len(positions) - 1 = 0 + 2 - 1 = 1
		t.Errorf("Entity[0].EndFrame = %d, want %d", ent.EndFrame, 1)
	}

	// Second entity (vehicle)
	ent = result.Entities[1]
	if ent.Type != "vehicle" {
		t.Errorf("Entity[1].Type = %q, want %q", ent.Type, "vehicle")
	}
	if ent.VehicleClass != "B_Truck_01" {
		t.Errorf("Entity[1].VehicleClass = %q, want %q", ent.VehicleClass, "B_Truck_01")
	}
}

func TestParserV1_Parse_Events(t *testing.T) {
	p := &ParserV1{}
	data := map[string]interface{}{
		"worldName":    "Altis",
		"missionName":  "Test",
		"endFrame":     10.0,
		"captureDelay": 1.0,
		"entities":     []interface{}{},
		"events": []interface{}{
			[]interface{}{8.0, "killed", 0.0, 1.0, "arifle_MX", 150.0},
			[]interface{}{5.0, "hit", 0.0, 1.0, "pistol"},
			[]interface{}{3.0, "chat", 0.0, 0.0, "Hello world"},
		},
	}

	result, err := p.Parse(data, 100)
	if err != nil {
		t.Fatalf("Parse returned error: %v", err)
	}

	if len(result.Events) != 3 {
		t.Fatalf("len(Events) = %d, want %d", len(result.Events), 3)
	}

	// Killed event
	evt := result.Events[0]
	if evt.FrameNum != 8 {
		t.Errorf("Event[0].FrameNum = %d, want %d", evt.FrameNum, 8)
	}
	if evt.Type != "killed" {
		t.Errorf("Event[0].Type = %q, want %q", evt.Type, "killed")
	}
	if evt.SourceID != 0 {
		t.Errorf("Event[0].SourceID = %d, want %d", evt.SourceID, 0)
	}
	if evt.TargetID != 1 {
		t.Errorf("Event[0].TargetID = %d, want %d", evt.TargetID, 1)
	}
	if evt.Weapon != "arifle_MX" {
		t.Errorf("Event[0].Weapon = %q, want %q", evt.Weapon, "arifle_MX")
	}
	if evt.Distance != 150.0 {
		t.Errorf("Event[0].Distance = %v, want %v", evt.Distance, 150.0)
	}

	// Hit event
	evt = result.Events[1]
	if evt.Type != "hit" {
		t.Errorf("Event[1].Type = %q, want %q", evt.Type, "hit")
	}
	if evt.Weapon != "pistol" {
		t.Errorf("Event[1].Weapon = %q, want %q", evt.Weapon, "pistol")
	}

	// Chat event
	evt = result.Events[2]
	if evt.Type != "chat" {
		t.Errorf("Event[2].Type = %q, want %q", evt.Type, "chat")
	}
	if evt.Message != "Hello world" {
		t.Errorf("Event[2].Message = %q, want %q", evt.Message, "Hello world")
	}
}

func TestParserV1_Parse_Markers(t *testing.T) {
	p := &ParserV1{}
	data := map[string]interface{}{
		"worldName":    "Altis",
		"missionName":  "Test",
		"endFrame":     10.0,
		"captureDelay": 1.0,
		"entities":     []interface{}{},
		"Markers": []interface{}{
			[]interface{}{
				"ICON",                                           // type
				"Alpha",                                          // text
				0.0,                                               // startFrame
				10.0,                                              // endFrame
				0.0,                                               // playerId
				"ColorBlufor",                                     // color
				1.0,                                               // sideIndex (1 = WEST per BIS_fnc_sideID)
				[]interface{}{[]interface{}{100.0, 200.0, 0.0}},   // positions
				[]interface{}{1.0, 1.0},                           // size
				"ICON",                                            // shape
				"Solid",                                           // brush
			},
		},
	}

	result, err := p.Parse(data, 100)
	if err != nil {
		t.Fatalf("Parse returned error: %v", err)
	}

	if len(result.Markers) != 1 {
		t.Fatalf("len(Markers) = %d, want %d", len(result.Markers), 1)
	}

	m := result.Markers[0]
	if m.Type != "ICON" {
		t.Errorf("Marker.Type = %q, want %q", m.Type, "ICON")
	}
	if m.Text != "Alpha" {
		t.Errorf("Marker.Text = %q, want %q", m.Text, "Alpha")
	}
	if m.StartFrame != 0 {
		t.Errorf("Marker.StartFrame = %d, want %d", m.StartFrame, 0)
	}
	if m.EndFrame != 10 {
		t.Errorf("Marker.EndFrame = %d, want %d", m.EndFrame, 10)
	}
	if m.Color != "ColorBlufor" {
		t.Errorf("Marker.Color = %q, want %q", m.Color, "ColorBlufor")
	}
	if m.Side != "WEST" {
		t.Errorf("Marker.Side = %q, want %q", m.Side, "WEST")
	}
	if m.Shape != "ICON" {
		t.Errorf("Marker.Shape = %q, want %q", m.Shape, "ICON")
	}
	if m.Brush != "Solid" {
		t.Errorf("Marker.Brush = %q, want %q", m.Brush, "Solid")
	}
	if len(m.Size) != 2 {
		t.Errorf("len(Marker.Size) = %d, want %d", len(m.Size), 2)
	}
	if len(m.Positions) != 1 {
		t.Errorf("len(Marker.Positions) = %d, want %d", len(m.Positions), 1)
	}
	if len(m.Positions) > 0 {
		pos := m.Positions[0]
		if pos.PosX != 100.0 {
			t.Errorf("Marker.Positions[0].PosX = %v, want %v", pos.PosX, 100.0)
		}
		if pos.PosY != 200.0 {
			t.Errorf("Marker.Positions[0].PosY = %v, want %v", pos.PosY, 200.0)
		}
	}
}

func TestParserV1_Parse_Markers_OldExtensionFormat(t *testing.T) {
	p := &ParserV1{}
	data := map[string]interface{}{
		"worldName":    "Altis",
		"missionName":  "Test",
		"endFrame":     100.0,
		"captureDelay": 1.0,
		"entities":     []interface{}{},
		"Markers": []interface{}{
			[]interface{}{
				"o_inf",                                         // type (old extension marker type)
				"Enemy Squad",                                   // text
				0.0,                                             // startFrame
				-1.0,                                            // endFrame (-1 = not deleted, converted to frame count)
				5.0,                                             // playerId
				"0000FF",                                        // color (hex without #)
				0.0,                                             // sideIndex (0 = EAST per BIS_fnc_sideID)
				[]interface{}{                                   // positions in old extension format
					[]interface{}{0.0, []interface{}{3915.44, 1971.98}, 180.0},       // [frameNum, [x,y], dir]
					[]interface{}{50.0, []interface{}{3882.53, 2041.32}, 270.0, 100.0}, // [frameNum, [x,y], dir, alpha]
				},
				[]interface{}{1.0, 1.0}, // size
				"ICON",                  // shape
				"Solid",                 // brush
			},
		},
	}

	result, err := p.Parse(data, 100)
	if err != nil {
		t.Fatalf("Parse returned error: %v", err)
	}

	if len(result.Markers) != 1 {
		t.Fatalf("len(Markers) = %d, want %d", len(result.Markers), 1)
	}

	m := result.Markers[0]
	if m.Type != "o_inf" {
		t.Errorf("Marker.Type = %q, want %q", m.Type, "o_inf")
	}
	if m.Side != "EAST" {
		t.Errorf("Marker.Side = %q, want %q (sideIndex 0 = EAST)", m.Side, "EAST")
	}
	if m.Color != "0000FF" {
		t.Errorf("Marker.Color = %q, want %q", m.Color, "0000FF")
	}

	if len(m.Positions) != 2 {
		t.Fatalf("len(Marker.Positions) = %d, want %d", len(m.Positions), 2)
	}

	// Check first position
	pos1 := m.Positions[0]
	if pos1.FrameNum != 0 {
		t.Errorf("Positions[0].FrameNum = %d, want %d", pos1.FrameNum, 0)
	}
	if pos1.PosX != 3915.44 {
		t.Errorf("Positions[0].PosX = %v, want %v", pos1.PosX, 3915.44)
	}
	if pos1.PosY != 1971.98 {
		t.Errorf("Positions[0].PosY = %v, want %v", pos1.PosY, 1971.98)
	}
	if pos1.Direction != 180.0 {
		t.Errorf("Positions[0].Direction = %v, want %v", pos1.Direction, 180.0)
	}

	// Check second position with alpha
	pos2 := m.Positions[1]
	if pos2.FrameNum != 50 {
		t.Errorf("Positions[1].FrameNum = %d, want %d", pos2.FrameNum, 50)
	}
	if pos2.Alpha != 100.0 {
		t.Errorf("Positions[1].Alpha = %v, want %v", pos2.Alpha, 100.0)
	}
}

func TestParserV1_Parse_Events_OldExtensionFormat(t *testing.T) {
	p := &ParserV1{}
	data := map[string]interface{}{
		"worldName":    "Altis",
		"missionName":  "Test",
		"endFrame":     100.0,
		"captureDelay": 1.0,
		"entities":     []interface{}{},
		"events": []interface{}{
			// Old extension killed event format
			[]interface{}{404.0, "killed", 84.0, []interface{}{83.0, "AKS-74N"}, 10.0},
			// Old extension hit event format
			[]interface{}{3652.0, "killed", 160.0, []interface{}{83.0, "PKP Pecheneg"}, 80.0},
			// Connected event (same format)
			[]interface{}{0.0, "connected", "[RMC] DoS"},
			// Disconnected event
			[]interface{}{3312.0, "disconnected", "[VRG] mEss1a"},
		},
	}

	result, err := p.Parse(data, 100)
	if err != nil {
		t.Fatalf("Parse returned error: %v", err)
	}

	if len(result.Events) != 4 {
		t.Fatalf("len(Events) = %d, want %d", len(result.Events), 4)
	}

	// Check first killed event
	evt := result.Events[0]
	if evt.Type != "killed" {
		t.Errorf("Event[0].Type = %q, want %q", evt.Type, "killed")
	}
	if evt.TargetID != 84 {
		t.Errorf("Event[0].TargetID = %d, want %d (victimId)", evt.TargetID, 84)
	}
	if evt.SourceID != 83 {
		t.Errorf("Event[0].SourceID = %d, want %d (killerId)", evt.SourceID, 83)
	}
	if evt.Weapon != "AKS-74N" {
		t.Errorf("Event[0].Weapon = %q, want %q", evt.Weapon, "AKS-74N")
	}
	if evt.Distance != 10.0 {
		t.Errorf("Event[0].Distance = %v, want %v", evt.Distance, 10.0)
	}

	// Check connected event
	evt = result.Events[2]
	if evt.Type != "connected" {
		t.Errorf("Event[2].Type = %q, want %q", evt.Type, "connected")
	}
	if evt.Message != "[RMC] DoS" {
		t.Errorf("Event[2].Message = %q, want %q", evt.Message, "[RMC] DoS")
	}
}

func TestParserV1_Parse_Times(t *testing.T) {
	p := &ParserV1{}
	data := map[string]interface{}{
		"worldName":    "Altis",
		"missionName":  "Test",
		"endFrame":     10.0,
		"captureDelay": 1.0,
		"entities":     []interface{}{},
		"times": []interface{}{
			map[string]interface{}{
				"frameNum":       0.0,
				"systemTimeUTC":  "2035-06-10T10:00:00",
				"date":           "2035-06-10",
				"time":           36000.0,
				"timeMultiplier": 1.0,
			},
		},
	}

	result, err := p.Parse(data, 100)
	if err != nil {
		t.Fatalf("Parse returned error: %v", err)
	}

	if len(result.Times) != 1 {
		t.Fatalf("len(Times) = %d, want %d", len(result.Times), 1)
	}

	ts := result.Times[0]
	if ts.FrameNum != 0 {
		t.Errorf("Time.FrameNum = %d, want %d", ts.FrameNum, 0)
	}
	if ts.SystemTimeUTC != "2035-06-10T10:00:00" {
		t.Errorf("Time.SystemTimeUTC = %q, want %q", ts.SystemTimeUTC, "2035-06-10T10:00:00")
	}
	if ts.Date != "2035-06-10" {
		t.Errorf("Time.Date = %q, want %q", ts.Date, "2035-06-10")
	}
	if ts.Time != 36000.0 {
		t.Errorf("Time.Time = %v, want %v", ts.Time, 36000.0)
	}
	if ts.TimeMultiplier != 1.0 {
		t.Errorf("Time.TimeMultiplier = %v, want %v", ts.TimeMultiplier, 1.0)
	}
}

func TestParserV1_Parse_EntityPositions(t *testing.T) {
	p := &ParserV1{}
	data := map[string]interface{}{
		"worldName":    "Altis",
		"missionName":  "Test",
		"endFrame":     5.0,
		"captureDelay": 1.0,
		"entities": []interface{}{
			map[string]interface{}{
				"id":            0.0,
				"type":          "unit",
				"name":          "Player1",
				"side":          "WEST",
				"startFrameNum": 0.0,
				"isPlayer":      1.0,
				"positions": []interface{}{
					[]interface{}{[]interface{}{100.0, 200.0, 0.0}, 90.0, 1.0, 0.0, "Player1", 1.0},
					[]interface{}{[]interface{}{101.0, 201.0, 0.0}, 91.0, 1.0, 5.0, "Player1", 1.0}, // In vehicle ID 5
					[]interface{}{[]interface{}{102.0, 202.0, 0.0}, 92.0, 0.0, 0.0, "Player1", 1.0}, // Dead
				},
			},
			map[string]interface{}{
				"id":            1.0,
				"type":          "vehicle",
				"name":          "Truck",
				"class":         "B_Truck_01",
				"startFrameNum": 0.0,
				"positions": []interface{}{
					[]interface{}{[]interface{}{500.0, 600.0, 0.0}, 180.0, 1.0, []interface{}{}},
					[]interface{}{[]interface{}{510.0, 610.0, 0.0}, 185.0, 1.0, []interface{}{0.0}}, // With crew
					[]interface{}{[]interface{}{520.0, 620.0, 0.0}, 190.0, 1.0, []interface{}{}},
				},
			},
		},
	}

	result, err := p.Parse(data, 100)
	if err != nil {
		t.Fatalf("Parse returned error: %v", err)
	}

	if len(result.EntityPositions) != 2 {
		t.Fatalf("len(EntityPositions) = %d, want %d", len(result.EntityPositions), 2)
	}

	// Unit positions
	unitPos := result.EntityPositions[0]
	if unitPos.EntityID != 0 {
		t.Errorf("EntityPositions[0].EntityID = %d, want %d", unitPos.EntityID, 0)
	}
	if len(unitPos.Positions) != 3 {
		t.Fatalf("len(EntityPositions[0].Positions) = %d, want %d", len(unitPos.Positions), 3)
	}

	// First position
	pos := unitPos.Positions[0]
	if pos.FrameNum != 0 {
		t.Errorf("Position[0].FrameNum = %d, want %d", pos.FrameNum, 0)
	}
	if pos.PosX != 100.0 {
		t.Errorf("Position[0].PosX = %v, want %v", pos.PosX, 100.0)
	}
	if pos.Direction != 90 {
		t.Errorf("Position[0].Direction = %d, want %d", pos.Direction, 90)
	}
	if pos.Alive != 1 {
		t.Errorf("Position[0].Alive = %d, want %d", pos.Alive, 1)
	}
	if pos.IsInVehicle {
		t.Error("Position[0].IsInVehicle should be false")
	}

	// Second position (in vehicle)
	pos = unitPos.Positions[1]
	if !pos.IsInVehicle {
		t.Error("Position[1].IsInVehicle should be true")
	}
	if pos.VehicleID != 5 {
		t.Errorf("Position[1].VehicleID = %d, want %d", pos.VehicleID, 5)
	}

	// Third position (dead)
	pos = unitPos.Positions[2]
	if pos.Alive != 0 {
		t.Errorf("Position[2].Alive = %d, want %d", pos.Alive, 0)
	}

	// Vehicle positions
	vehPos := result.EntityPositions[1]
	if vehPos.EntityID != 1 {
		t.Errorf("EntityPositions[1].EntityID = %d, want %d", vehPos.EntityID, 1)
	}

	// Check crew
	pos = vehPos.Positions[1]
	if len(pos.CrewIDs) != 1 {
		t.Errorf("Position[1].CrewIDs = %v, want [0]", pos.CrewIDs)
	} else if pos.CrewIDs[0] != 0 {
		t.Errorf("Position[1].CrewIDs[0] = %d, want %d", pos.CrewIDs[0], 0)
	}
}

func TestParserV1_parseEvent_EdgeCases(t *testing.T) {
	p := &ParserV1{}

	t.Run("too short", func(t *testing.T) {
		evt := p.parseEvent([]interface{}{100.0})
		if evt != nil {
			t.Error("expected nil for too short event")
		}
	})

	t.Run("empty", func(t *testing.T) {
		evt := p.parseEvent([]interface{}{})
		if evt != nil {
			t.Error("expected nil for empty event")
		}
	})

	t.Run("minimal valid", func(t *testing.T) {
		evt := p.parseEvent([]interface{}{100.0, "test"})
		if evt == nil {
			t.Fatal("expected non-nil event")
		}
		if evt.FrameNum != 100 {
			t.Errorf("FrameNum = %d, want %d", evt.FrameNum, 100)
		}
		if evt.Type != "test" {
			t.Errorf("Type = %q, want %q", evt.Type, "test")
		}
	})

	t.Run("connected event", func(t *testing.T) {
		evt := p.parseEvent([]interface{}{2.0, "connected", "Cal"})
		if evt == nil {
			t.Fatal("expected non-nil event")
		}
		if evt.FrameNum != 2 {
			t.Errorf("FrameNum = %d, want %d", evt.FrameNum, 2)
		}
		if evt.Type != "connected" {
			t.Errorf("Type = %q, want %q", evt.Type, "connected")
		}
		if evt.Message != "Cal" {
			t.Errorf("Message = %q, want %q", evt.Message, "Cal")
		}
		if evt.SourceID != 0 {
			t.Errorf("SourceID = %d, want %d (should not be set)", evt.SourceID, 0)
		}
	})

	t.Run("disconnected event", func(t *testing.T) {
		evt := p.parseEvent([]interface{}{3.0, "disconnected", "Wraith"})
		if evt == nil {
			t.Fatal("expected non-nil event")
		}
		if evt.FrameNum != 3 {
			t.Errorf("FrameNum = %d, want %d", evt.FrameNum, 3)
		}
		if evt.Type != "disconnected" {
			t.Errorf("Type = %q, want %q", evt.Type, "disconnected")
		}
		if evt.Message != "Wraith" {
			t.Errorf("Message = %q, want %q", evt.Message, "Wraith")
		}
	})

	t.Run("connected event without player name", func(t *testing.T) {
		evt := p.parseEvent([]interface{}{5.0, "connected"})
		if evt == nil {
			t.Fatal("expected non-nil event")
		}
		if evt.Type != "connected" {
			t.Errorf("Type = %q, want %q", evt.Type, "connected")
		}
		if evt.Message != "" {
			t.Errorf("Message = %q, want empty string", evt.Message)
		}
	})

	// Old extension format tests
	t.Run("old extension killed event [frameNum, type, victimId, [killerId, weapon], distance]", func(t *testing.T) {
		// Old extension produces: [frameNum, "killed", victimId, [killerId, weaponName], distance]
		evt := p.parseEvent([]interface{}{
			404.0,                             // frameNum
			"killed",                          // type
			84.0,                              // victimId (TargetID)
			[]interface{}{83.0, "AKS-74N"},    // [killerId, weaponName]
			10.0,                              // distance
		})
		if evt == nil {
			t.Fatal("expected non-nil event")
		}
		if evt.FrameNum != 404 {
			t.Errorf("FrameNum = %d, want %d", evt.FrameNum, 404)
		}
		if evt.Type != "killed" {
			t.Errorf("Type = %q, want %q", evt.Type, "killed")
		}
		if evt.TargetID != 84 {
			t.Errorf("TargetID = %d, want %d (victimId)", evt.TargetID, 84)
		}
		if evt.SourceID != 83 {
			t.Errorf("SourceID = %d, want %d (killerId)", evt.SourceID, 83)
		}
		if evt.Weapon != "AKS-74N" {
			t.Errorf("Weapon = %q, want %q", evt.Weapon, "AKS-74N")
		}
		if evt.Distance != 10.0 {
			t.Errorf("Distance = %v, want %v", evt.Distance, 10.0)
		}
	})

	t.Run("old extension hit event [frameNum, type, victimId, [shooterId, weapon], distance]", func(t *testing.T) {
		evt := p.parseEvent([]interface{}{
			200.0,
			"hit",
			50.0,                                   // victimId
			[]interface{}{42.0, "PKP Pecheneg"},    // [shooterId, weapon]
			25.0,                                   // distance
		})
		if evt == nil {
			t.Fatal("expected non-nil event")
		}
		if evt.TargetID != 50 {
			t.Errorf("TargetID = %d, want %d", evt.TargetID, 50)
		}
		if evt.SourceID != 42 {
			t.Errorf("SourceID = %d, want %d", evt.SourceID, 42)
		}
		if evt.Weapon != "PKP Pecheneg" {
			t.Errorf("Weapon = %q, want %q", evt.Weapon, "PKP Pecheneg")
		}
	})

	t.Run("old extension killed event with only killerId in array", func(t *testing.T) {
		evt := p.parseEvent([]interface{}{
			100.0,
			"killed",
			10.0,
			[]interface{}{5.0}, // Only killerId, no weapon
			50.0,
		})
		if evt == nil {
			t.Fatal("expected non-nil event")
		}
		if evt.SourceID != 5 {
			t.Errorf("SourceID = %d, want %d", evt.SourceID, 5)
		}
		if evt.Weapon != "" {
			t.Errorf("Weapon = %q, want empty string", evt.Weapon)
		}
	})

	t.Run("alternative format killed event [frameNum, type, sourceId, targetId, weapon, distance]", func(t *testing.T) {
		// Alternative format: [frameNum, "type", sourceId, targetId, weapon, distance]
		evt := p.parseEvent([]interface{}{
			8.0,           // frameNum
			"killed",      // type
			0.0,           // sourceId
			1.0,           // targetId
			"arifle_MX",   // weapon
			150.0,         // distance
		})
		if evt == nil {
			t.Fatal("expected non-nil event")
		}
		if evt.SourceID != 0 {
			t.Errorf("SourceID = %d, want %d", evt.SourceID, 0)
		}
		if evt.TargetID != 1 {
			t.Errorf("TargetID = %d, want %d", evt.TargetID, 1)
		}
		if evt.Weapon != "arifle_MX" {
			t.Errorf("Weapon = %q, want %q", evt.Weapon, "arifle_MX")
		}
		if evt.Distance != 150.0 {
			t.Errorf("Distance = %v, want %v", evt.Distance, 150.0)
		}
	})

	t.Run("non-combat event with message at index 4", func(t *testing.T) {
		// Non-killed/hit event with string at index 4 should set Message
		evt := p.parseEvent([]interface{}{
			100.0,
			"chat",
			5.0,            // sourceId
			10.0,           // targetId
			"Hello world",  // message (not weapon since type is not killed/hit)
		})
		if evt == nil {
			t.Fatal("expected non-nil event")
		}
		if evt.Message != "Hello world" {
			t.Errorf("Message = %q, want %q", evt.Message, "Hello world")
		}
		if evt.Weapon != "" {
			t.Errorf("Weapon = %q, want empty (not a combat event)", evt.Weapon)
		}
	})

	t.Run("event with float distance at index 4", func(t *testing.T) {
		// When index 4 is a float, it's treated as distance
		evt := p.parseEvent([]interface{}{
			100.0,
			"explosion",
			5.0,   // sourceId
			10.0,  // targetId
			50.5,  // distance as float
		})
		if evt == nil {
			t.Fatal("expected non-nil event")
		}
		if evt.Distance != 50.5 {
			t.Errorf("Distance = %v, want %v", evt.Distance, 50.5)
		}
	})

	t.Run("event with only source (no target)", func(t *testing.T) {
		evt := p.parseEvent([]interface{}{
			100.0,
			"fired",
			5.0, // sourceId only
		})
		if evt == nil {
			t.Fatal("expected non-nil event")
		}
		if evt.SourceID != 5 {
			t.Errorf("SourceID = %d, want %d", evt.SourceID, 5)
		}
		if evt.TargetID != 0 {
			t.Errorf("TargetID = %d, want %d (not set)", evt.TargetID, 0)
		}
	})

	t.Run("old extension event with empty killer array", func(t *testing.T) {
		evt := p.parseEvent([]interface{}{
			100.0,
			"killed",
			10.0,
			[]interface{}{}, // Empty array - no killer info
			50.0,
		})
		if evt == nil {
			t.Fatal("expected non-nil event")
		}
		if evt.TargetID != 10 {
			t.Errorf("TargetID = %d, want %d", evt.TargetID, 10)
		}
		if evt.SourceID != 0 {
			t.Errorf("SourceID = %d, want %d (empty array)", evt.SourceID, 0)
		}
		if evt.Distance != 50.0 {
			t.Errorf("Distance = %v, want %v", evt.Distance, 50.0)
		}
	})

	t.Run("old extension event without distance", func(t *testing.T) {
		evt := p.parseEvent([]interface{}{
			100.0,
			"killed",
			10.0,
			[]interface{}{5.0, "rifle"},
			// No distance
		})
		if evt == nil {
			t.Fatal("expected non-nil event")
		}
		if evt.Distance != 0 {
			t.Errorf("Distance = %v, want %v (not set)", evt.Distance, 0.0)
		}
	})

	t.Run("old extension event with non-float distance", func(t *testing.T) {
		evt := p.parseEvent([]interface{}{
			100.0,
			"killed",
			10.0,
			[]interface{}{5.0, "rifle"},
			"not a number", // Distance that's not a float
		})
		if evt == nil {
			t.Fatal("expected non-nil event")
		}
		if evt.Distance != 0 {
			t.Errorf("Distance = %v, want %v (invalid type)", evt.Distance, 0.0)
		}
	})
}

func TestParserV1_parseMarker_EdgeCases(t *testing.T) {
	p := &ParserV1{}

	t.Run("too short", func(t *testing.T) {
		marker := p.parseMarker([]interface{}{"ICON", "text", 0.0, 10.0, 0.0, "color"})
		if marker != nil {
			t.Error("expected nil for too short marker")
		}
	})

	t.Run("minimal valid", func(t *testing.T) {
		marker := p.parseMarker([]interface{}{"ICON", "text", 0.0, 10.0, 0.0, "color", 0.0})
		if marker == nil {
			t.Fatal("expected non-nil marker")
		}
		if marker.Type != "ICON" {
			t.Errorf("Type = %q, want %q", marker.Type, "ICON")
		}
	})
}

func TestParserV1_parseMarkerPosition_Formats(t *testing.T) {
	p := &ParserV1{}

	t.Run("simple format [x, y]", func(t *testing.T) {
		pos := p.parseMarkerPosition([]interface{}{100.0, 200.0})
		if pos == nil {
			t.Fatal("expected non-nil position")
		}
		if pos.PosX != 100.0 || pos.PosY != 200.0 {
			t.Errorf("Position = (%v, %v), want (100, 200)", pos.PosX, pos.PosY)
		}
	})

	t.Run("simple format [x, y, z]", func(t *testing.T) {
		pos := p.parseMarkerPosition([]interface{}{100.0, 200.0, 10.0})
		if pos == nil {
			t.Fatal("expected non-nil position")
		}
		if pos.PosZ != 10.0 {
			t.Errorf("PosZ = %v, want %v", pos.PosZ, 10.0)
		}
	})

	t.Run("complex format [[x, y, z], frameNum, direction, alpha]", func(t *testing.T) {
		pos := p.parseMarkerPosition([]interface{}{
			[]interface{}{100.0, 200.0, 10.0},
			50.0, 90.0, 0.5,
		})
		if pos == nil {
			t.Fatal("expected non-nil position")
		}
		if pos.FrameNum != 50 {
			t.Errorf("FrameNum = %d, want %d", pos.FrameNum, 50)
		}
		if pos.Direction != 90.0 {
			t.Errorf("Direction = %v, want %v", pos.Direction, 90.0)
		}
		if pos.Alpha != 0.5 {
			t.Errorf("Alpha = %v, want %v", pos.Alpha, 0.5)
		}
	})

	t.Run("old extension format [frameNum, [x, y], direction]", func(t *testing.T) {
		// Old extension produces: [frameNum, [x, y], direction, ?alpha]
		pos := p.parseMarkerPosition([]interface{}{
			50.0,                        // frameNum
			[]interface{}{100.0, 200.0}, // [x, y]
			90.0,                        // direction
		})
		if pos == nil {
			t.Fatal("expected non-nil position")
		}
		if pos.FrameNum != 50 {
			t.Errorf("FrameNum = %d, want %d", pos.FrameNum, 50)
		}
		if pos.PosX != 100.0 {
			t.Errorf("PosX = %v, want %v", pos.PosX, 100.0)
		}
		if pos.PosY != 200.0 {
			t.Errorf("PosY = %v, want %v", pos.PosY, 200.0)
		}
		if pos.Direction != 90.0 {
			t.Errorf("Direction = %v, want %v", pos.Direction, 90.0)
		}
	})

	t.Run("old extension format [frameNum, [x, y], direction, alpha]", func(t *testing.T) {
		pos := p.parseMarkerPosition([]interface{}{
			50.0,                        // frameNum
			[]interface{}{100.0, 200.0}, // [x, y]
			90.0,                        // direction
			75.0,                        // alpha
		})
		if pos == nil {
			t.Fatal("expected non-nil position")
		}
		if pos.FrameNum != 50 {
			t.Errorf("FrameNum = %d, want %d", pos.FrameNum, 50)
		}
		if pos.Alpha != 75.0 {
			t.Errorf("Alpha = %v, want %v", pos.Alpha, 75.0)
		}
	})

	t.Run("old extension format [frameNum, [x, y, z], direction]", func(t *testing.T) {
		pos := p.parseMarkerPosition([]interface{}{
			50.0,                              // frameNum
			[]interface{}{100.0, 200.0, 10.0}, // [x, y, z]
			90.0,                              // direction
		})
		if pos == nil {
			t.Fatal("expected non-nil position")
		}
		if pos.PosZ != 10.0 {
			t.Errorf("PosZ = %v, want %v", pos.PosZ, 10.0)
		}
	})

	t.Run("nil input", func(t *testing.T) {
		pos := p.parseMarkerPosition(nil)
		if pos != nil {
			t.Error("expected nil for nil input")
		}
	})

	t.Run("empty array", func(t *testing.T) {
		pos := p.parseMarkerPosition([]interface{}{})
		if pos != nil {
			t.Error("expected nil for empty array")
		}
	})

	t.Run("POLYLINE format [frameNum, [[x1, y1], [x2, y2], ...], direction, alpha]", func(t *testing.T) {
		pos := p.parseMarkerPosition([]interface{}{
			67.0, // frameNum
			[]interface{}{ // array of coordinate pairs
				[]interface{}{7610.62, 20901.1},
				[]interface{}{7647.86, 20901.1},
				[]interface{}{7745.6, 20887.2},
			},
			0.0, // direction
			1.0, // alpha
		})
		if pos == nil {
			t.Fatal("expected non-nil position")
		}
		if pos.FrameNum != 67 {
			t.Errorf("FrameNum = %d, want %d", pos.FrameNum, 67)
		}
		// First coordinate should be set as PosX/PosY for backwards compatibility
		if pos.PosX != 7610.62 {
			t.Errorf("PosX = %v, want %v", pos.PosX, 7610.62)
		}
		if pos.PosY != 20901.1 {
			t.Errorf("PosY = %v, want %v", pos.PosY, 20901.1)
		}
		// LineCoords should contain all coordinates as flat array
		expectedCoords := []float32{7610.62, 20901.1, 7647.86, 20901.1, 7745.6, 20887.2}
		if len(pos.LineCoords) != len(expectedCoords) {
			t.Errorf("len(LineCoords) = %d, want %d", len(pos.LineCoords), len(expectedCoords))
		}
		for i, v := range expectedCoords {
			if i < len(pos.LineCoords) && pos.LineCoords[i] != v {
				t.Errorf("LineCoords[%d] = %v, want %v", i, pos.LineCoords[i], v)
			}
		}
		if pos.Direction != 0.0 {
			t.Errorf("Direction = %v, want %v", pos.Direction, 0.0)
		}
		if pos.Alpha != 1.0 {
			t.Errorf("Alpha = %v, want %v", pos.Alpha, 1.0)
		}
	})
}

func TestParserV1_calculateEndFrame(t *testing.T) {
	p := &ParserV1{}

	t.Run("with positions", func(t *testing.T) {
		em := map[string]interface{}{
			"positions": []interface{}{nil, nil, nil, nil, nil},
		}
		endFrame := p.calculateEndFrame(em, 10)
		// startFrame + len(positions) - 1 = 10 + 5 - 1 = 14
		if endFrame != 14 {
			t.Errorf("endFrame = %d, want %d", endFrame, 14)
		}
	})

	t.Run("without positions", func(t *testing.T) {
		em := map[string]interface{}{}
		endFrame := p.calculateEndFrame(em, 10)
		if endFrame != 10 {
			t.Errorf("endFrame = %d, want %d", endFrame, 10)
		}
	})
}

func TestSideIndexToString(t *testing.T) {
	// Old extension uses BIS_fnc_sideID: -1=global, 0=EAST, 1=WEST, 2=RESISTANCE, 3=CIVILIAN
	tests := []struct {
		input int
		want  string
	}{
		{0, "EAST"},
		{1, "WEST"},
		{2, "GUER"},
		{3, "CIV"},
		{4, ""},
		{-1, "GLOBAL"},
		{100, ""},
	}

	for _, tt := range tests {
		got := sideIndexToString(tt.input)
		if got != tt.want {
			t.Errorf("sideIndexToString(%d) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestParserV1_Parse_VehicleSparsePositions(t *testing.T) {
	p := &ParserV1{}

	// Simulate a static DShK that doesn't move for 10 frames, then moves.
	// The Arma extension uses sparse format: each position entry has
	// [startFrame, endFrame] at index 4, covering a range of frames.
	data := map[string]interface{}{
		"worldName":    "Altis",
		"missionName":  "Test Sparse",
		"endFrame":     15.0,
		"captureDelay": 1.0,
		"entities": []interface{}{
			map[string]interface{}{
				"id":            5.0,
				"type":          "vehicle",
				"name":          "DShK",
				"class":         "O_HMG_01_high_F",
				"side":          "EAST",
				"startFrameNum": 0.0,
				"positions": []interface{}{
					// Static for frames 0-9: same position, no crew
					[]interface{}{
						[]interface{}{5000.0, 6000.0, 0.0}, // position
						45.0,                                // direction
						1.0,                                 // alive
						[]interface{}{},                     // crew (empty)
						[]interface{}{0.0, 9.0},             // [startFrame, endFrame] sparse range
					},
					// Moves for frames 10-14: different position, with crew
					[]interface{}{
						[]interface{}{5010.0, 6010.0, 0.0},
						90.0,
						1.0,
						[]interface{}{3.0},              // crew member ID 3
						[]interface{}{10.0, 14.0},       // frames 10-14
					},
				},
			},
		},
	}

	result, err := p.Parse(data, 300)
	if err != nil {
		t.Fatalf("Parse returned error: %v", err)
	}

	// Verify entity definition
	if len(result.Entities) != 1 {
		t.Fatalf("len(Entities) = %d, want 1", len(result.Entities))
	}
	ent := result.Entities[0]
	if ent.EndFrame != 14 {
		t.Errorf("Entity EndFrame = %d, want 14 (last sparse range end)", ent.EndFrame)
	}

	// Verify positions were expanded from 2 sparse entries to 15 dense entries
	if len(result.EntityPositions) != 1 {
		t.Fatalf("len(EntityPositions) = %d, want 1", len(result.EntityPositions))
	}
	ep := result.EntityPositions[0]

	if len(ep.Positions) != 15 {
		t.Fatalf("len(Positions) = %d, want 15 (frames 0-14 expanded from sparse)", len(ep.Positions))
	}

	// Verify frame 0 (first sparse range)
	pos := ep.Positions[0]
	if pos.FrameNum != 0 {
		t.Errorf("Positions[0].FrameNum = %d, want 0", pos.FrameNum)
	}
	if pos.PosX != 5000.0 || pos.PosY != 6000.0 {
		t.Errorf("Positions[0] pos = (%v, %v), want (5000, 6000)", pos.PosX, pos.PosY)
	}
	if pos.Direction != 45 {
		t.Errorf("Positions[0].Direction = %d, want 45", pos.Direction)
	}
	if pos.Alive != 1 {
		t.Errorf("Positions[0].Alive = %d, want 1", pos.Alive)
	}

	// Verify frame 5 (middle of first sparse range - should have same data)
	pos = ep.Positions[5]
	if pos.FrameNum != 5 {
		t.Errorf("Positions[5].FrameNum = %d, want 5", pos.FrameNum)
	}
	if pos.PosX != 5000.0 || pos.PosY != 6000.0 {
		t.Errorf("Positions[5] pos = (%v, %v), want (5000, 6000)", pos.PosX, pos.PosY)
	}

	// Verify frame 9 (end of first sparse range)
	pos = ep.Positions[9]
	if pos.FrameNum != 9 {
		t.Errorf("Positions[9].FrameNum = %d, want 9", pos.FrameNum)
	}
	if pos.PosX != 5000.0 {
		t.Errorf("Positions[9].PosX = %v, want 5000", pos.PosX)
	}

	// Verify frame 10 (start of second sparse range - different position)
	pos = ep.Positions[10]
	if pos.FrameNum != 10 {
		t.Errorf("Positions[10].FrameNum = %d, want 10", pos.FrameNum)
	}
	if pos.PosX != 5010.0 || pos.PosY != 6010.0 {
		t.Errorf("Positions[10] pos = (%v, %v), want (5010, 6010)", pos.PosX, pos.PosY)
	}
	if pos.Direction != 90 {
		t.Errorf("Positions[10].Direction = %d, want 90", pos.Direction)
	}
	if len(pos.CrewIDs) != 1 || pos.CrewIDs[0] != 3 {
		t.Errorf("Positions[10].CrewIDs = %v, want [3]", pos.CrewIDs)
	}

	// Verify frame 14 (end of second sparse range)
	pos = ep.Positions[14]
	if pos.FrameNum != 14 {
		t.Errorf("Positions[14].FrameNum = %d, want 14", pos.FrameNum)
	}
	if pos.PosX != 5010.0 {
		t.Errorf("Positions[14].PosX = %v, want 5010", pos.PosX)
	}
}

func TestParserV1_Parse_VehicleSparsePositions_ChunkBuild(t *testing.T) {
	// Verify that sparse vehicle positions produce correct chunk data
	// (entity appears in every frame, not just first frame)
	p := &ParserV1{}
	w := &ProtobufWriterV1{}

	data := map[string]interface{}{
		"worldName":    "Altis",
		"missionName":  "Test",
		"endFrame":     10.0,
		"captureDelay": 1.0,
		"entities": []interface{}{
			map[string]interface{}{
				"id":            2.0,
				"type":          "vehicle",
				"name":          "Static Gun",
				"class":         "O_HMG_01_high_F",
				"side":          "EAST",
				"startFrameNum": 0.0,
				"positions": []interface{}{
					[]interface{}{
						[]interface{}{1000.0, 2000.0, 0.0},
						180.0,
						1.0,
						[]interface{}{},
						[]interface{}{0.0, 9.0}, // Covers all 10 frames
					},
				},
			},
		},
	}

	result, err := p.Parse(data, 300)
	if err != nil {
		t.Fatalf("Parse returned error: %v", err)
	}

	// Build a chunk and verify entity is present in EVERY frame
	chunk := w.buildChunk(result, 0)
	if len(chunk.Frames) != 10 {
		t.Fatalf("len(Frames) = %d, want 10", len(chunk.Frames))
	}

	for i, frame := range chunk.Frames {
		if len(frame.Entities) != 1 {
			t.Errorf("Frame %d: len(Entities) = %d, want 1 (static vehicle should be present in every frame)", i, len(frame.Entities))
			continue
		}
		ent := frame.Entities[0]
		if ent.EntityId != 2 {
			t.Errorf("Frame %d: EntityId = %d, want 2", i, ent.EntityId)
		}
		if ent.PosX != 1000.0 || ent.PosY != 2000.0 {
			t.Errorf("Frame %d: pos = (%v, %v), want (1000, 2000)", i, ent.PosX, ent.PosY)
		}
	}
}

func TestParserV1_Parse_VehicleDensePositions_Unaffected(t *testing.T) {
	// Verify that dense vehicle positions (without frame ranges) still work correctly
	p := &ParserV1{}

	data := map[string]interface{}{
		"worldName":    "Altis",
		"missionName":  "Test Dense",
		"endFrame":     3.0,
		"captureDelay": 1.0,
		"entities": []interface{}{
			map[string]interface{}{
				"id":            1.0,
				"type":          "vehicle",
				"name":          "Truck",
				"class":         "B_Truck_01",
				"startFrameNum": 0.0,
				"positions": []interface{}{
					// Dense format (no entry[4] frame range)
					[]interface{}{[]interface{}{100.0, 200.0, 0.0}, 90.0, 1.0, []interface{}{}},
					[]interface{}{[]interface{}{110.0, 210.0, 0.0}, 95.0, 1.0, []interface{}{0.0}},
					[]interface{}{[]interface{}{120.0, 220.0, 0.0}, 100.0, 1.0, []interface{}{}},
				},
			},
		},
	}

	result, err := p.Parse(data, 300)
	if err != nil {
		t.Fatalf("Parse returned error: %v", err)
	}

	ep := result.EntityPositions[0]
	if len(ep.Positions) != 3 {
		t.Fatalf("len(Positions) = %d, want 3 (dense, unchanged)", len(ep.Positions))
	}

	// Verify sequential frame numbers
	for i, pos := range ep.Positions {
		if pos.FrameNum != uint32(i) {
			t.Errorf("Positions[%d].FrameNum = %d, want %d", i, pos.FrameNum, i)
		}
	}

	// Verify end frame uses dense calculation
	ent := result.Entities[0]
	if ent.EndFrame != 2 { // 0 + 3 - 1
		t.Errorf("EndFrame = %d, want 2", ent.EndFrame)
	}
}

func TestParserV1_calculateEndFrame_SparseVehicle(t *testing.T) {
	p := &ParserV1{}

	t.Run("sparse vehicle positions", func(t *testing.T) {
		em := map[string]interface{}{
			"positions": []interface{}{
				[]interface{}{
					[]interface{}{100.0, 200.0, 0.0},
					45.0, 1.0, []interface{}{},
					[]interface{}{0.0, 499.0},
				},
				[]interface{}{
					[]interface{}{150.0, 250.0, 0.0},
					90.0, 1.0, []interface{}{},
					[]interface{}{500.0, 999.0},
				},
			},
		}
		endFrame := p.calculateEndFrame(em, 0)
		if endFrame != 999 {
			t.Errorf("endFrame = %d, want 999 (from last sparse range)", endFrame)
		}
	})
}

func TestParserV1_collectEntityPositions_EdgeCases(t *testing.T) {
	p := &ParserV1{}

	t.Run("no positions key", func(t *testing.T) {
		em := map[string]interface{}{}
		result := p.collectEntityPositions(em, 0, 0, "unit")
		if result != nil {
			t.Error("expected nil for missing positions")
		}
	})

	t.Run("positions wrong type", func(t *testing.T) {
		em := map[string]interface{}{
			"positions": "not an array",
		}
		result := p.collectEntityPositions(em, 0, 0, "unit")
		if result != nil {
			t.Error("expected nil for invalid positions type")
		}
	})

	t.Run("position entry too short", func(t *testing.T) {
		em := map[string]interface{}{
			"positions": []interface{}{
				[]interface{}{[]interface{}{100.0, 200.0}}, // Only 1 element, need at least 3
			},
		}
		result := p.collectEntityPositions(em, 0, 0, "unit")
		if result == nil {
			t.Fatal("expected non-nil result")
		}
		// Entry should be skipped
		if len(result.Positions) != 0 {
			t.Errorf("len(Positions) = %d, want %d", len(result.Positions), 0)
		}
	})
}
