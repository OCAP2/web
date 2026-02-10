// server/storage/engine.go
package storage

import (
	"context"
	"io"
)

// Manifest contains mission metadata loaded at playback start
type Manifest struct {
	Version          uint32      `json:"version"`
	WorldName        string      `json:"worldName"`
	MissionName      string      `json:"missionName"`
	FrameCount       uint32      `json:"frameCount"`
	ChunkSize        uint32      `json:"chunkSize"`
	CaptureDelayMs   uint32      `json:"captureDelayMs"`
	ChunkCount       uint32      `json:"chunkCount"`
	Entities         []EntityDef `json:"entities"`
	Events           []Event     `json:"events,omitempty"`
	ExtensionVersion string      `json:"extensionVersion,omitempty"`
	AddonVersion     string      `json:"addonVersion,omitempty"`
}

// Event represents a game event
type Event struct {
	FrameNum uint32  `json:"frameNum"`
	Type     string  `json:"type"`
	SourceID uint32  `json:"sourceId"`
	TargetID uint32  `json:"targetId"`
	Message  string  `json:"message,omitempty"`
	Distance float32 `json:"distance,omitempty"`
	Weapon   string  `json:"weapon,omitempty"`
}

// EntityDef defines an entity's metadata
type EntityDef struct {
	ID           uint32       `json:"id"`
	Type         string       `json:"type"` // "unit" or "vehicle"
	Name         string       `json:"name"`
	Side         string       `json:"side"`
	Group        string       `json:"group"`
	Role         string       `json:"role"`
	StartFrame   uint32       `json:"startFrame"`
	EndFrame     uint32       `json:"endFrame"`
	IsPlayer     bool         `json:"isPlayer"`
	VehicleClass string       `json:"vehicleClass,omitempty"`
	FramesFired  []FiredFrame `json:"framesFired,omitempty"`
}

// FiredFrame represents a projectile fired at a specific frame
type FiredFrame struct {
	FrameNum uint32  `json:"frameNum"`
	PosX     float32 `json:"posX"`
	PosY     float32 `json:"posY"`
	PosZ     float32 `json:"posZ"`
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
	EntityID    uint32   `json:"entityId"`
	PosX        float32  `json:"posX"`
	PosY        float32  `json:"posY"`
	Direction   uint32   `json:"direction"`
	Alive       uint32   `json:"alive"`
	CrewIDs     []uint32 `json:"crewIds,omitempty"`
	VehicleID   uint32   `json:"vehicleId,omitempty"`
	IsInVehicle bool     `json:"isInVehicle,omitempty"`
	Name        string   `json:"name,omitempty"`
	IsPlayer    bool     `json:"isPlayer,omitempty"`
}

// Engine defines the storage engine interface
type Engine interface {
	// SupportsStreaming indicates if chunked loading is supported
	SupportsStreaming() bool

	// GetManifest returns mission metadata and entity definitions
	GetManifest(ctx context.Context, filename string) (*Manifest, error)

	// GetManifestReader returns a reader for raw manifest data (for streaming to client)
	// Returns nil if the format doesn't support raw streaming (e.g., JSON)
	GetManifestReader(ctx context.Context, filename string) (io.ReadCloser, error)

	// GetChunk returns position/event data for a frame range
	GetChunk(ctx context.Context, filename string, chunkIndex int) (*Chunk, error)

	// GetChunkReader returns a reader for raw chunk data (for streaming to client)
	GetChunkReader(ctx context.Context, filename string, chunkIndex int) (io.ReadCloser, error)

	// Convert transforms from JSON to this engine's format
	Convert(ctx context.Context, jsonPath, outputPath string) error
}

