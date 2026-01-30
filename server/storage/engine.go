// server/storage/engine.go
package storage

import (
	"context"
	"fmt"
	"io"
)

// Manifest contains mission metadata loaded at playback start
type Manifest struct {
	Version        uint32      `json:"version"`
	WorldName      string      `json:"worldName"`
	MissionName    string      `json:"missionName"`
	FrameCount     uint32      `json:"frameCount"`
	ChunkSize      uint32      `json:"chunkSize"`
	CaptureDelayMs uint32      `json:"captureDelayMs"`
	ChunkCount     uint32      `json:"chunkCount"`
	Entities       []EntityDef `json:"entities"`
}

// EntityDef defines an entity's metadata
type EntityDef struct {
	ID           uint32 `json:"id"`
	Type         string `json:"type"` // "unit" or "vehicle"
	Name         string `json:"name"`
	Side         string `json:"side"`
	Group        string `json:"group"`
	Role         string `json:"role"`
	StartFrame   uint32 `json:"startFrame"`
	EndFrame     uint32 `json:"endFrame"`
	IsPlayer     bool   `json:"isPlayer"`
	VehicleClass string `json:"vehicleClass,omitempty"`
}

// Chunk contains position data for a frame range
type Chunk struct {
	Index      uint32  `json:"index"`
	StartFrame uint32  `json:"startFrame"`
	FrameCount uint32  `json:"frameCount"`
	Frames     []Frame `json:"frames"`
}

// Frame contains entity states for a single frame
type Frame struct {
	FrameNum uint32        `json:"frameNum"`
	Entities []EntityState `json:"entities"`
}

// EntityState is an entity's state at a frame
type EntityState struct {
	EntityID  uint32     `json:"entityId"`
	Position  [2]float32 `json:"position"`
	Direction uint32     `json:"direction"`
	Alive     uint8      `json:"alive"`
	CrewIDs   []uint32   `json:"crewIds,omitempty"`
	VehicleID uint32     `json:"vehicleId,omitempty"`
}

// Engine defines the storage engine interface
type Engine interface {
	// Name returns the engine identifier (e.g., "json", "protobuf")
	Name() string

	// SupportsStreaming indicates if chunked loading is supported
	SupportsStreaming() bool

	// GetManifest returns mission metadata and entity definitions
	GetManifest(ctx context.Context, filename string) (*Manifest, error)

	// GetChunk returns position/event data for a frame range
	GetChunk(ctx context.Context, filename string, chunkIndex int) (*Chunk, error)

	// GetChunkReader returns a reader for raw chunk data (for streaming to client)
	GetChunkReader(ctx context.Context, filename string, chunkIndex int) (io.ReadCloser, error)

	// ChunkCount returns the total number of chunks
	ChunkCount(ctx context.Context, filename string) (int, error)

	// Convert transforms from JSON to this engine's format
	Convert(ctx context.Context, jsonPath, outputPath string) error
}

var engines = make(map[string]Engine)

// RegisterEngine adds an engine to the registry
func RegisterEngine(e Engine) {
	engines[e.Name()] = e
}

// GetEngine returns an engine by name
func GetEngine(name string) (Engine, error) {
	if e, ok := engines[name]; ok {
		return e, nil
	}
	return nil, fmt.Errorf("unknown storage engine: %s", name)
}

// ListEngines returns all registered engine names
func ListEngines() []string {
	names := make([]string, 0, len(engines))
	for name := range engines {
		names = append(names, name)
	}
	return names
}
