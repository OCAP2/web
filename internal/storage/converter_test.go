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

	pb "github.com/OCAP2/web/pkg/schemas/protobuf"
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
	if err := converter.Convert(ctx, inputPath, outputPath); err != nil {
		t.Fatalf("convert: %v", err)
	}

	// Verify manifest was created
	manifestPath := filepath.Join(outputPath, "manifest.pb")
	manifestData, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatalf("read manifest: %v", err)
	}

	var manifest pb.Manifest
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
		if ent.Type != pb.EntityType_ENTITY_TYPE_UNIT {
			t.Errorf("Entity[0].Type = %v, want %v", ent.Type, pb.EntityType_ENTITY_TYPE_UNIT)
		}
		if ent.Name != "Player1" {
			t.Errorf("Entity[0].Name = %q, want %q", ent.Name, "Player1")
		}
		if ent.Side != pb.Side_SIDE_WEST {
			t.Errorf("Entity[0].Side = %v, want %v", ent.Side, pb.Side_SIDE_WEST)
		}
		if !ent.IsPlayer {
			t.Errorf("Entity[0].IsPlayer = %v, want %v", ent.IsPlayer, true)
		}
	}

	// Verify second entity (vehicle)
	if len(manifest.Entities) > 1 {
		ent := manifest.Entities[1]
		if ent.Type != pb.EntityType_ENTITY_TYPE_VEHICLE {
			t.Errorf("Entity[1].Type = %v, want %v", ent.Type, pb.EntityType_ENTITY_TYPE_VEHICLE)
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

	var chunk0 pb.Chunk
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

	var chunk1 pb.Chunk
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
	if err := converter.Convert(ctx, inputPath, outputPath); err != nil {
		t.Fatalf("convert: %v", err)
	}

	// Verify manifest
	manifestPath := filepath.Join(outputPath, "manifest.pb")
	manifestData, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatalf("read manifest: %v", err)
	}

	var manifest pb.Manifest
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
	err = converter.Convert(ctx, inputPath, outputPath)
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
	if err := converter.Convert(ctx, inputPath, outputPath); err != nil {
		t.Fatalf("convert: %v", err)
	}

	// Read chunk and verify crew
	chunkPath := filepath.Join(outputPath, "chunks", "0000.pb")
	chunkData, err := os.ReadFile(chunkPath)
	if err != nil {
		t.Fatalf("read chunk: %v", err)
	}

	var chunk pb.Chunk
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

func TestConverter_ParseEvent(t *testing.T) {
	converter := NewConverter(DefaultChunkSize)

	tests := []struct {
		name     string
		input    []interface{}
		wantType string
		wantOK   bool
	}{
		{
			name:     "killed event",
			input:    []interface{}{100.0, "killed", 1.0, 2.0, "arifle_MX", 150.0},
			wantType: "killed",
			wantOK:   true,
		},
		{
			name:     "hit event",
			input:    []interface{}{50.0, "hit", 1.0, 2.0, "pistol"},
			wantType: "hit",
			wantOK:   true,
		},
		{
			name:     "too short",
			input:    []interface{}{100.0},
			wantType: "",
			wantOK:   false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			event := converter.parseEvent(tt.input)
			if tt.wantOK {
				if event == nil {
					t.Error("expected non-nil event")
					return
				}
				if event.Type != tt.wantType {
					t.Errorf("Type = %q, want %q", event.Type, tt.wantType)
				}
			} else {
				if event != nil {
					t.Error("expected nil event")
				}
			}
		})
	}
}

func TestConverter_StringToSide(t *testing.T) {
	tests := []struct {
		input string
		want  pb.Side
	}{
		{"WEST", pb.Side_SIDE_WEST},
		{"EAST", pb.Side_SIDE_EAST},
		{"GUER", pb.Side_SIDE_GUER},
		{"INDEPENDENT", pb.Side_SIDE_GUER},
		{"CIV", pb.Side_SIDE_CIV},
		{"CIVILIAN", pb.Side_SIDE_CIV},
		{"GLOBAL", pb.Side_SIDE_GLOBAL},
		{"UNKNOWN", pb.Side_SIDE_UNKNOWN},
		{"", pb.Side_SIDE_UNKNOWN},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := stringToSide(tt.input)
			if got != tt.want {
				t.Errorf("stringToSide(%q) = %v, want %v", tt.input, got, tt.want)
			}
		})
	}
}

