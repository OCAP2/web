// server/storage/json.go
package storage

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

// JSONEngine reads legacy gzipped JSON recordings
type JSONEngine struct {
	dataDir string
}

// NewJSONEngine creates a JSON engine for the given data directory
func NewJSONEngine(dataDir string) *JSONEngine {
	return &JSONEngine{dataDir: dataDir}
}

func (e *JSONEngine) SupportsStreaming() bool { return false }

func (e *JSONEngine) GetManifest(ctx context.Context, filename string) (*Manifest, error) {
	data, err := e.loadJSON(filename)
	if err != nil {
		return nil, err
	}

	manifest := &Manifest{
		Version:        1,
		WorldName:      getString(data, "worldName"),
		MissionName:    getString(data, "missionName"),
		FrameCount:     getUint32(data, "endFrame"),
		ChunkSize:      300,
		CaptureDelayMs: uint32(getFloat64(data, "captureDelay") * 1000),
		ChunkCount:     1, // JSON is single "chunk"
	}

	// Parse entities
	if entities, ok := data["entities"].([]interface{}); ok {
		for _, ent := range entities {
			if em, ok := ent.(map[string]interface{}); ok {
				def := EntityDef{
					ID:         getUint32(em, "id"),
					Type:       getString(em, "type"),
					Name:       getString(em, "name"),
					Side:       getString(em, "side"),
					Group:      getString(em, "group"),
					Role:       getString(em, "role"),
					StartFrame: getUint32(em, "startFrameNum"),
					IsPlayer:   getFloat64(em, "isPlayer") == 1,
				}
				if em["class"] != nil {
					def.VehicleClass = getString(em, "class")
				}
				manifest.Entities = append(manifest.Entities, def)
			}
		}
	}

	return manifest, nil
}

func (e *JSONEngine) GetManifestReader(ctx context.Context, filename string) (io.ReadCloser, error) {
	return nil, fmt.Errorf("JSON engine does not support raw manifest streaming")
}

func (e *JSONEngine) GetChunk(ctx context.Context, filename string, chunkIndex int) (*Chunk, error) {
	return nil, fmt.Errorf("JSON engine does not support chunked loading")
}

func (e *JSONEngine) GetChunkReader(ctx context.Context, filename string, chunkIndex int) (io.ReadCloser, error) {
	return nil, fmt.Errorf("JSON engine does not support chunked loading")
}

func (e *JSONEngine) Convert(ctx context.Context, jsonPath, outputPath string) error {
	return fmt.Errorf("JSON engine does not support conversion")
}

func (e *JSONEngine) loadJSON(filename string) (map[string]interface{}, error) {
	// Try gzipped first
	path := filepath.Join(e.dataDir, filename+".json.gz")
	if _, err := os.Stat(path); err == nil {
		return e.loadGzipJSON(path)
	}

	// Try uncompressed
	path = filepath.Join(e.dataDir, filename+".json")
	if _, err := os.Stat(path); err == nil {
		return e.loadPlainJSON(path)
	}

	return nil, fmt.Errorf("recording not found: %s", filename)
}

func (e *JSONEngine) loadGzipJSON(path string) (map[string]interface{}, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	gr, err := gzip.NewReader(f)
	if err != nil {
		return nil, err
	}
	defer gr.Close()

	var data map[string]interface{}
	if err := json.NewDecoder(gr).Decode(&data); err != nil {
		return nil, err
	}
	return data, nil
}

func (e *JSONEngine) loadPlainJSON(path string) (map[string]interface{}, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var data map[string]interface{}
	if err := json.NewDecoder(f).Decode(&data); err != nil {
		return nil, err
	}
	return data, nil
}

// Helper functions for parsing JSON values
func getString(m map[string]interface{}, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

func getFloat64(m map[string]interface{}, key string) float64 {
	if v, ok := m[key].(float64); ok {
		return v
	}
	return 0
}

func getUint32(m map[string]interface{}, key string) uint32 {
	return uint32(getFloat64(m, key))
}
