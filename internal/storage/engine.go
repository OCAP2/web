// server/storage/engine.go
package storage

import (
	"context"
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
	FrameNum   uint32  `json:"frameNum"`
	Type       string  `json:"type"`
	SourceID   uint32  `json:"sourceId"`
	TargetID   uint32  `json:"targetId"`
	Message    string  `json:"message,omitempty"`
	Distance   float32 `json:"distance,omitempty"`
	Weapon     string  `json:"weapon,omitempty"`
	PosX       float32 `json:"posX,omitempty"`
	PosY       float32 `json:"posY,omitempty"`
	ObjectType string  `json:"objectType,omitempty"`
	UnitName   string  `json:"unitName,omitempty"`
	Side       string  `json:"side,omitempty"`
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

// Engine defines the storage engine interface
type Engine interface {
	// GetManifest returns mission metadata and entity definitions
	GetManifest(ctx context.Context, filename string) (*Manifest, error)

	// Convert transforms from JSON to this engine's format
	Convert(ctx context.Context, jsonPath, outputPath string) error
}

