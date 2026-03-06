package storage

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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
	require.NoError(t, err)
	require.NotNil(t, p)
	assert.Equal(t, JSONInputVersionV1, p.Version())

	// Verify the parser works
	result, err := p.Parse(nil, 100)
	require.NoError(t, err)
	assert.Equal(t, "TestWorld", result.WorldName)
}

func TestGetParserUnknownVersion(t *testing.T) {
	// Clear registry before test
	parsers = make(map[JSONInputVersion]Parser)

	// Test GetParser returns error for unknown version
	p, err := GetParser(JSONInputVersionUnknown)
	require.Error(t, err)
	assert.Nil(t, p)
	assert.Contains(t, err.Error(), "no parser for JSON version")
}

func TestGetParserUnregisteredVersion(t *testing.T) {
	// Clear registry before test
	parsers = make(map[JSONInputVersion]Parser)

	// Test GetParser returns error for unregistered version
	p, err := GetParser(JSONInputVersionV1)
	require.Error(t, err)
	assert.Nil(t, p)
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
	require.NoError(t, err)
	assert.Same(t, mock2, p)
}

// ParserV1 Tests

func TestParserV1_Version(t *testing.T) {
	p := &ParserV1{}
	assert.Equal(t, JSONInputVersionV1, p.Version())
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
	require.NoError(t, err)

	assert.Equal(t, "Altis", result.WorldName)
	assert.Equal(t, "Test Mission", result.MissionName)
	assert.Equal(t, uint32(100), result.FrameCount)
	assert.Equal(t, uint32(50), result.ChunkSize)
	assert.Equal(t, uint32(1500), result.CaptureDelayMs)
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
				"not a map",                                                       // Invalid - should be skipped
				[]interface{}{"also not a map"},                                   // Invalid - should be skipped
				map[string]interface{}{"id": 0.0, "type": "unit", "name": "Valid"}, // Valid
			},
		}
		result, err := p.Parse(data, 100)
		require.NoError(t, err)
		assert.Len(t, result.Entities, 1, "invalid entries should be skipped")
	})

	t.Run("invalid event type in array (not an array)", func(t *testing.T) {
		data := map[string]interface{}{
			"worldName":    "Altis",
			"missionName":  "Test",
			"endFrame":     10.0,
			"captureDelay": 1.0,
			"entities":     []interface{}{},
			"events": []interface{}{
				"not an array",                       // Invalid - should be skipped
				map[string]interface{}{"frame": 0.0}, // Invalid - should be skipped
				[]interface{}{0.0},                   // Too short - should be skipped
				[]interface{}{0.0, "valid"},          // Valid
			},
		}
		result, err := p.Parse(data, 100)
		require.NoError(t, err)
		assert.Len(t, result.Events, 1, "invalid entries should be skipped")
	})

	t.Run("invalid marker type in array (not an array)", func(t *testing.T) {
		data := map[string]interface{}{
			"worldName":    "Altis",
			"missionName":  "Test",
			"endFrame":     10.0,
			"captureDelay": 1.0,
			"entities":     []interface{}{},
			"Markers": []interface{}{
				"not an array",                       // Invalid - should be skipped
				map[string]interface{}{"type": "ICON"}, // Invalid - should be skipped
				[]interface{}{"ICON", "text", 0.0, 10.0, 0.0, "color", 0.0}, // Valid
			},
		}
		result, err := p.Parse(data, 100)
		require.NoError(t, err)
		assert.Len(t, result.Markers, 1, "invalid entries should be skipped")
	})

	t.Run("invalid time entry type (not a map)", func(t *testing.T) {
		data := map[string]interface{}{
			"worldName":    "Altis",
			"missionName":  "Test",
			"endFrame":     10.0,
			"captureDelay": 1.0,
			"entities":     []interface{}{},
			"times": []interface{}{
				"not a map",             // Invalid - should be skipped
				[]interface{}{0.0, 1.0}, // Invalid - should be skipped
				map[string]interface{}{"frameNum": 0.0, "time": 100.0}, // Valid
			},
		}
		result, err := p.Parse(data, 100)
		require.NoError(t, err)
		assert.Len(t, result.Times, 1, "invalid entries should be skipped")
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
		require.NoError(t, err)
		assert.Len(t, result.Entities, 1)
		assert.Empty(t, result.EntityPositions, "nil positions")
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
	require.NoError(t, err)

	// Verify entities
	require.Len(t, result.Entities, 2)

	// First entity (unit)
	ent := result.Entities[0]
	assert.Equal(t, uint32(0), ent.ID)
	assert.Equal(t, "unit", ent.Type)
	assert.Equal(t, "Player1", ent.Name)
	assert.Equal(t, "WEST", ent.Side)
	assert.Equal(t, "Alpha", ent.Group)
	assert.True(t, ent.IsPlayer)
	assert.Equal(t, uint32(0), ent.StartFrame)
	assert.Equal(t, uint32(1), ent.EndFrame) // startFrame + len(positions) - 1 = 0 + 2 - 1 = 1

	// Second entity (vehicle)
	ent = result.Entities[1]
	assert.Equal(t, "vehicle", ent.Type)
	assert.Equal(t, "B_Truck_01", ent.VehicleClass)
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
	require.NoError(t, err)
	require.Len(t, result.Events, 3)

	// Killed event
	evt := result.Events[0]
	assert.Equal(t, uint32(8), evt.FrameNum)
	assert.Equal(t, "killed", evt.Type)
	assert.Equal(t, uint32(0), evt.SourceID)
	assert.Equal(t, uint32(1), evt.TargetID)
	assert.Equal(t, "arifle_MX", evt.Weapon)
	assert.Equal(t, float32(150.0), evt.Distance)

	// Hit event
	evt = result.Events[1]
	assert.Equal(t, "hit", evt.Type)
	assert.Equal(t, "pistol", evt.Weapon)

	// Chat event
	evt = result.Events[2]
	assert.Equal(t, "chat", evt.Type)
	assert.Equal(t, "Hello world", evt.Message)
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
				"ICON",                                         // type
				"Alpha",                                        // text
				0.0,                                            // startFrame
				10.0,                                           // endFrame
				0.0,                                            // playerId
				"ColorBlufor",                                  // color
				1.0,                                            // sideIndex (1 = WEST per BIS_fnc_sideID)
				[]interface{}{[]interface{}{100.0, 200.0, 0.0}}, // positions
				[]interface{}{1.0, 1.0},                        // size
				"ICON",                                         // shape
				"Solid",                                        // brush
			},
		},
	}

	result, err := p.Parse(data, 100)
	require.NoError(t, err)
	require.Len(t, result.Markers, 1)

	m := result.Markers[0]
	assert.Equal(t, "ICON", m.Type)
	assert.Equal(t, "Alpha", m.Text)
	assert.Equal(t, uint32(0), m.StartFrame)
	assert.Equal(t, uint32(10), m.EndFrame)
	assert.Equal(t, "ColorBlufor", m.Color)
	assert.Equal(t, "WEST", m.Side)
	assert.Equal(t, "ICON", m.Shape)
	assert.Equal(t, "Solid", m.Brush)
	assert.Len(t, m.Size, 2)
	require.Len(t, m.Positions, 1)
	assert.Equal(t, float32(100.0), m.Positions[0].PosX)
	assert.Equal(t, float32(200.0), m.Positions[0].PosY)
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
				"o_inf",       // type (old extension marker type)
				"Enemy Squad", // text
				0.0,           // startFrame
				-1.0,          // endFrame (-1 = not deleted, converted to frame count)
				5.0,           // playerId
				"0000FF",      // color (hex without #)
				0.0,           // sideIndex (0 = EAST per BIS_fnc_sideID)
				[]interface{}{ // positions in old extension format
					[]interface{}{0.0, []interface{}{3915.44, 1971.98}, 180.0},        // [frameNum, [x,y], dir]
					[]interface{}{50.0, []interface{}{3882.53, 2041.32}, 270.0, 100.0}, // [frameNum, [x,y], dir, alpha]
				},
				[]interface{}{1.0, 1.0}, // size
				"ICON",                  // shape
				"Solid",                 // brush
			},
		},
	}

	result, err := p.Parse(data, 100)
	require.NoError(t, err)
	require.Len(t, result.Markers, 1)

	m := result.Markers[0]
	assert.Equal(t, "o_inf", m.Type)
	assert.Equal(t, "EAST", m.Side, "sideIndex 0 = EAST")
	assert.Equal(t, "0000FF", m.Color)
	assert.Equal(t, uint32(0), m.EndFrame, "-1 in v1 JSON should convert to 0 (FrameForever)")

	require.Len(t, m.Positions, 2)

	// Check first position
	pos1 := m.Positions[0]
	assert.Equal(t, uint32(0), pos1.FrameNum)
	assert.Equal(t, float32(3915.44), pos1.PosX)
	assert.Equal(t, float32(1971.98), pos1.PosY)
	assert.Equal(t, float32(180.0), pos1.Direction)

	// Check second position with alpha
	pos2 := m.Positions[1]
	assert.Equal(t, uint32(50), pos2.FrameNum)
	assert.Equal(t, float32(100.0), pos2.Alpha)
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
	require.NoError(t, err)
	require.Len(t, result.Events, 4)

	// Check first killed event
	evt := result.Events[0]
	assert.Equal(t, "killed", evt.Type)
	assert.Equal(t, uint32(84), evt.TargetID, "victimId")
	assert.Equal(t, uint32(83), evt.SourceID, "killerId")
	assert.Equal(t, "AKS-74N", evt.Weapon)
	assert.Equal(t, float32(10.0), evt.Distance)

	// Check connected event
	evt = result.Events[2]
	assert.Equal(t, "connected", evt.Type)
	assert.Equal(t, "[RMC] DoS", evt.Message)
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
	require.NoError(t, err)
	require.Len(t, result.Times, 1)

	ts := result.Times[0]
	assert.Equal(t, uint32(0), ts.FrameNum)
	assert.Equal(t, "2035-06-10T10:00:00", ts.SystemTimeUTC)
	assert.Equal(t, "2035-06-10", ts.Date)
	assert.Equal(t, float32(36000.0), ts.Time)
	assert.Equal(t, float32(1.0), ts.TimeMultiplier)
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
	require.NoError(t, err)
	require.Len(t, result.EntityPositions, 2)

	// Unit positions
	unitPos := result.EntityPositions[0]
	assert.Equal(t, uint32(0), unitPos.EntityID)
	require.Len(t, unitPos.Positions, 3)

	// First position
	pos := unitPos.Positions[0]
	assert.Equal(t, uint32(0), pos.FrameNum)
	assert.Equal(t, float32(100.0), pos.PosX)
	assert.Equal(t, uint32(90), pos.Direction)
	assert.Equal(t, uint32(1), pos.Alive)
	assert.False(t, pos.IsInVehicle)

	// Second position (in vehicle)
	pos = unitPos.Positions[1]
	assert.True(t, pos.IsInVehicle)
	assert.Equal(t, uint32(5), pos.VehicleID)

	// Third position (dead)
	pos = unitPos.Positions[2]
	assert.Equal(t, uint32(0), pos.Alive)

	// Vehicle positions
	vehPos := result.EntityPositions[1]
	assert.Equal(t, uint32(1), vehPos.EntityID)

	// Check crew
	pos = vehPos.Positions[1]
	require.Len(t, pos.CrewIDs, 1)
	assert.Equal(t, uint32(0), pos.CrewIDs[0])
}

