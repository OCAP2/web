package storage

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/proto"

	pbv1 "github.com/OCAP2/web/pkg/schemas/protobuf/v1"
)

func TestConverter_Convert(t *testing.T) {
	tmpDir := t.TempDir()
	inputPath := filepath.Join(tmpDir, "test.json")
	outputPath := filepath.Join(tmpDir, "output")

	testData := map[string]interface{}{
		"worldName":    "Altis",
		"missionName":  "Test Mission",
		"endFrame":     10,
		"captureDelay": 1.0,
		"entities": []interface{}{
			map[string]interface{}{
				"id": 0, "type": "unit", "name": "Player1", "side": "WEST",
				"group": "Alpha", "role": "Rifleman", "startFrameNum": 0, "isPlayer": 1.0,
				"positions": []interface{}{
					[]interface{}{[]interface{}{100.0, 200.0, 0.0}, 90.0, 1.0, 0.0, "Player1", 1.0},
					[]interface{}{[]interface{}{101.0, 201.0, 0.0}, 91.0, 1.0, 0.0, "Player1", 1.0},
					[]interface{}{[]interface{}{102.0, 202.0, 0.0}, 92.0, 1.0, 0.0, "Player1", 1.0},
					[]interface{}{[]interface{}{103.0, 203.0, 0.0}, 93.0, 1.0, 0.0, "Player1", 1.0},
					[]interface{}{[]interface{}{104.0, 204.0, 0.0}, 94.0, 1.0, 0.0, "Player1", 1.0},
					[]interface{}{[]interface{}{105.0, 205.0, 0.0}, 95.0, 1.0, 0.0, "Player1", 1.0},
					[]interface{}{[]interface{}{106.0, 206.0, 0.0}, 96.0, 1.0, 0.0, "Player1", 1.0},
					[]interface{}{[]interface{}{107.0, 207.0, 0.0}, 97.0, 1.0, 0.0, "Player1", 1.0},
					[]interface{}{[]interface{}{108.0, 208.0, 0.0}, 98.0, 0.0, 0.0, "Player1", 1.0},
					[]interface{}{[]interface{}{108.0, 208.0, 0.0}, 98.0, 0.0, 0.0, "Player1", 1.0},
				},
			},
			map[string]interface{}{
				"id": 1, "type": "vehicle", "name": "Truck", "class": "B_Truck_01",
				"startFrameNum": 0,
				"positions": []interface{}{
					[]interface{}{[]interface{}{500.0, 600.0, 0.0}, 180.0, 1.0, []interface{}{}},
					[]interface{}{[]interface{}{500.0, 600.0, 0.0}, 180.0, 1.0, []interface{}{}},
					[]interface{}{[]interface{}{500.0, 600.0, 0.0}, 180.0, 1.0, []interface{}{}},
					[]interface{}{[]interface{}{500.0, 600.0, 0.0}, 180.0, 1.0, []interface{}{0.0}},
					[]interface{}{[]interface{}{510.0, 610.0, 0.0}, 185.0, 1.0, []interface{}{0.0}},
					[]interface{}{[]interface{}{520.0, 620.0, 0.0}, 190.0, 1.0, []interface{}{0.0}},
					[]interface{}{[]interface{}{530.0, 630.0, 0.0}, 195.0, 1.0, []interface{}{}},
					[]interface{}{[]interface{}{530.0, 630.0, 0.0}, 195.0, 1.0, []interface{}{}},
					[]interface{}{[]interface{}{530.0, 630.0, 0.0}, 195.0, 1.0, []interface{}{}},
					[]interface{}{[]interface{}{530.0, 630.0, 0.0}, 195.0, 1.0, []interface{}{}},
				},
			},
		},
		"events": []interface{}{
			[]interface{}{8.0, "killed", 0.0, 0.0, "arifle_MX"},
		},
		"Markers": []interface{}{
			[]interface{}{"ICON", "Alpha", 0.0, 10.0, 0.0, "ColorBlufor", 0.0,
				[]interface{}{[]interface{}{100.0, 200.0, 0.0}}, []interface{}{1.0, 1.0}, "ICON", "Solid"},
		},
		"times": []interface{}{
			map[string]interface{}{
				"frameNum": 0.0, "systemTimeUTC": "2035-06-10T10:00:00",
				"date": "2035-06-10", "time": 0.0, "timeMultiplier": 1.0,
			},
		},
	}

	jsonData, err := json.Marshal(testData)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(inputPath, jsonData, 0644))

	ctx := context.Background()
	converter := NewConverter(5) // 5 frames per chunk
	require.NoError(t, converter.Convert(ctx, inputPath, outputPath))

	// Verify manifest
	manifest := readManifest(t, outputPath)
	assert.Equal(t, "Altis", manifest.WorldName)
	assert.Equal(t, "Test Mission", manifest.MissionName)
	assert.Equal(t, uint32(10), manifest.FrameCount)
	assert.Equal(t, uint32(5), manifest.ChunkSize)
	assert.Equal(t, uint32(2), manifest.ChunkCount)
	assert.Equal(t, uint32(1000), manifest.CaptureDelayMs)
	require.Len(t, manifest.Entities, 2)
	require.Len(t, manifest.Events, 1)
	assert.Len(t, manifest.Markers, 1)
	assert.Len(t, manifest.Times, 1)

	// Verify entity definitions
	assert.Equal(t, uint32(0), manifest.Entities[0].Id)
	assert.Equal(t, pbv1.EntityType_ENTITY_TYPE_UNIT, manifest.Entities[0].Type)
	assert.Equal(t, "Player1", manifest.Entities[0].Name)
	assert.Equal(t, pbv1.Side_SIDE_WEST, manifest.Entities[0].Side)
	assert.True(t, manifest.Entities[0].IsPlayer)

	assert.Equal(t, pbv1.EntityType_ENTITY_TYPE_VEHICLE, manifest.Entities[1].Type)
	assert.Equal(t, "B_Truck_01", manifest.Entities[1].VehicleClass)

	// Verify events
	assert.Equal(t, uint32(8), manifest.Events[0].FrameNum)
	assert.Equal(t, "killed", manifest.Events[0].Type)

	// Verify chunks
	chunk0 := readChunk(t, outputPath, 0)
	assert.Equal(t, uint32(0), chunk0.Index)
	assert.Equal(t, uint32(0), chunk0.StartFrame)
	assert.Equal(t, uint32(5), chunk0.FrameCount)
	require.Len(t, chunk0.Frames, 5)

	// First frame should have 2 entities
	require.Len(t, chunk0.Frames[0].Entities, 2)

	// Verify position data
	state := findEntityState(chunk0.Frames[0].Entities, 0)
	require.NotNil(t, state)
	assert.Equal(t, float32(100.0), state.PosX)
	assert.Equal(t, float32(200.0), state.PosY)
	assert.Equal(t, uint32(90), state.Direction)
	assert.Equal(t, uint32(1), state.Alive)

	chunk1 := readChunk(t, outputPath, 1)
	assert.Equal(t, uint32(1), chunk1.Index)
	assert.Equal(t, uint32(5), chunk1.StartFrame)
	assert.Equal(t, uint32(5), chunk1.FrameCount)
}

