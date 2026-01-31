package storage

import "fmt"

// ParseResult contains parsed data in a schema-agnostic format.
// This is the intermediate representation produced by parsing JSON input,
// before writing to protobuf/flatbuffers format.
type ParseResult struct {
	// Manifest data
	WorldName        string
	MissionName      string
	FrameCount       uint32
	ChunkSize        uint32
	CaptureDelayMs   uint32
	ExtensionVersion string
	AddonVersion     string

	// Entity definitions (reuses EntityDef from engine.go)
	Entities []EntityDef

	// Events (reuses Event from engine.go)
	Events []Event

	// Markers and times (specific to parse result)
	Markers []MarkerDef
	Times   []TimeSample

	// Position data for chunk writing
	EntityPositions []EntityPositionData
}

// MarkerDef is schema-agnostic marker definition
type MarkerDef struct {
	Type       string
	Text       string
	StartFrame uint32
	EndFrame   uint32
	PlayerID   int32
	Color      string
	Side       string
	Positions  []MarkerPosition
	Size       []float32
	Shape      string
	Brush      string
}

// MarkerPosition is a marker position at a specific frame
type MarkerPosition struct {
	FrameNum  uint32
	PosX      float32
	PosY      float32
	PosZ      float32
	Direction float32
	Alpha     float32
}

// TimeSample is schema-agnostic time sample
type TimeSample struct {
	FrameNum       uint32
	SystemTimeUTC  string
	Date           string
	TimeMultiplier float32
	Time           float32
}

// EntityPositionData holds position data for an entity across frames
type EntityPositionData struct {
	EntityID  uint32
	Positions []EntityPosition
}

// EntityPosition is a single frame's position for an entity
type EntityPosition struct {
	FrameNum    uint32
	PosX        float32
	PosY        float32
	Direction   uint32
	Alive       uint32
	CrewIDs     []uint32
	VehicleID   uint32
	IsInVehicle bool
	Name        string
	IsPlayer    bool
}

// Parser converts JSON input to ParseResult
type Parser interface {
	Version() JSONInputVersion
	Parse(data map[string]interface{}, chunkSize uint32) (*ParseResult, error)
}

// parsers is the registry of parsers by version
var parsers = make(map[JSONInputVersion]Parser)

// RegisterParser registers a parser for its version
func RegisterParser(p Parser) {
	parsers[p.Version()] = p
}

// GetParser returns the parser for a given version
func GetParser(v JSONInputVersion) (Parser, error) {
	if p, ok := parsers[v]; ok {
		return p, nil
	}
	return nil, fmt.Errorf("no parser for JSON version %s", v.String())
}