func TestParserV1_Parse_UnitPositionsWithGroupAndSide(t *testing.T) {
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
					// 9-element format: [pos, dir, alive, inVehicle, name, isPlayer, role, groupID, side]
					[]interface{}{[]interface{}{100.0, 200.0, 0.0}, 90.0, 1.0, 0.0, "Player1", 1.0, "rifleman", "Alpha 1", "WEST"},
					// Side changes mid-mission
					[]interface{}{[]interface{}{101.0, 201.0, 0.0}, 91.0, 1.0, 0.0, "Player1", 1.0, "rifleman", "Bravo 1", "EAST"},
					// Old 7-element format (no group/side)
					[]interface{}{[]interface{}{102.0, 202.0, 0.0}, 92.0, 1.0, 0.0, "Player1", 1.0},
				},
			},
		},
	}

	result, err := p.Parse(data, 100)
	require.NoError(t, err)
	require.Len(t, result.EntityPositions, 1)

	positions := result.EntityPositions[0].Positions
	require.Len(t, positions, 3)

	// First position: has group and side
	assert.Equal(t, "Alpha 1", positions[0].GroupName)
	assert.Equal(t, "WEST", positions[0].Side)

	// Second position: group and side changed
	assert.Equal(t, "Bravo 1", positions[1].GroupName)
	assert.Equal(t, "EAST", positions[1].Side)

	// Third position: old format, no group/side
	assert.Equal(t, "", positions[2].GroupName)
	assert.Equal(t, "", positions[2].Side)
}