func TestConverter_VehicleCrew(t *testing.T) {
	tmpDir := t.TempDir()
	inputPath := filepath.Join(tmpDir, "test.json")
	outputPath := filepath.Join(tmpDir, "output")

	testData := map[string]interface{}{
		"worldName":    "Altis",
		"missionName":  "Crew Test",
		"endFrame":     3,
		"captureDelay": 1.0,
		"entities": []interface{}{
			map[string]interface{}{
				"id": 0, "type": "unit", "name": "Driver", "side": "WEST",
				"startFrameNum": 0, "isPlayer": 1.0,
				"positions": []interface{}{
					[]interface{}{[]interface{}{100.0, 200.0, 0.0}, 0.0, 1.0, 1.0, "Driver", 1.0},
					[]interface{}{[]interface{}{100.0, 200.0, 0.0}, 0.0, 1.0, 1.0, "Driver", 1.0},
					[]interface{}{[]interface{}{100.0, 200.0, 0.0}, 0.0, 1.0, 1.0, "Driver", 1.0},
				},
			},
			map[string]interface{}{
				"id": 1, "type": "vehicle", "name": "Tank", "class": "B_MBT_01",
				"startFrameNum": 0,
				"positions": []interface{}{
					[]interface{}{[]interface{}{500.0, 600.0, 0.0}, 180.0, 1.0, []interface{}{0.0}},
					[]interface{}{[]interface{}{505.0, 605.0, 0.0}, 180.0, 1.0, []interface{}{0.0}},
					[]interface{}{[]interface{}{510.0, 610.0, 0.0}, 180.0, 1.0, []interface{}{0.0}},
				},
			},
		},
		"events":  []interface{}{},
		"Markers": []interface{}{},
		"times":   []interface{}{},
	}

	jsonData, err := json.Marshal(testData)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(inputPath, jsonData, 0644))

	converter := NewConverter(10)
	require.NoError(t, converter.Convert(context.Background(), inputPath, outputPath))

	chunk := readChunk(t, outputPath, 0)
	require.NotEmpty(t, chunk.Frames)
	for _, state := range chunk.Frames[0].Entities {
		if state.EntityId == 1 { // Vehicle
			require.Len(t, state.CrewIds, 1)
			assert.Equal(t, uint32(0), state.CrewIds[0])
		}
	}
}

