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
				0.0,                                               // sideIndex (0 = WEST)
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
	tests := []struct {
		input int
		want  string
	}{
		{0, "WEST"},
		{1, "EAST"},
		{2, "GUER"},
		{3, "CIV"},
		{4, ""},
		{-1, ""},
		{100, ""},
	}

	for _, tt := range tests {
		got := sideIndexToString(tt.input)
		if got != tt.want {
			t.Errorf("sideIndexToString(%d) = %q, want %q", tt.input, got, tt.want)
		}
	}
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