func TestParserV1_parseEvent_EdgeCases(t *testing.T) {
	p := &ParserV1{}

	t.Run("too short", func(t *testing.T) {
		evt := p.parseEvent([]interface{}{100.0})
		assert.Nil(t, evt)
	})

	t.Run("empty", func(t *testing.T) {
		evt := p.parseEvent([]interface{}{})
		assert.Nil(t, evt)
	})

	t.Run("minimal valid", func(t *testing.T) {
		evt := p.parseEvent([]interface{}{100.0, "test"})
		require.NotNil(t, evt)
		assert.Equal(t, uint32(100), evt.FrameNum)
		assert.Equal(t, "test", evt.Type)
	})

	t.Run("connected event", func(t *testing.T) {
		evt := p.parseEvent([]interface{}{2.0, "connected", "Cal"})
		require.NotNil(t, evt)
		assert.Equal(t, uint32(2), evt.FrameNum)
		assert.Equal(t, "connected", evt.Type)
		assert.Equal(t, "Cal", evt.Message)
		assert.Equal(t, uint32(0), evt.SourceID, "should not be set")
	})

	t.Run("disconnected event", func(t *testing.T) {
		evt := p.parseEvent([]interface{}{3.0, "disconnected", "Wraith"})
		require.NotNil(t, evt)
		assert.Equal(t, uint32(3), evt.FrameNum)
		assert.Equal(t, "disconnected", evt.Type)
		assert.Equal(t, "Wraith", evt.Message)
	})

	t.Run("connected event without player name", func(t *testing.T) {
		evt := p.parseEvent([]interface{}{5.0, "connected"})
		require.NotNil(t, evt)
		assert.Equal(t, "connected", evt.Type)
		assert.Empty(t, evt.Message)
	})

	// Old extension format tests
	t.Run("old extension killed event [frameNum, type, victimId, [killerId, weapon], distance]", func(t *testing.T) {
		evt := p.parseEvent([]interface{}{
			404.0,                          // frameNum
			"killed",                       // type
			84.0,                           // victimId (TargetID)
			[]interface{}{83.0, "AKS-74N"}, // [killerId, weaponName]
			10.0,                           // distance
		})
		require.NotNil(t, evt)
		assert.Equal(t, uint32(404), evt.FrameNum)
		assert.Equal(t, "killed", evt.Type)
		assert.Equal(t, uint32(84), evt.TargetID, "victimId")
		assert.Equal(t, uint32(83), evt.SourceID, "killerId")
		assert.Equal(t, "AKS-74N", evt.Weapon)
		assert.Equal(t, float32(10.0), evt.Distance)
	})

	t.Run("old extension hit event [frameNum, type, victimId, [shooterId, weapon], distance]", func(t *testing.T) {
		evt := p.parseEvent([]interface{}{
			200.0,
			"hit",
			50.0,                                // victimId
			[]interface{}{42.0, "PKP Pecheneg"}, // [shooterId, weapon]
			25.0,                                // distance
		})
		require.NotNil(t, evt)
		assert.Equal(t, uint32(50), evt.TargetID)
		assert.Equal(t, uint32(42), evt.SourceID)
		assert.Equal(t, "PKP Pecheneg", evt.Weapon)
	})

	t.Run("old extension killed event with only killerId in array", func(t *testing.T) {
		evt := p.parseEvent([]interface{}{
			100.0,
			"killed",
			10.0,
			[]interface{}{5.0}, // Only killerId, no weapon
			50.0,
		})
		require.NotNil(t, evt)
		assert.Equal(t, uint32(5), evt.SourceID)
		assert.Empty(t, evt.Weapon)
	})

	t.Run("alternative format killed event [frameNum, type, sourceId, targetId, weapon, distance]", func(t *testing.T) {
		evt := p.parseEvent([]interface{}{
			8.0,         // frameNum
			"killed",    // type
			0.0,         // sourceId
			1.0,         // targetId
			"arifle_MX", // weapon
			150.0,       // distance
		})
		require.NotNil(t, evt)
		assert.Equal(t, uint32(0), evt.SourceID)
		assert.Equal(t, uint32(1), evt.TargetID)
		assert.Equal(t, "arifle_MX", evt.Weapon)
		assert.Equal(t, float32(150.0), evt.Distance)
	})

	t.Run("non-combat event with message at index 4", func(t *testing.T) {
		evt := p.parseEvent([]interface{}{
			100.0,
			"chat",
			5.0,           // sourceId
			10.0,          // targetId
			"Hello world", // message (not weapon since type is not killed/hit)
		})
		require.NotNil(t, evt)
		assert.Equal(t, "Hello world", evt.Message)
		assert.Empty(t, evt.Weapon, "not a combat event")
	})

	t.Run("event with float distance at index 4", func(t *testing.T) {
		evt := p.parseEvent([]interface{}{
			100.0,
			"explosion",
			5.0,  // sourceId
			10.0, // targetId
			50.5, // distance as float
		})
		require.NotNil(t, evt)
		assert.Equal(t, float32(50.5), evt.Distance)
	})

	t.Run("event with only source (no target)", func(t *testing.T) {
		evt := p.parseEvent([]interface{}{
			100.0,
			"fired",
			5.0, // sourceId only
		})
		require.NotNil(t, evt)
		assert.Equal(t, uint32(5), evt.SourceID)
		assert.Equal(t, uint32(0), evt.TargetID, "not set")
	})

	t.Run("old extension event with empty killer array", func(t *testing.T) {
		evt := p.parseEvent([]interface{}{
			100.0,
			"killed",
			10.0,
			[]interface{}{}, // Empty array - no killer info
			50.0,
		})
		require.NotNil(t, evt)
		assert.Equal(t, uint32(10), evt.TargetID)
		assert.Equal(t, uint32(0), evt.SourceID, "empty array")
		assert.Equal(t, float32(50.0), evt.Distance)
	})

	t.Run("old extension event without distance", func(t *testing.T) {
		evt := p.parseEvent([]interface{}{
			100.0,
			"killed",
			10.0,
			[]interface{}{5.0, "rifle"},
			// No distance
		})
		require.NotNil(t, evt)
		assert.Equal(t, float32(0.0), evt.Distance, "not set")
	})

	t.Run("old extension event with non-float distance", func(t *testing.T) {
		evt := p.parseEvent([]interface{}{
			100.0,
			"killed",
			10.0,
			[]interface{}{5.0, "rifle"},
			"not a number", // Distance that's not a float
		})
		require.NotNil(t, evt)
		assert.Equal(t, float32(0.0), evt.Distance, "invalid type")
	})

	// ── generalEvent ──

	t.Run("generalEvent with message", func(t *testing.T) {
		evt := p.parseEvent([]interface{}{0.0, "generalEvent", "Recording started."})
		require.NotNil(t, evt)
		assert.Equal(t, uint32(0), evt.FrameNum)
		assert.Equal(t, "generalEvent", evt.Type)
		assert.Equal(t, "Recording started.", evt.Message)
		assert.Equal(t, uint32(0), evt.SourceID, "should not be set")
		assert.Equal(t, uint32(0), evt.TargetID, "should not be set")
	})

	t.Run("generalEvent without message", func(t *testing.T) {
		evt := p.parseEvent([]interface{}{10.0, "generalEvent"})
		require.NotNil(t, evt)
		assert.Equal(t, "generalEvent", evt.Type)
		assert.Empty(t, evt.Message)
	})

	// ── endMission ──

	t.Run("endMission with [side, message] tuple", func(t *testing.T) {
		evt := p.parseEvent([]interface{}{376.0, "endMission", []interface{}{"WEST", "Mission complete"}})
		require.NotNil(t, evt)
		assert.Equal(t, uint32(376), evt.FrameNum)
		assert.Equal(t, "endMission", evt.Type)
		assert.Equal(t, "WEST,Mission complete", evt.Message)
	})

	t.Run("endMission with empty string", func(t *testing.T) {
		evt := p.parseEvent([]interface{}{376.0, "endMission", ""})
		require.NotNil(t, evt)
		assert.Equal(t, "endMission", evt.Type)
		assert.Empty(t, evt.Message)
	})

	t.Run("endMission without data", func(t *testing.T) {
		evt := p.parseEvent([]interface{}{376.0, "endMission"})
		require.NotNil(t, evt)
		assert.Equal(t, "endMission", evt.Type)
		assert.Empty(t, evt.Message)
	})

	// ── captured / capturedFlag ──

	t.Run("captured with data array", func(t *testing.T) {
		evt := p.parseEvent([]interface{}{200.0, "captured", []interface{}{"Player1", "blue", "flag_carrier"}})
		require.NotNil(t, evt)
		assert.Equal(t, uint32(200), evt.FrameNum)
		assert.Equal(t, "captured", evt.Type)
		assert.Equal(t, "Player1,blue,flag_carrier", evt.Message)
	})

	t.Run("capturedFlag with data array", func(t *testing.T) {
		evt := p.parseEvent([]interface{}{210.0, "capturedFlag", []interface{}{"Player1", "blue"}})
		require.NotNil(t, evt)
		assert.Equal(t, "capturedFlag", evt.Type)
		assert.Equal(t, "Player1,blue", evt.Message)
	})

	// ── terminalHack ──

	t.Run("terminalHackStarted with data array", func(t *testing.T) {
		evt := p.parseEvent([]interface{}{220.0, "terminalHackStarted", []interface{}{"Player1", "blue", "red", "terminal_1"}})
		require.NotNil(t, evt)
		assert.Equal(t, uint32(220), evt.FrameNum)
		assert.Equal(t, "terminalHackStarted", evt.Type)
		assert.Equal(t, "Player1,blue,red,terminal_1", evt.Message)
	})

	t.Run("terminalHackCanceled with data array", func(t *testing.T) {
		evt := p.parseEvent([]interface{}{230.0, "terminalHackCanceled", []interface{}{"Player1", "blue", "red", "terminal_1"}})
		require.NotNil(t, evt)
		assert.Equal(t, "terminalHackCanceled", evt.Type)
		assert.Equal(t, "Player1,blue,red,terminal_1", evt.Message)
	})

	// ── respawnTickets ──

	t.Run("respawnTickets with data", func(t *testing.T) {
		evt := p.parseEvent([]interface{}{0.0, "respawnTickets", []interface{}{-1.0, -1.0, -1.0, -1.0}})
		require.NotNil(t, evt)
		assert.Equal(t, "respawnTickets", evt.Type)
		// respawnTickets doesn't use Message — it's a counter event handled separately
	})
}