func TestConverter_ContextCancellation(t *testing.T) {
	tmpDir := t.TempDir()
	inputPath := filepath.Join(tmpDir, "test.json")
	outputPath := filepath.Join(tmpDir, "output")

	testData := map[string]interface{}{
		"worldName":    "Altis",
		"missionName":  "Cancel Test",
		"endFrame":     1000,
		"captureDelay": 1.0,
		"entities":     []interface{}{},
		"events":       []interface{}{},
		"Markers":      []interface{}{},
		"times":        []interface{}{},
	}

	jsonData, err := json.Marshal(testData)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(inputPath, jsonData, 0644))

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	converter := NewConverter(10)
	err = converter.Convert(ctx, inputPath, outputPath)
	assert.Error(t, err)
}

func TestNewConverter_DefaultChunkSize(t *testing.T) {
	converter := NewConverter(0)
	assert.Equal(t, uint32(DefaultChunkSize), converter.ChunkSize)

	converter2 := NewConverter(100)
	assert.Equal(t, uint32(100), converter2.ChunkSize)
}

func TestToFloat64(t *testing.T) {
	tests := []struct {
		name  string
		input interface{}
		want  float64
	}{
		{"float64", 42.5, 42.5},
		{"zero", 0.0, 0.0},
		{"negative", -10.5, -10.5},
		{"string", "not a number", 0.0},
		{"int", 42, 0.0},
		{"nil", nil, 0.0},
		{"bool", true, 0.0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, toFloat64(tt.input))
		})
	}
}

func TestToString(t *testing.T) {
	tests := []struct {
		name  string
		input interface{}
		want  string
	}{
		{"string", "hello", "hello"},
		{"empty string", "", ""},
		{"float64", 42.5, ""},
		{"int", 42, ""},
		{"nil", nil, ""},
		{"bool", true, ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, toString(tt.input))
		})
	}
}

