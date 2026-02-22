package storage

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

// BenchmarkConverter_Old benchmarks the old converter.
func BenchmarkConverter_Old(b *testing.B) {
	// Ensure real parser is registered (parser tests may have replaced it with mocks)
	RegisterParser(&ParserV1{})

	inputPath, cleanup := makeBenchInput(b)
	defer cleanup()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		outputPath := filepath.Join(b.TempDir(), fmt.Sprintf("old_%d", i))
		converter := NewConverter(DefaultChunkSize)
		if err := converter.Convert(context.Background(), inputPath, outputPath, "protobuf"); err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkConverter_Streaming benchmarks the streaming converter.
func BenchmarkConverter_Streaming(b *testing.B) {
	inputPath, cleanup := makeBenchInput(b)
	defer cleanup()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		outputPath := filepath.Join(b.TempDir(), fmt.Sprintf("new_%d", i))
		converter := NewStreamingConverter(DefaultChunkSize)
		if err := converter.Convert(context.Background(), inputPath, outputPath); err != nil {
			b.Fatal(err)
		}
	}
}

// makeBenchInput creates a test JSON file with ~100 entities and ~1000 frames.
func makeBenchInput(b *testing.B) (string, func()) {
	b.Helper()
	tmpDir, err := os.MkdirTemp("", "bench_converter_*")
	if err != nil {
		b.Fatal(err)
	}
	inputPath := filepath.Join(tmpDir, "bench.json")

	// Build entities with many positions
	entities := make([]interface{}, 100)
	for i := 0; i < 100; i++ {
		positions := make([]interface{}, 1000)
		for f := 0; f < 1000; f++ {
			if i < 80 { // units
				positions[f] = []interface{}{
					[]interface{}{float64(100 + f), float64(200 + i), 0.0},
					float64(90 + f%360), 1.0, 0.0,
					fmt.Sprintf("Unit_%d", i), float64(boolToInt(i < 20)),
				}
			} else { // vehicles
				positions[f] = []interface{}{
					[]interface{}{float64(500 + f), float64(600 + i), 0.0},
					float64(180 + f%360), 1.0, []interface{}{},
				}
			}
		}

		entityType := "unit"
		if i >= 80 {
			entityType = "vehicle"
		}
		entities[i] = map[string]interface{}{
			"id": float64(i), "type": entityType,
			"name": fmt.Sprintf("Entity_%d", i), "side": "WEST",
			"startFrameNum": 0.0, "isPlayer": float64(boolToInt(i < 20)),
			"positions": positions,
		}
	}

	testData := map[string]interface{}{
		"worldName": "Altis", "missionName": "Bench Test",
		"endFrame": 1000.0, "captureDelay": 1.0,
		"entities": entities, "events": []interface{}{},
		"Markers": []interface{}{}, "times": []interface{}{},
	}

	jsonData, err := json.Marshal(testData)
	if err != nil {
		b.Fatal(err)
	}
	if err := os.WriteFile(inputPath, jsonData, 0644); err != nil {
		b.Fatal(err)
	}

	return inputPath, func() { os.RemoveAll(tmpDir) }
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
