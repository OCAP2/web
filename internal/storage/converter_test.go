// server/storage/converter_test.go
package storage

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

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
	if err != nil {
		t.Fatalf("marshal test data: %v", err)
	}
	if err := os.WriteFile(inputPath, jsonData, 0644); err != nil {
		t.Fatalf("write test JSON: %v", err)
	}

	// Convert with small chunk size for testing
	converter := NewConverter(5) // 5 frames per chunk
	ctx := context.Background()
	if err := converter.Convert(ctx, inputPath, outputPath, "protobuf"); err != nil {
		t.Fatalf("convert: %v", err)
	}

	// Verify manifest was created
	manifestPath := filepath.Join(outputPath, "manifest.pb")
	manifestData, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatalf("read manifest: %v", err)
	}

	var manifest pbv1.Manifest
	if err := proto.Unmarshal(manifestData, &manifest); err != nil {
		t.Fatalf("unmarshal manifest: %v", err)
	}

	// Verify manifest content
	if manifest.WorldName != "Altis" {
		t.Errorf("WorldName = %q, want %q", manifest.WorldName, "Altis")
	}
	if manifest.MissionName != "Test Mission" {
		t.Errorf("MissionName = %q, want %q", manifest.MissionName, "Test Mission")
	}
	if manifest.FrameCount != 10 {
		t.Errorf("FrameCount = %d, want %d", manifest.FrameCount, 10)
	}
	if manifest.ChunkSize != 5 {
		t.Errorf("ChunkSize = %d, want %d", manifest.ChunkSize, 5)
	}
	if manifest.ChunkCount != 2 {
		t.Errorf("ChunkCount = %d, want %d", manifest.ChunkCount, 2)
	}
	if manifest.CaptureDelayMs != 1000 {
		t.Errorf("CaptureDelayMs = %d, want %d", manifest.CaptureDelayMs, 1000)
	}
	if len(manifest.Entities) != 2 {
		t.Errorf("len(Entities) = %d, want %d", len(manifest.Entities), 2)
	}

	// Verify first entity
	if len(manifest.Entities) > 0 {
		ent := manifest.Entities[0]
		if ent.Id != 0 {
			t.Errorf("Entity[0].Id = %d, want %d", ent.Id, 0)
		}
		if ent.Type != pbv1.EntityType_ENTITY_TYPE_UNIT {
			t.Errorf("Entity[0].Type = %v, want %v", ent.Type, pbv1.EntityType_ENTITY_TYPE_UNIT)
		}
		if ent.Name != "Player1" {
			t.Errorf("Entity[0].Name = %q, want %q", ent.Name, "Player1")
		}
		if ent.Side != pbv1.Side_SIDE_WEST {
			t.Errorf("Entity[0].Side = %v, want %v", ent.Side, pbv1.Side_SIDE_WEST)
		}
		if !ent.IsPlayer {
			t.Errorf("Entity[0].IsPlayer = %v, want %v", ent.IsPlayer, true)
		}
	}

	// Verify second entity (vehicle)
	if len(manifest.Entities) > 1 {
		ent := manifest.Entities[1]
		if ent.Type != pbv1.EntityType_ENTITY_TYPE_VEHICLE {
			t.Errorf("Entity[1].Type = %v, want %v", ent.Type, pbv1.EntityType_ENTITY_TYPE_VEHICLE)
		}
		if ent.VehicleClass != "B_Truck_01" {
			t.Errorf("Entity[1].VehicleClass = %q, want %q", ent.VehicleClass, "B_Truck_01")
		}
	}

	// Verify events
	if len(manifest.Events) != 1 {
		t.Errorf("len(Events) = %d, want %d", len(manifest.Events), 1)
	} else {
		evt := manifest.Events[0]
		if evt.FrameNum != 8 {
			t.Errorf("Event.FrameNum = %d, want %d", evt.FrameNum, 8)
		}
		if evt.Type != "killed" {
			t.Errorf("Event.Type = %q, want %q", evt.Type, "killed")
		}
	}

	// Verify markers
	if len(manifest.Markers) != 1 {
		t.Errorf("len(Markers) = %d, want %d", len(manifest.Markers), 1)
	}

	// Verify times
	if len(manifest.Times) != 1 {
		t.Errorf("len(Times) = %d, want %d", len(manifest.Times), 1)
	}

	// Verify chunks were created
	chunk0Path := filepath.Join(outputPath, "chunks", "0000.pb")
	chunk1Path := filepath.Join(outputPath, "chunks", "0001.pb")

	if _, err := os.Stat(chunk0Path); err != nil {
		t.Errorf("chunk 0 not created: %v", err)
	}
	if _, err := os.Stat(chunk1Path); err != nil {
		t.Errorf("chunk 1 not created: %v", err)
	}

	// Read and verify chunk 0
	chunk0Data, err := os.ReadFile(chunk0Path)
	if err != nil {
		t.Fatalf("read chunk 0: %v", err)
	}

	var chunk0 pbv1.Chunk
	if err := proto.Unmarshal(chunk0Data, &chunk0); err != nil {
		t.Fatalf("unmarshal chunk 0: %v", err)
	}

	if chunk0.Index != 0 {
		t.Errorf("Chunk0.Index = %d, want %d", chunk0.Index, 0)
	}
	if chunk0.StartFrame != 0 {
		t.Errorf("Chunk0.StartFrame = %d, want %d", chunk0.StartFrame, 0)
	}
	if chunk0.FrameCount != 5 {
		t.Errorf("Chunk0.FrameCount = %d, want %d", chunk0.FrameCount, 5)
	}
	if len(chunk0.Frames) != 5 {
		t.Errorf("len(Chunk0.Frames) = %d, want %d", len(chunk0.Frames), 5)
	}

	// Verify first frame has entities
	if len(chunk0.Frames) > 0 {
		frame0 := chunk0.Frames[0]
		if frame0.FrameNum != 0 {
			t.Errorf("Frame0.FrameNum = %d, want %d", frame0.FrameNum, 0)
		}
		if len(frame0.Entities) != 2 {
			t.Errorf("len(Frame0.Entities) = %d, want %d", len(frame0.Entities), 2)
		}

		// Verify first entity state
		if len(frame0.Entities) > 0 {
			state := frame0.Entities[0]
			if state.EntityId != 0 {
				t.Errorf("EntityState.EntityId = %d, want %d", state.EntityId, 0)
			}
			if state.PosX != 100.0 {
				t.Errorf("EntityState.PosX = %f, want %f", state.PosX, 100.0)
			}
			if state.PosY != 200.0 {
				t.Errorf("EntityState.PosY = %f, want %f", state.PosY, 200.0)
			}
			if state.Direction != 90 {
				t.Errorf("EntityState.Direction = %d, want %d", state.Direction, 90)
			}
			if state.Alive != 1 {
				t.Errorf("EntityState.Alive = %d, want %d", state.Alive, 1)
			}
		}
	}

	// Read and verify chunk 1
	chunk1Data, err := os.ReadFile(chunk1Path)
	if err != nil {
		t.Fatalf("read chunk 1: %v", err)
	}

	var chunk1 pbv1.Chunk
	if err := proto.Unmarshal(chunk1Data, &chunk1); err != nil {
		t.Fatalf("unmarshal chunk 1: %v", err)
	}

	if chunk1.Index != 1 {
		t.Errorf("Chunk1.Index = %d, want %d", chunk1.Index, 1)
	}
	if chunk1.StartFrame != 5 {
		t.Errorf("Chunk1.StartFrame = %d, want %d", chunk1.StartFrame, 5)
	}
	if chunk1.FrameCount != 5 {
		t.Errorf("Chunk1.FrameCount = %d, want %d", chunk1.FrameCount, 5)
	}
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
	if err != nil {
		t.Fatalf("marshal test data: %v", err)
	}

	f, err := os.Create(inputPath)
	if err != nil {
		t.Fatalf("create gzip file: %v", err)
	}
	gw := gzip.NewWriter(f)
	if _, err := gw.Write(jsonData); err != nil {
		gw.Close()
		f.Close()
		t.Fatalf("write gzip: %v", err)
	}
	gw.Close()
	f.Close()

	// Convert
	converter := NewConverter(DefaultChunkSize)
	ctx := context.Background()
	if err := converter.Convert(ctx, inputPath, outputPath, "protobuf"); err != nil {
		t.Fatalf("convert: %v", err)
	}

	// Verify manifest
	manifestPath := filepath.Join(outputPath, "manifest.pb")
	manifestData, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatalf("read manifest: %v", err)
	}

	var manifest pbv1.Manifest
	if err := proto.Unmarshal(manifestData, &manifest); err != nil {
		t.Fatalf("unmarshal manifest: %v", err)
	}

	if manifest.WorldName != "Stratis" {
		t.Errorf("WorldName = %q, want %q", manifest.WorldName, "Stratis")
	}
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
	if err != nil {
		t.Fatalf("marshal test data: %v", err)
	}
	if err := os.WriteFile(inputPath, jsonData, 0644); err != nil {
		t.Fatalf("write test JSON: %v", err)
	}

	// Create cancelled context
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	converter := NewConverter(10)
	err = converter.Convert(ctx, inputPath, outputPath, "protobuf")
	if err == nil {
		t.Error("expected error from cancelled context")
	}
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
	if err != nil {
		t.Fatalf("marshal test data: %v", err)
	}
	if err := os.WriteFile(inputPath, jsonData, 0644); err != nil {
		t.Fatalf("write test JSON: %v", err)
	}

	converter := NewConverter(10)
	ctx := context.Background()
	if err := converter.Convert(ctx, inputPath, outputPath, "protobuf"); err != nil {
		t.Fatalf("convert: %v", err)
	}

	// Read chunk and verify crew
	chunkPath := filepath.Join(outputPath, "chunks", "0000.pb")
	chunkData, err := os.ReadFile(chunkPath)
	if err != nil {
		t.Fatalf("read chunk: %v", err)
	}

	var chunk pbv1.Chunk
	if err := proto.Unmarshal(chunkData, &chunk); err != nil {
		t.Fatalf("unmarshal chunk: %v", err)
	}

	// Find vehicle state in first frame
	if len(chunk.Frames) > 0 {
		for _, state := range chunk.Frames[0].Entities {
			if state.EntityId == 1 { // Vehicle
				if len(state.CrewIds) != 1 {
					t.Errorf("len(CrewIds) = %d, want %d", len(state.CrewIds), 1)
				} else if state.CrewIds[0] != 0 {
					t.Errorf("CrewIds[0] = %d, want %d", state.CrewIds[0], 0)
				}
			}
		}
	}
}