// TestConverter_AllEventTypes verifies that ALL event types survive the full
// JSON → Protobuf roundtrip with correct data.
func TestConverter_AllEventTypes(t *testing.T) {
	tmpDir := t.TempDir()
	inputPath := filepath.Join(tmpDir, "test.json")
	outputPath := filepath.Join(tmpDir, "output")

	testData := map[string]interface{}{
		"worldName":    "Altis",
		"missionName":  "Event Roundtrip Test",
		"endFrame":     400.0,
		"captureDelay": 1.0,
		"entities": []interface{}{
			map[string]interface{}{
				"id": 0.0, "type": "unit", "name": "Player1", "side": "WEST",
				"startFrameNum": 0.0, "isPlayer": 1.0,
				"positions": []interface{}{
					[]interface{}{[]interface{}{100.0, 200.0, 0.0}, 90.0, 1.0, 0.0, "Player1", 1.0},
				},
			},
		},
		"events": []interface{}{
			[]interface{}{0.0, "generalEvent", "Recording started."},
			[]interface{}{0.0, "generalEvent", "Mission has started!"},
			[]interface{}{0.0, "respawnTickets", []interface{}{-1.0, -1.0, -1.0, -1.0}},
			[]interface{}{30.0, "respawnTickets", []interface{}{-1.0, -1.0, -1.0, -1.0}},
			[]interface{}{376.0, "generalEvent", "Recording paused."},
			[]interface{}{376.0, "endMission", []interface{}{"WEST", "Mission complete"}},
			[]interface{}{376.0, "endMission", ""},
			[]interface{}{1.0, "killed", 0.0, []interface{}{0.0, "Katiba 6.5 mm [6.5 mm 30Rnd Caseless Mag]"}, 0.0},
			[]interface{}{125.0, "killed", 9.0, []interface{}{0.0, "Katiba 6.5 mm [6.5 mm 30Rnd Caseless Mag]"}, 74.0},
			[]interface{}{50.0, "hit", 0.0, []interface{}{0.0, "pistol"}, 25.0},
			[]interface{}{0.0, "connected", "[RMC] DoS"},
			[]interface{}{300.0, "disconnected", "[VRG] mEss1a"},
			[]interface{}{200.0, "captured", []interface{}{"Player1", "blue", "flag_carrier"}},
			[]interface{}{210.0, "capturedFlag", []interface{}{"Player1", "blue", "somePos", "anotherPos"}},
			[]interface{}{220.0, "terminalHackStarted", []interface{}{"Player1", "blue", "red", "terminal_1"}},
			[]interface{}{230.0, "terminalHackCanceled", []interface{}{"Player1", "blue", "red", "terminal_1"}},
		},
		"Markers": []interface{}{},
		"times":   []interface{}{},
	}

	jsonData, err := json.Marshal(testData)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(inputPath, jsonData, 0644))

	converter := NewConverter(DefaultChunkSize)
	require.NoError(t, converter.Convert(context.Background(), inputPath, outputPath))

	manifest := readManifest(t, outputPath)
	events := manifest.Events
	require.Len(t, events, 16, "all 16 events must survive roundtrip")

	findEvents := func(typ string) []*pbv1.Event {
		var result []*pbv1.Event
		for _, e := range events {
			if e.Type == typ {
				result = append(result, e)
			}
		}
		return result
	}

	// generalEvent
	generals := findEvents("generalEvent")
	require.Len(t, generals, 3)
	generalMessages := make([]string, len(generals))
	for i, g := range generals {
		generalMessages[i] = g.Message
	}
	assert.Contains(t, generalMessages, "Recording started.")
	assert.Contains(t, generalMessages, "Mission has started!")
	assert.Contains(t, generalMessages, "Recording paused.")

	// respawnTickets
	tickets := findEvents("respawnTickets")
	require.Len(t, tickets, 2)

	// endMission
	endMissions := findEvents("endMission")
	require.Len(t, endMissions, 2)

	// killed
	killed := findEvents("killed")
	require.Len(t, killed, 2)
	assert.Equal(t, uint32(1), killed[0].FrameNum)
	assert.Equal(t, "Katiba 6.5 mm [6.5 mm 30Rnd Caseless Mag]", killed[0].Weapon)
	assert.Equal(t, uint32(125), killed[1].FrameNum)
	assert.Equal(t, float32(74.0), killed[1].Distance)

	// hit
	hits := findEvents("hit")
	require.Len(t, hits, 1)
	assert.Equal(t, "pistol", hits[0].Weapon)

	// connected / disconnected
	assert.Len(t, findEvents("connected"), 1)
	assert.Len(t, findEvents("disconnected"), 1)

	// captured / capturedFlag
	assert.Len(t, findEvents("captured"), 1)
	assert.Len(t, findEvents("capturedFlag"), 1)

	// terminal events
	assert.Len(t, findEvents("terminalHackStarted"), 1)
	assert.Len(t, findEvents("terminalHackCanceled"), 1)
}