func TestSideIndexToSide(t *testing.T) {
	tests := []struct {
		name  string
		input int
		want  pb.Side
	}{
		{"WEST index 0", 0, pb.Side_SIDE_WEST},
		{"EAST index 1", 1, pb.Side_SIDE_EAST},
		{"GUER index 2", 2, pb.Side_SIDE_GUER},
		{"CIV index 3", 3, pb.Side_SIDE_CIV},
		{"UNKNOWN index 4", 4, pb.Side_SIDE_UNKNOWN},
		{"UNKNOWN negative", -1, pb.Side_SIDE_UNKNOWN},
		{"UNKNOWN large", 100, pb.Side_SIDE_UNKNOWN},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := sideIndexToSide(tt.input)
			if got != tt.want {
				t.Errorf("sideIndexToSide(%d) = %v, want %v", tt.input, got, tt.want)
			}
		})
	}
}

func TestStringToEntityType(t *testing.T) {
	tests := []struct {
		input string
		want  pb.EntityType
	}{
		{"unit", pb.EntityType_ENTITY_TYPE_UNIT},
		{"vehicle", pb.EntityType_ENTITY_TYPE_VEHICLE},
		{"unknown", pb.EntityType_ENTITY_TYPE_UNKNOWN},
		{"", pb.EntityType_ENTITY_TYPE_UNKNOWN},
		{"invalid", pb.EntityType_ENTITY_TYPE_UNKNOWN},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := stringToEntityType(tt.input)
			if got != tt.want {
				t.Errorf("stringToEntityType(%q) = %v, want %v", tt.input, got, tt.want)
			}
		})
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
		{"int", 42, 0.0},         // int is not float64
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

func TestConverter_ParseMarkerPosition(t *testing.T) {
	converter := NewConverter(DefaultChunkSize)

	t.Run("simple format [x, y, z]", func(t *testing.T) {
		pos := converter.parseMarkerPosition([]interface{}{100.0, 200.0, 10.0})
		if pos == nil {
			t.Fatal("expected non-nil position")
		}
		if pos.PosX != 100.0 {
			t.Errorf("PosX = %v, want 100.0", pos.PosX)
		}
		if pos.PosY != 200.0 {
			t.Errorf("PosY = %v, want 200.0", pos.PosY)
		}
		if pos.PosZ != 10.0 {
			t.Errorf("PosZ = %v, want 10.0", pos.PosZ)
		}
	})

	t.Run("simple format [x, y] without z", func(t *testing.T) {
		pos := converter.parseMarkerPosition([]interface{}{100.0, 200.0})
		if pos == nil {
			t.Fatal("expected non-nil position")
		}
		if pos.PosX != 100.0 {
			t.Errorf("PosX = %v, want 100.0", pos.PosX)
		}
		if pos.PosY != 200.0 {
			t.Errorf("PosY = %v, want 200.0", pos.PosY)
		}
		if pos.PosZ != 0.0 {
			t.Errorf("PosZ = %v, want 0.0", pos.PosZ)
		}
	})

	t.Run("complex format [[x, y, z], frameNum, direction, alpha]", func(t *testing.T) {
		pos := converter.parseMarkerPosition([]interface{}{
			[]interface{}{100.0, 200.0, 10.0},
			50.0,
			90.0,
			0.5,
		})
		if pos == nil {
			t.Fatal("expected non-nil position")
		}
		if pos.PosX != 100.0 {
			t.Errorf("PosX = %v, want 100.0", pos.PosX)
		}
		if pos.PosY != 200.0 {
			t.Errorf("PosY = %v, want 200.0", pos.PosY)
		}
		if pos.PosZ != 10.0 {
			t.Errorf("PosZ = %v, want 10.0", pos.PosZ)
		}
		if pos.FrameNum != 50 {
			t.Errorf("FrameNum = %v, want 50", pos.FrameNum)
		}
		if pos.Direction != 90.0 {
			t.Errorf("Direction = %v, want 90.0", pos.Direction)
		}
		if pos.Alpha != 0.5 {
			t.Errorf("Alpha = %v, want 0.5", pos.Alpha)
		}
	})

	t.Run("complex format [[x, y], frameNum] without z", func(t *testing.T) {
		pos := converter.parseMarkerPosition([]interface{}{
			[]interface{}{100.0, 200.0},
			50.0,
		})
		if pos == nil {
			t.Fatal("expected non-nil position")
		}
		if pos.PosX != 100.0 {
			t.Errorf("PosX = %v, want 100.0", pos.PosX)
		}
		if pos.PosY != 200.0 {
			t.Errorf("PosY = %v, want 200.0", pos.PosY)
		}
		if pos.FrameNum != 50 {
			t.Errorf("FrameNum = %v, want 50", pos.FrameNum)
		}
	})

	t.Run("nil input", func(t *testing.T) {
		pos := converter.parseMarkerPosition(nil)
		if pos != nil {
			t.Error("expected nil position for nil input")
		}
	})

	t.Run("non-array input", func(t *testing.T) {
		pos := converter.parseMarkerPosition("not an array")
		if pos != nil {
			t.Error("expected nil position for non-array input")
		}
	})

	t.Run("empty array", func(t *testing.T) {
		pos := converter.parseMarkerPosition([]interface{}{})
		if pos != nil {
			t.Error("expected nil position for empty array")
		}
	})
}