func TestParserV1_parseMarker_EdgeCases(t *testing.T) {
	p := &ParserV1{}

	t.Run("too short", func(t *testing.T) {
		marker := p.parseMarker([]interface{}{"ICON", "text", 0.0, 10.0, 0.0, "color"})
		assert.Nil(t, marker)
	})

	t.Run("minimal valid", func(t *testing.T) {
		marker := p.parseMarker([]interface{}{"ICON", "text", 0.0, 10.0, 0.0, "color", 0.0})
		require.NotNil(t, marker)
		assert.Equal(t, "ICON", marker.Type)
	})
}

func TestParserV1_parseMarkerPosition_Formats(t *testing.T) {
	p := &ParserV1{}

	t.Run("simple format [x, y]", func(t *testing.T) {
		pos := p.parseMarkerPosition([]interface{}{100.0, 200.0})
		require.NotNil(t, pos)
		assert.Equal(t, float32(100.0), pos.PosX)
		assert.Equal(t, float32(200.0), pos.PosY)
	})

	t.Run("simple format [x, y, z]", func(t *testing.T) {
		pos := p.parseMarkerPosition([]interface{}{100.0, 200.0, 10.0})
		require.NotNil(t, pos)
		assert.Equal(t, float32(10.0), pos.PosZ)
	})

	t.Run("complex format [[x, y, z], frameNum, direction, alpha]", func(t *testing.T) {
		pos := p.parseMarkerPosition([]interface{}{
			[]interface{}{100.0, 200.0, 10.0},
			50.0, 90.0, 0.5,
		})
		require.NotNil(t, pos)
		assert.Equal(t, uint32(50), pos.FrameNum)
		assert.Equal(t, float32(90.0), pos.Direction)
		assert.Equal(t, float32(0.5), pos.Alpha)
	})

	t.Run("old extension format [frameNum, [x, y], direction]", func(t *testing.T) {
		pos := p.parseMarkerPosition([]interface{}{
			50.0,                        // frameNum
			[]interface{}{100.0, 200.0}, // [x, y]
			90.0,                        // direction
		})
		require.NotNil(t, pos)
		assert.Equal(t, uint32(50), pos.FrameNum)
		assert.Equal(t, float32(100.0), pos.PosX)
		assert.Equal(t, float32(200.0), pos.PosY)
		assert.Equal(t, float32(90.0), pos.Direction)
	})

	t.Run("old extension format [frameNum, [x, y], direction, alpha]", func(t *testing.T) {
		pos := p.parseMarkerPosition([]interface{}{
			50.0,                        // frameNum
			[]interface{}{100.0, 200.0}, // [x, y]
			90.0,                        // direction
			75.0,                        // alpha
		})
		require.NotNil(t, pos)
		assert.Equal(t, uint32(50), pos.FrameNum)
		assert.Equal(t, float32(75.0), pos.Alpha)
	})

	t.Run("old extension format [frameNum, [x, y, z], direction]", func(t *testing.T) {
		pos := p.parseMarkerPosition([]interface{}{
			50.0,                              // frameNum
			[]interface{}{100.0, 200.0, 10.0}, // [x, y, z]
			90.0,                              // direction
		})
		require.NotNil(t, pos)
		assert.Equal(t, float32(10.0), pos.PosZ)
	})

	t.Run("nil input", func(t *testing.T) {
		pos := p.parseMarkerPosition(nil)
		assert.Nil(t, pos)
	})

	t.Run("empty array", func(t *testing.T) {
		pos := p.parseMarkerPosition([]interface{}{})
		assert.Nil(t, pos)
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
		require.NotNil(t, pos)
		assert.Equal(t, uint32(67), pos.FrameNum)
		// First coordinate should be set as PosX/PosY for backwards compatibility
		assert.Equal(t, float32(7610.62), pos.PosX)
		assert.Equal(t, float32(20901.1), pos.PosY)
		// LineCoords should contain all coordinates as flat array
		expectedCoords := []float32{7610.62, 20901.1, 7647.86, 20901.1, 7745.6, 20887.2}
		assert.Equal(t, expectedCoords, pos.LineCoords)
		assert.Equal(t, float32(0.0), pos.Direction)
		assert.Equal(t, float32(1.0), pos.Alpha)
	})

	t.Run("extended JSON format with style overrides", func(t *testing.T) {
		pos := p.parseMarkerPosition([]interface{}{
			20.0,
			[]interface{}{14831.0, 16599.9, 17.843},
			0.0,
			1.0,
			"",                          // text
			"004C99",                    // color
			[]interface{}{1.5, 1.5},     // size
			"b_installation",            // type
			"Solid",                     // brush
			"ICON",                      // shape (not stored in position)
		})
		require.NotNil(t, pos)
		assert.Equal(t, uint32(20), pos.FrameNum)
		assert.InDelta(t, 14831.0, pos.PosX, 0.1)
		assert.InDelta(t, 16599.9, pos.PosY, 0.1)
		assert.Equal(t, "", pos.Text)
		assert.Equal(t, "004C99", pos.Color)
		assert.Equal(t, []float32{1.5, 1.5}, pos.Size)
		assert.Equal(t, "b_installation", pos.Type)
		assert.Equal(t, "Solid", pos.Brush)
	})

	t.Run("extended JSON format with empty style fields", func(t *testing.T) {
		pos := p.parseMarkerPosition([]interface{}{
			20.0,
			[]interface{}{100.0, 200.0},
			0.0,
			1.0,
			"", "", nil, "", "",
		})
		require.NotNil(t, pos)
		assert.Equal(t, uint32(20), pos.FrameNum)
		assert.Equal(t, "", pos.Text)
		assert.Equal(t, "", pos.Color)
		assert.Nil(t, pos.Size)
		assert.Equal(t, "", pos.Type)
		assert.Equal(t, "", pos.Brush)
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
		assert.Equal(t, uint32(14), endFrame)
	})

	t.Run("without positions", func(t *testing.T) {
		em := map[string]interface{}{}
		endFrame := p.calculateEndFrame(em, 10)
		assert.Equal(t, uint32(10), endFrame)
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
		assert.Equal(t, tt.want, sideIndexToString(tt.input), "sideIndexToString(%d)", tt.input)
	}
}

func TestParserV1_Parse_VehicleSparsePositions(t *testing.T) {
	p := &ParserV1{}

	// Simulate a static DShK that doesn't move for 10 frames, then moves.
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
						45.0,                    // direction
						1.0,                     // alive
						[]interface{}{},         // crew (empty)
						[]interface{}{0.0, 9.0}, // [startFrame, endFrame] sparse range
					},
					// Moves for frames 10-14: different position, with crew
					[]interface{}{
						[]interface{}{5010.0, 6010.0, 0.0},
						90.0,
						1.0,
						[]interface{}{3.0},         // crew member ID 3
						[]interface{}{10.0, 14.0},  // frames 10-14
					},
				},
			},
		},
	}

	result, err := p.Parse(data, 300)
	require.NoError(t, err)

	// Verify entity definition
	require.Len(t, result.Entities, 1)
	ent := result.Entities[0]
	assert.Equal(t, uint32(14), ent.EndFrame, "last sparse range end")

	// Verify positions were expanded from 2 sparse entries to 15 dense entries
	require.Len(t, result.EntityPositions, 1)
	ep := result.EntityPositions[0]
	require.Len(t, ep.Positions, 15, "frames 0-14 expanded from sparse")

	// Verify frame 0 (first sparse range)
	pos := ep.Positions[0]
	assert.Equal(t, uint32(0), pos.FrameNum)
	assert.Equal(t, float32(5000.0), pos.PosX)
	assert.Equal(t, float32(6000.0), pos.PosY)
	assert.Equal(t, uint32(45), pos.Direction)
	assert.Equal(t, uint32(1), pos.Alive)

	// Verify frame 5 (middle of first sparse range - should have same data)
	pos = ep.Positions[5]
	assert.Equal(t, uint32(5), pos.FrameNum)
	assert.Equal(t, float32(5000.0), pos.PosX)
	assert.Equal(t, float32(6000.0), pos.PosY)

	// Verify frame 9 (end of first sparse range)
	pos = ep.Positions[9]
	assert.Equal(t, uint32(9), pos.FrameNum)
	assert.Equal(t, float32(5000.0), pos.PosX)

	// Verify frame 10 (start of second sparse range - different position)
	pos = ep.Positions[10]
	assert.Equal(t, uint32(10), pos.FrameNum)
	assert.Equal(t, float32(5010.0), pos.PosX)
	assert.Equal(t, float32(6010.0), pos.PosY)
	assert.Equal(t, uint32(90), pos.Direction)
	assert.Equal(t, []uint32{3}, pos.CrewIDs)

	// Verify frame 14 (end of second sparse range)
	pos = ep.Positions[14]
	assert.Equal(t, uint32(14), pos.FrameNum)
	assert.Equal(t, float32(5010.0), pos.PosX)
}