func TestConverter_FramesFired(t *testing.T) {
	tmpDir := t.TempDir()
	inputPath := filepath.Join(tmpDir, "test.json")
	outputPath := filepath.Join(tmpDir, "output")

	testData := map[string]interface{}{
		"worldName":    "Altis",
		"missionName":  "FramesFired Test",
		"endFrame":     3,
		"captureDelay": 1.0,
		"entities": []interface{}{
			map[string]interface{}{
				"id": 0.0, "type": "unit", "name": "Shooter", "side": "WEST",
				"startFrameNum": 0.0, "isPlayer": 1.0,
				"positions": []interface{}{
					[]interface{}{[]interface{}{100.0, 200.0, 5.0}, 90.0, 1.0, 0.0, "Shooter", 1.0},
					[]interface{}{[]interface{}{101.0, 201.0, 5.0}, 91.0, 1.0, 0.0, "Shooter", 1.0},
					[]interface{}{[]interface{}{102.0, 202.0, 5.0}, 92.0, 1.0, 0.0, "Shooter", 1.0},
				},
				"framesFired": []interface{}{
					[]interface{}{1.0, []interface{}{101.0, 201.0, 5.0}},
					[]interface{}{2.0, []interface{}{102.0, 202.0, 5.0}},
				},
			},
		},
		"events":  []interface{}{},
		"Markers": []interface{}{},
		"times":   []interface{}{},
	}

	jsonData, err := json.Marshal(testData)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(inputPath, jsonData, 0644))

	converter := NewConverter(10)
	require.NoError(t, converter.Convert(context.Background(), inputPath, outputPath))

	manifest := readManifest(t, outputPath)
	require.Len(t, manifest.Entities, 1)
	require.Len(t, manifest.Entities[0].FramesFired, 2)
	assert.Equal(t, uint32(1), manifest.Entities[0].FramesFired[0].FrameNum)
	assert.Equal(t, float32(101.0), manifest.Entities[0].FramesFired[0].PosX)
	assert.Equal(t, float32(201.0), manifest.Entities[0].FramesFired[0].PosY)
	assert.Equal(t, float32(5.0), manifest.Entities[0].FramesFired[0].PosZ)
}

func TestConverter_MissingRequiredFields(t *testing.T) {
	tests := []struct {
		name string
		data map[string]interface{}
	}{
		{
			name: "missing worldName",
			data: map[string]interface{}{
				"missionName": "Test", "endFrame": 5.0,
				"entities": []interface{}{}, "events": []interface{}{},
				"Markers": []interface{}{}, "times": []interface{}{},
			},
		},
		{
			name: "missing missionName",
			data: map[string]interface{}{
				"worldName": "Altis", "endFrame": 5.0,
				"entities": []interface{}{}, "events": []interface{}{},
				"Markers": []interface{}{}, "times": []interface{}{},
			},
		},
		{
			name: "missing endFrame",
			data: map[string]interface{}{
				"worldName": "Altis", "missionName": "Test",
				"entities": []interface{}{}, "events": []interface{}{},
				"Markers": []interface{}{}, "times": []interface{}{},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tmpDir := t.TempDir()
			inputPath := filepath.Join(tmpDir, "test.json")
			outputPath := filepath.Join(tmpDir, "output")

			jsonData, err := json.Marshal(tt.data)
			require.NoError(t, err)
			require.NoError(t, os.WriteFile(inputPath, jsonData, 0644))

			converter := NewConverter(10)
			err = converter.Convert(context.Background(), inputPath, outputPath)
			assert.Error(t, err)
			assert.Contains(t, err.Error(), "missing required fields")
		})
	}
}