func TestConverter_CalculateEndFrame(t *testing.T) {
	converter := NewConverter(DefaultChunkSize)

	t.Run("with positions", func(t *testing.T) {
		em := map[string]interface{}{
			"positions": []interface{}{
				[]interface{}{},
				[]interface{}{},
				[]interface{}{},
				[]interface{}{},
				[]interface{}{},
			},
		}
		endFrame := converter.calculateEndFrame(em, 10)
		// startFrame + len(positions) - 1 = 10 + 5 - 1 = 14
		if endFrame != 14 {
			t.Errorf("endFrame = %d, want 14", endFrame)
		}
	})

	t.Run("without positions", func(t *testing.T) {
		em := map[string]interface{}{}
		endFrame := converter.calculateEndFrame(em, 10)
		// Should return startFrame when no positions
		if endFrame != 10 {
			t.Errorf("endFrame = %d, want 10", endFrame)
		}
	})

	t.Run("positions is not array", func(t *testing.T) {
		em := map[string]interface{}{
			"positions": "not an array",
		}
		endFrame := converter.calculateEndFrame(em, 10)
		// Should return startFrame when positions is wrong type
		if endFrame != 10 {
			t.Errorf("endFrame = %d, want 10", endFrame)
		}
	})
}

func TestConverter_ParseEvent_Distance(t *testing.T) {
	converter := NewConverter(DefaultChunkSize)

	t.Run("event with numeric distance at index 4", func(t *testing.T) {
		// When index 4 is a number (not a weapon string), it's treated as distance
		event := converter.parseEvent([]interface{}{100.0, "move", 1.0, 2.0, 50.5})
		if event == nil {
			t.Fatal("expected non-nil event")
		}
		if event.Distance != 50.5 {
			t.Errorf("Distance = %v, want 50.5", event.Distance)
		}
	})

	t.Run("event with message at index 4", func(t *testing.T) {
		// For non-hit/killed events, string at index 4 is message
		event := converter.parseEvent([]interface{}{100.0, "chat", 1.0, 2.0, "Hello world"})
		if event == nil {
			t.Fatal("expected non-nil event")
		}
		if event.Message != "Hello world" {
			t.Errorf("Message = %q, want 'Hello world'", event.Message)
		}
	})

	t.Run("event with weapon and distance", func(t *testing.T) {
		// killed/hit events have weapon at index 4 and distance at index 5
		event := converter.parseEvent([]interface{}{100.0, "killed", 1.0, 2.0, "arifle_MX", 150.5})
		if event == nil {
			t.Fatal("expected non-nil event")
		}
		if event.Weapon != "arifle_MX" {
			t.Errorf("Weapon = %q, want 'arifle_MX'", event.Weapon)
		}
		if event.Distance != 150.5 {
			t.Errorf("Distance = %v, want 150.5", event.Distance)
		}
	})
}

func TestConverter_GetEntityStateAtFrame(t *testing.T) {
	converter := NewConverter(DefaultChunkSize)

	t.Run("frame before entity start", func(t *testing.T) {
		ep := entityPositionData{
			ID:         1,
			Type:       "unit",
			StartFrame: 10,
			Positions:  []interface{}{[]interface{}{[]interface{}{100.0, 200.0}, 45.0, 1.0}},
		}
		state := converter.getEntityStateAtFrame(ep, 5)
		if state != nil {
			t.Error("expected nil state for frame before start")
		}
	})

	t.Run("frame after entity end", func(t *testing.T) {
		ep := entityPositionData{
			ID:         1,
			Type:       "unit",
			StartFrame: 0,
			Positions:  []interface{}{[]interface{}{[]interface{}{100.0, 200.0}, 45.0, 1.0}},
		}
		state := converter.getEntityStateAtFrame(ep, 10)
		if state != nil {
			t.Error("expected nil state for frame after positions end")
		}
	})

	t.Run("invalid position data", func(t *testing.T) {
		ep := entityPositionData{
			ID:         1,
			Type:       "unit",
			StartFrame: 0,
			Positions:  []interface{}{"not an array"},
		}
		state := converter.getEntityStateAtFrame(ep, 0)
		if state != nil {
			t.Error("expected nil state for invalid position data")
		}
	})

	t.Run("position array too short", func(t *testing.T) {
		ep := entityPositionData{
			ID:         1,
			Type:       "unit",
			StartFrame: 0,
			Positions:  []interface{}{[]interface{}{100.0, 200.0}}, // Only 2 elements, need at least 3
		}
		state := converter.getEntityStateAtFrame(ep, 0)
		if state != nil {
			t.Error("expected nil state for position array too short")
		}
	})
}