func TestParserV1_Parse_VehicleSparsePositions_ChunkBuild(t *testing.T) {
	// Verify that sparse vehicle positions produce correct chunk data
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
	require.NoError(t, err)

	// Build a chunk and verify entity is present in EVERY frame
	chunk := w.buildChunk(result, 0)
	require.Len(t, chunk.Frames, 10)

	for i, frame := range chunk.Frames {
		require.Len(t, frame.Entities, 1, "Frame %d: static vehicle should be present in every frame", i)
		ent := frame.Entities[0]
		assert.Equal(t, uint32(2), ent.EntityId, "Frame %d", i)
		assert.Equal(t, float32(1000.0), ent.PosX, "Frame %d", i)
		assert.Equal(t, float32(2000.0), ent.PosY, "Frame %d", i)
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
	require.NoError(t, err)

	ep := result.EntityPositions[0]
	require.Len(t, ep.Positions, 3, "dense, unchanged")

	// Verify sequential frame numbers
	for i, pos := range ep.Positions {
		assert.Equal(t, uint32(i), pos.FrameNum, "Positions[%d].FrameNum", i)
	}

	// Verify end frame uses dense calculation
	ent := result.Entities[0]
	assert.Equal(t, uint32(2), ent.EndFrame) // 0 + 3 - 1
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
		assert.Equal(t, uint32(999), endFrame, "from last sparse range")
	})
}

