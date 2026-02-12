// server/storage/converter_test.go
package storage

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/proto"

	pbv1 "github.com/OCAP2/web/pkg/schemas/protobuf/v1"
)

func TestConverter_Convert(t *testing.T) {
	// Create temp directories
	tmpDir := t.TempDir()
	inputPath := filepath.Join(tmpDir, "test.json")
	outputPath := filepath.Join(tmpDir, "output")

	// Create test JSON data
	testData := map[string]interface{}{
		"worldName":    "Altis",
		"missionName":  "Test Mission",
		"endFrame":     10,
		"captureDelay": 1.0,
		"entities": []interface{}{
			map[string]interface{}{
				"id":            0,
				"type":          "unit",
				"name":          "Player1",
				"side":          "WEST",
				"group":         "Alpha",
				"role":          "Rifleman",
				"startFrameNum": 0,
				"isPlayer":      1.0,
				"positions": []interface{}{
					// Frame 0: [[x, y, z], direction, alive, isInVehicle, "name", isPlayer]
					[]interface{}{[]interface{}{100.0, 200.0, 0.0}, 90.0, 1.0, 0.0, "Player1", 1.0},
					[]interface{}{[]interface{}{101.0, 201.0, 0.0}, 91.0, 1.0, 0.0, "Player1", 1.0},
					[]interface{}{[]interface{}{102.0, 202.0, 0.0}, 92.0, 1.0, 0.0, "Player1", 1.0},
					[]interface{}{[]interface{}{103.0, 203.0, 0.0}, 93.0, 1.0, 0.0, "Player1", 1.0},
					[]interface{}{[]interface{}{104.0, 204.0, 0.0}, 94.0, 1.0, 0.0, "Player1", 1.0},
					[]interface{}{[]interface{}{105.0, 205.0, 0.0}, 95.0, 1.0, 0.0, "Player1", 1.0},
					[]interface{}{[]interface{}{106.0, 206.0, 0.0}, 96.0, 1.0, 0.0, "Player1", 1.0},
					[]interface{}{[]interface{}{107.0, 207.0, 0.0}, 97.0, 1.0, 0.0, "Player1", 1.0},
					[]interface{}{[]interface{}{108.0, 208.0, 0.0}, 98.0, 0.0, 0.0, "Player1", 1.0}, // Dead
					[]interface{}{[]interface{}{108.0, 208.0, 0.0}, 98.0, 0.0, 0.0, "Player1", 1.0},
				},
			},
			map[string]interface{}{
				"id":            1,
				"type":          "vehicle",
				"name":          "Truck",
				"class":         "B_Truck_01",
				"startFrameNum": 0,
				"positions": []interface{}{
					// Frame 0: [[x, y, z], direction, alive, [crew_ids]]
					[]interface{}{[]interface{}{500.0, 600.0, 0.0}, 180.0, 1.0, []interface{}{}},
					[]interface{}{[]interface{}{500.0, 600.0, 0.0}, 180.0, 1.0, []interface{}{}},
					[]interface{}{[]interface{}{500.0, 600.0, 0.0}, 180.0, 1.0, []interface{}{}},
					[]interface{}{[]interface{}{500.0, 600.0, 0.0}, 180.0, 1.0, []interface{}{0.0}}, // Player entered
					[]interface{}{[]interface{}{510.0, 610.0, 0.0}, 185.0, 1.0, []interface{}{0.0}},
					[]interface{}{[]interface{}{520.0, 620.0, 0.0}, 190.0, 1.0, []interface{}{0.0}},
					[]interface{}{[]interface{}{530.0, 630.0, 0.0}, 195.0, 1.0, []interface{}{}}, // Player exited
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
			[]interface{}{"ICON", "Alpha", 0.0, 10.0, 0.0, "ColorBlufor", 0.0, []interface{}{[]interface{}{100.0, 200.0, 0.0}}, []interface{}{1.0, 1.0}, "ICON", "Solid"},
		},
		"times": []interface{}{
			map[string]interface{}{
				"frameNum":       0.0,
				"systemTimeUTC":  "2035-06-10T10:00:00",
				"date":           "2035-06-10",
				"time":           0.0,
				"timeMultiplier": 1.0,
			},
		},
	}

	// Write test JSON
	jsonData, err := json.Marshal(testData)
	require.NoError(t, err, "marshal test data")
	require.NoError(t, os.WriteFile(inputPath, jsonData, 0644), "write test JSON")

	// Convert with small chunk size for testing
	converter := NewConverter(5) // 5 frames per chunk
	ctx := context.Background()
	require.NoError(t, converter.Convert(ctx, inputPath, outputPath, "protobuf"), "convert")

	// Verify manifest was created
	manifestPath := filepath.Join(outputPath, "manifest.pb")
	manifestData, err := os.ReadFile(manifestPath)
	require.NoError(t, err, "read manifest")

	var manifest pbv1.Manifest
	require.NoError(t, proto.Unmarshal(manifestData, &manifest), "unmarshal manifest")

	// Verify manifest content
	assert.Equal(t, "Altis", manifest.WorldName)
	assert.Equal(t, "Test Mission", manifest.MissionName)
	assert.Equal(t, uint32(10), manifest.FrameCount)
	assert.Equal(t, uint32(5), manifest.ChunkSize)
	assert.Equal(t, uint32(2), manifest.ChunkCount)
	assert.Equal(t, uint32(1000), manifest.CaptureDelayMs)
	require.Len(t, manifest.Entities, 2)

	// Verify first entity
	ent := manifest.Entities[0]
	assert.Equal(t, uint32(0), ent.Id)
	assert.Equal(t, pbv1.EntityType_ENTITY_TYPE_UNIT, ent.Type)
	assert.Equal(t, "Player1", ent.Name)
	assert.Equal(t, pbv1.Side_SIDE_WEST, ent.Side)
	assert.True(t, ent.IsPlayer)

	// Verify second entity (vehicle)
	ent = manifest.Entities[1]
	assert.Equal(t, pbv1.EntityType_ENTITY_TYPE_VEHICLE, ent.Type)
	assert.Equal(t, "B_Truck_01", ent.VehicleClass)

	// Verify events
	require.Len(t, manifest.Events, 1)
	assert.Equal(t, uint32(8), manifest.Events[0].FrameNum)
	assert.Equal(t, "killed", manifest.Events[0].Type)

	// Verify markers
	assert.Len(t, manifest.Markers, 1)

	// Verify times
	assert.Len(t, manifest.Times, 1)

	// Verify chunks were created
	chunk0Path := filepath.Join(outputPath, "chunks", "0000.pb")
	chunk1Path := filepath.Join(outputPath, "chunks", "0001.pb")

	assert.FileExists(t, chunk0Path)
	assert.FileExists(t, chunk1Path)

	// Read and verify chunk 0
	chunk0Data, err := os.ReadFile(chunk0Path)
	require.NoError(t, err, "read chunk 0")

	var chunk0 pbv1.Chunk
	require.NoError(t, proto.Unmarshal(chunk0Data, &chunk0), "unmarshal chunk 0")

	assert.Equal(t, uint32(0), chunk0.Index)
	assert.Equal(t, uint32(0), chunk0.StartFrame)
	assert.Equal(t, uint32(5), chunk0.FrameCount)
	require.Len(t, chunk0.Frames, 5)

	// Verify first frame has entities
	frame0 := chunk0.Frames[0]
	assert.Equal(t, uint32(0), frame0.FrameNum)
	require.Len(t, frame0.Entities, 2)

	// Verify first entity state
	state := frame0.Entities[0]
	assert.Equal(t, uint32(0), state.EntityId)
	assert.Equal(t, float32(100.0), state.PosX)
	assert.Equal(t, float32(200.0), state.PosY)
	assert.Equal(t, uint32(90), state.Direction)
	assert.Equal(t, uint32(1), state.Alive)

	// Read and verify chunk 1
	chunk1Data, err := os.ReadFile(chunk1Path)
	require.NoError(t, err, "read chunk 1")

	var chunk1 pbv1.Chunk
	require.NoError(t, proto.Unmarshal(chunk1Data, &chunk1), "unmarshal chunk 1")

	assert.Equal(t, uint32(1), chunk1.Index)
	assert.Equal(t, uint32(5), chunk1.StartFrame)
	assert.Equal(t, uint32(5), chunk1.FrameCount)
}

func TestConverter_ConvertGzipped(t *testing.T) {
	tmpDir := t.TempDir()
	inputPath := filepath.Join(tmpDir, "test.json.gz")
	outputPath := filepath.Join(tmpDir, "output")

	// Create test JSON data
	testData := map[string]interface{}{
		"worldName":    "Stratis",
		"missionName":  "Gzip Test",
		"endFrame":     5,
		"captureDelay": 1.0,
		"entities":     []interface{}{},
		"events":       []interface{}{},
		"Markers":      []interface{}{},
		"times":        []interface{}{},
	}

	// Write gzipped JSON
	jsonData, err := json.Marshal(testData)
	require.NoError(t, err, "marshal test data")

	f, err := os.Create(inputPath)
	require.NoError(t, err, "create gzip file")
	defer f.Close()

	gw := gzip.NewWriter(f)
	_, err = gw.Write(jsonData)
	require.NoError(t, err, "write gzip")
	require.NoError(t, gw.Close())

	// Convert
	converter := NewConverter(DefaultChunkSize)
	ctx := context.Background()
	require.NoError(t, converter.Convert(ctx, inputPath, outputPath, "protobuf"), "convert")

	// Verify manifest
	manifestPath := filepath.Join(outputPath, "manifest.pb")
	manifestData, err := os.ReadFile(manifestPath)
	require.NoError(t, err, "read manifest")

	var manifest pbv1.Manifest
	require.NoError(t, proto.Unmarshal(manifestData, &manifest), "unmarshal manifest")

	assert.Equal(t, "Stratis", manifest.WorldName)
}

func TestConverter_ContextCancellation(t *testing.T) {
	tmpDir := t.TempDir()
	inputPath := filepath.Join(tmpDir, "test.json")
	outputPath := filepath.Join(tmpDir, "output")

	// Create test JSON with many frames
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
	require.NoError(t, err, "marshal test data")
	require.NoError(t, os.WriteFile(inputPath, jsonData, 0644), "write test JSON")

	// Create cancelled context
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	converter := NewConverter(10)
	err = converter.Convert(ctx, inputPath, outputPath, "protobuf")
	assert.Error(t, err, "expected error from cancelled context")
}

func TestConverter_VehicleCrew(t *testing.T) {
	tmpDir := t.TempDir()
	inputPath := filepath.Join(tmpDir, "test.json")
	outputPath := filepath.Join(tmpDir, "output")

	// Create test data with vehicle containing crew
	testData := map[string]interface{}{
		"worldName":    "Altis",
		"missionName":  "Crew Test",
		"endFrame":     3,
		"captureDelay": 1.0,
		"entities": []interface{}{
			map[string]interface{}{
				"id":            0,
				"type":          "unit",
				"name":          "Driver",
				"side":          "WEST",
				"startFrameNum": 0,
				"isPlayer":      1.0,
				"positions": []interface{}{
					[]interface{}{[]interface{}{100.0, 200.0, 0.0}, 0.0, 1.0, 1.0, "Driver", 1.0}, // In vehicle (vehicleId=1)
					[]interface{}{[]interface{}{100.0, 200.0, 0.0}, 0.0, 1.0, 1.0, "Driver", 1.0},
					[]interface{}{[]interface{}{100.0, 200.0, 0.0}, 0.0, 1.0, 1.0, "Driver", 1.0},
				},
			},
			map[string]interface{}{
				"id":            1,
				"type":          "vehicle",
				"name":          "Tank",
				"class":         "B_MBT_01",
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
	require.NoError(t, err, "marshal test data")
	require.NoError(t, os.WriteFile(inputPath, jsonData, 0644), "write test JSON")

	converter := NewConverter(10)
	ctx := context.Background()
	require.NoError(t, converter.Convert(ctx, inputPath, outputPath, "protobuf"), "convert")

	// Read chunk and verify crew
	chunkPath := filepath.Join(outputPath, "chunks", "0000.pb")
	chunkData, err := os.ReadFile(chunkPath)
	require.NoError(t, err, "read chunk")

	var chunk pbv1.Chunk
	require.NoError(t, proto.Unmarshal(chunkData, &chunk), "unmarshal chunk")

	// Find vehicle state in first frame
	require.NotEmpty(t, chunk.Frames)
	for _, state := range chunk.Frames[0].Entities {
		if state.EntityId == 1 { // Vehicle
			require.Len(t, state.CrewIds, 1)
			assert.Equal(t, uint32(0), state.CrewIds[0])
		}
	}
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
		{"int", 42, 0.0}, // int is not float64
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

func TestConverter_UnknownInputVersion(t *testing.T) {
	tmpDir := t.TempDir()
	inputPath := filepath.Join(tmpDir, "test.json")
	outputPath := filepath.Join(tmpDir, "output")

	// Create invalid JSON data (missing required fields)
	testData := map[string]interface{}{
		"foo": "bar",
	}

	jsonData, err := json.Marshal(testData)
	require.NoError(t, err, "marshal test data")
	require.NoError(t, os.WriteFile(inputPath, jsonData, 0644), "write test JSON")

	converter := NewConverter(DefaultChunkSize)
	ctx := context.Background()
	err = converter.Convert(ctx, inputPath, outputPath, "protobuf")
	assert.Error(t, err, "expected error for unknown input version")
}

func TestConverter_InvalidFormat(t *testing.T) {
	tmpDir := t.TempDir()
	inputPath := filepath.Join(tmpDir, "test.json")
	outputPath := filepath.Join(tmpDir, "output")

	// Create valid JSON data
	testData := map[string]interface{}{
		"worldName":    "Altis",
		"missionName":  "Test",
		"endFrame":     5,
		"captureDelay": 1.0,
		"entities":     []interface{}{},
		"events":       []interface{}{},
		"Markers":      []interface{}{},
		"times":        []interface{}{},
	}

	jsonData, err := json.Marshal(testData)
	require.NoError(t, err, "marshal test data")
	require.NoError(t, os.WriteFile(inputPath, jsonData, 0644), "write test JSON")

	converter := NewConverter(DefaultChunkSize)
	ctx := context.Background()
	err = converter.Convert(ctx, inputPath, outputPath, "invalid_format")
	assert.Error(t, err, "expected error for invalid format")
}