func TestNewConverter_DefaultChunkSize(t *testing.T) {
	converter := NewConverter(0)
	if converter.ChunkSize != DefaultChunkSize {
		t.Errorf("ChunkSize = %d, want %d", converter.ChunkSize, DefaultChunkSize)
	}

	converter2 := NewConverter(100)
	if converter2.ChunkSize != 100 {
		t.Errorf("ChunkSize = %d, want %d", converter2.ChunkSize, 100)
	}
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
			got := toFloat64(tt.input)
			if got != tt.want {
				t.Errorf("toFloat64(%v) = %v, want %v", tt.input, got, tt.want)
			}
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
			got := toString(tt.input)
			if got != tt.want {
				t.Errorf("toString(%v) = %q, want %q", tt.input, got, tt.want)
			}
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
	if err != nil {
		t.Fatalf("marshal test data: %v", err)
	}
	if err := os.WriteFile(inputPath, jsonData, 0644); err != nil {
		t.Fatalf("write test JSON: %v", err)
	}

	converter := NewConverter(DefaultChunkSize)
	ctx := context.Background()
	err = converter.Convert(ctx, inputPath, outputPath, "protobuf")
	if err == nil {
		t.Error("expected error for unknown input version")
	}
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
	if err != nil {
		t.Fatalf("marshal test data: %v", err)
	}
	if err := os.WriteFile(inputPath, jsonData, 0644); err != nil {
		t.Fatalf("write test JSON: %v", err)
	}

	converter := NewConverter(DefaultChunkSize)
	ctx := context.Background()
	err = converter.Convert(ctx, inputPath, outputPath, "invalid_format")
	if err == nil {
		t.Error("expected error for invalid format")
	}
}