func TestParserV1_parseFramesFired(t *testing.T) {
	p := &ParserV1{}

	t.Run("no framesFired key returns nil", func(t *testing.T) {
		em := map[string]interface{}{}
		result := p.parseFramesFired(em)
		assert.Nil(t, result)
	})

	t.Run("framesFired wrong type returns nil", func(t *testing.T) {
		em := map[string]interface{}{
			"framesFired": "not an array",
		}
		result := p.parseFramesFired(em)
		assert.Nil(t, result)
	})

	t.Run("empty framesFired array", func(t *testing.T) {
		em := map[string]interface{}{
			"framesFired": []interface{}{},
		}
		result := p.parseFramesFired(em)
		require.NotNil(t, result)
		assert.Empty(t, result)
	})

	t.Run("valid fired frame with [x, y, z]", func(t *testing.T) {
		em := map[string]interface{}{
			"framesFired": []interface{}{
				[]interface{}{10.0, []interface{}{100.0, 200.0, 5.0}},
			},
		}
		result := p.parseFramesFired(em)
		require.Len(t, result, 1)
		assert.Equal(t, uint32(10), result[0].FrameNum)
		assert.Equal(t, float32(100.0), result[0].PosX)
		assert.Equal(t, float32(200.0), result[0].PosY)
		assert.Equal(t, float32(5.0), result[0].PosZ)
	})

	t.Run("valid fired frame with [x, y] only", func(t *testing.T) {
		em := map[string]interface{}{
			"framesFired": []interface{}{
				[]interface{}{20.0, []interface{}{300.0, 400.0}},
			},
		}
		result := p.parseFramesFired(em)
		require.Len(t, result, 1)
		assert.Equal(t, uint32(20), result[0].FrameNum)
		assert.Equal(t, float32(300.0), result[0].PosX)
		assert.Equal(t, float32(400.0), result[0].PosY)
		assert.Equal(t, float32(0.0), result[0].PosZ)
	})

	t.Run("multiple fired frames", func(t *testing.T) {
		em := map[string]interface{}{
			"framesFired": []interface{}{
				[]interface{}{5.0, []interface{}{100.0, 200.0, 0.0}},
				[]interface{}{15.0, []interface{}{150.0, 250.0, 1.0}},
				[]interface{}{25.0, []interface{}{200.0, 300.0, 2.0}},
			},
		}
		result := p.parseFramesFired(em)
		require.Len(t, result, 3)
		assert.Equal(t, uint32(5), result[0].FrameNum)
		assert.Equal(t, uint32(15), result[1].FrameNum)
		assert.Equal(t, uint32(25), result[2].FrameNum)
	})

	t.Run("invalid entry not an array is skipped", func(t *testing.T) {
		em := map[string]interface{}{
			"framesFired": []interface{}{
				"not an array",
				[]interface{}{10.0, []interface{}{100.0, 200.0, 0.0}},
			},
		}
		result := p.parseFramesFired(em)
		require.Len(t, result, 1)
		assert.Equal(t, uint32(10), result[0].FrameNum)
	})

	t.Run("entry too short is skipped", func(t *testing.T) {
		em := map[string]interface{}{
			"framesFired": []interface{}{
				[]interface{}{10.0}, // Only 1 element, need 2
				[]interface{}{20.0, []interface{}{100.0, 200.0, 0.0}},
			},
		}
		result := p.parseFramesFired(em)
		require.Len(t, result, 1)
		assert.Equal(t, uint32(20), result[0].FrameNum)
	})

	t.Run("position not an array", func(t *testing.T) {
		em := map[string]interface{}{
			"framesFired": []interface{}{
				[]interface{}{10.0, "not a pos array"},
			},
		}
		result := p.parseFramesFired(em)
		require.Len(t, result, 1)
		// FrameNum is parsed but position stays zero
		assert.Equal(t, uint32(10), result[0].FrameNum)
		assert.Equal(t, float32(0.0), result[0].PosX)
		assert.Equal(t, float32(0.0), result[0].PosY)
	})

	t.Run("position array too short", func(t *testing.T) {
		em := map[string]interface{}{
			"framesFired": []interface{}{
				[]interface{}{10.0, []interface{}{100.0}}, // Only 1 coord
			},
		}
		result := p.parseFramesFired(em)
		require.Len(t, result, 1)
		assert.Equal(t, float32(0.0), result[0].PosX, "not enough coords")
	})

	t.Run("entity with framesFired through Parse", func(t *testing.T) {
		data := map[string]interface{}{
			"worldName":    "Altis",
			"missionName":  "Test",
			"endFrame":     10.0,
			"captureDelay": 1.0,
			"entities": []interface{}{
				map[string]interface{}{
					"id":            0.0,
					"type":          "unit",
					"name":          "Shooter",
					"startFrameNum": 0.0,
					"positions": []interface{}{
						[]interface{}{[]interface{}{100.0, 200.0, 0.0}, 90.0, 1.0, 0.0, "Shooter", 1.0},
					},
					"framesFired": []interface{}{
						[]interface{}{3.0, []interface{}{100.0, 200.0, 5.0}},
						[]interface{}{7.0, []interface{}{105.0, 205.0, 5.0}},
					},
				},
			},
		}
		result, err := p.Parse(data, 100)
		require.NoError(t, err)
		require.Len(t, result.Entities, 1)
		require.Len(t, result.Entities[0].FramesFired, 2)
		assert.Equal(t, uint32(3), result.Entities[0].FramesFired[0].FrameNum)
		assert.Equal(t, uint32(7), result.Entities[0].FramesFired[1].FrameNum)
		assert.Equal(t, float32(100.0), result.Entities[0].FramesFired[0].PosX)
	})
}

func TestParserV1_collectEntityPositions_EdgeCases(t *testing.T) {
	p := &ParserV1{}

	t.Run("no positions key", func(t *testing.T) {
		em := map[string]interface{}{}
		result := p.collectEntityPositions(em, 0, 0, "unit")
		assert.Nil(t, result)
	})

	t.Run("positions wrong type", func(t *testing.T) {
		em := map[string]interface{}{
			"positions": "not an array",
		}
		result := p.collectEntityPositions(em, 0, 0, "unit")
		assert.Nil(t, result)
	})

	t.Run("position entry too short", func(t *testing.T) {
		em := map[string]interface{}{
			"positions": []interface{}{
				[]interface{}{[]interface{}{100.0, 200.0}}, // Only 1 element, need at least 3
			},
		}
		result := p.collectEntityPositions(em, 0, 0, "unit")
		require.NotNil(t, result)
		// Entry should be skipped
		assert.Empty(t, result.Positions)
	})
}