func TestConverter_InvalidInputPath(t *testing.T) {
	converter := NewConverter(10)
	err := converter.Convert(context.Background(), "/nonexistent/input.json", t.TempDir())
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "open JSON")
}

func TestConverter_MetadataPassthrough(t *testing.T) {
	tmpDir := t.TempDir()
	inputPath := filepath.Join(tmpDir, "test.json")
	outputPath := filepath.Join(tmpDir, "output")

	testData := map[string]interface{}{
		"worldName":        "Stratis",
		"missionName":      "Meta Test",
		"endFrame":         2.0,
		"captureDelay":     0.5,
		"extensionVersion": "1.2.3",
		"addonVersion":     "4.5.6",
		"entities": []interface{}{
			map[string]interface{}{
				"id": 0.0, "type": "unit", "name": "P1", "side": "WEST",
				"startFrameNum": 0.0, "isPlayer": 1.0,
				"positions": []interface{}{
					[]interface{}{[]interface{}{100.0, 200.0, 0.0}, 90.0, 1.0, 0.0, "P1", 1.0},
					[]interface{}{[]interface{}{101.0, 201.0, 0.0}, 91.0, 1.0, 0.0, "P1", 1.0},
				},
			},
		},
		"events":  []interface{}{},
		"Markers": []interface{}{},
		"times":   []interface{}{},
	}

	jsonData, err := json.Marshal(testData)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(inputPath, jsonData, 0644))

	converter := NewConverter(10)
	require.NoError(t, converter.Convert(context.Background(), inputPath, outputPath))

	manifest := readManifest(t, outputPath)
	assert.Equal(t, "Stratis", manifest.WorldName)
	assert.Equal(t, "Meta Test", manifest.MissionName)
	assert.Equal(t, uint32(500), manifest.CaptureDelayMs)
	assert.Equal(t, "1.2.3", manifest.ExtensionVersion)
	assert.Equal(t, "4.5.6", manifest.AddonVersion)
}

func TestConverter_EntityContextCancellation(t *testing.T) {
	tmpDir := t.TempDir()
	inputPath := filepath.Join(tmpDir, "test.json")
	outputPath := filepath.Join(tmpDir, "output")

	// Create many entities so cancellation has a chance to trigger in OnEntity
	entities := make([]interface{}, 100)
	for i := range entities {
		entities[i] = map[string]interface{}{
			"id": float64(i), "type": "unit", "name": fmt.Sprintf("P%d", i), "side": "WEST",
			"startFrameNum": 0.0, "isPlayer": 0.0,
			"positions": []interface{}{
				[]interface{}{[]interface{}{100.0, 200.0, 0.0}, 90.0, 1.0, 0.0, fmt.Sprintf("P%d", i), 0.0},
			},
		}
	}

	testData := map[string]interface{}{
		"worldName": "Altis", "missionName": "Cancel Entity Test", "endFrame": 1.0,
		"captureDelay": 1.0, "entities": entities,
		"events": []interface{}{}, "Markers": []interface{}{}, "times": []interface{}{},
	}

	jsonData, err := json.Marshal(testData)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(inputPath, jsonData, 0644))

	// Cancel immediately — should trigger ctx.Err() in OnEntity
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	converter := NewConverter(10)
	err = converter.Convert(ctx, inputPath, outputPath)
	assert.Error(t, err)
}

func findEntityState(states []*pbv1.EntityState, entityID uint32) *pbv1.EntityState {
	for _, s := range states {
		if s.EntityId == entityID {
			return s
		}
	}
	return nil
}

func readManifest(t *testing.T, outputPath string) *pbv1.Manifest {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(outputPath, "manifest.pb"))
	require.NoError(t, err)
	var m pbv1.Manifest
	require.NoError(t, proto.Unmarshal(data, &m))
	return &m
}

func readChunk(t *testing.T, outputPath string, idx uint32) *pbv1.Chunk {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(outputPath, "chunks", fmt.Sprintf("%04d.pb", idx)))
	require.NoError(t, err)
	var c pbv1.Chunk
	require.NoError(t, proto.Unmarshal(data, &c))
	return &c
}
