// server/storage/flatbuffers.go
package storage

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"

	fbv1 "github.com/OCAP2/web/pkg/schemas/flatbuffers/v1/generated"
)

// FlatBuffersEngine implements the Engine interface for FlatBuffers format
// FlatBuffers provides zero-copy read access for maximum performance
type FlatBuffersEngine struct {
	dataDir string
}

// NewFlatBuffersEngine creates a new FlatBuffers storage engine
func NewFlatBuffersEngine(dataDir string) *FlatBuffersEngine {
	return &FlatBuffersEngine{dataDir: dataDir}
}

// Name returns the engine identifier
func (e *FlatBuffersEngine) Name() string {
	return "flatbuffers"
}

// SupportsStreaming returns true as FlatBuffers supports chunked loading
func (e *FlatBuffersEngine) SupportsStreaming() bool {
	return true
}

// GetManifest reads and decodes the manifest file
func (e *FlatBuffersEngine) GetManifest(ctx context.Context, filename string) (*Manifest, error) {
	path := filepath.Join(e.dataDir, filename, "manifest.fb")
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("read manifest: %w", err)
	}
	defer f.Close()

	data, err := e.readVersionedData(f)
	if err != nil {
		return nil, fmt.Errorf("read manifest data: %w", err)
	}

	fbManifest := fbv1.GetRootAsManifest(data, 0)
	return e.convertManifest(fbManifest), nil
}

// GetManifestReader returns a reader for raw manifest data
func (e *FlatBuffersEngine) GetManifestReader(ctx context.Context, filename string) (io.ReadCloser, error) {
	path := filepath.Join(e.dataDir, filename, "manifest.fb")
	return os.Open(path)
}

// GetChunk reads and decodes a chunk file
func (e *FlatBuffersEngine) GetChunk(ctx context.Context, filename string, chunkIndex int) (*Chunk, error) {
	path := filepath.Join(e.dataDir, filename, "chunks", fmt.Sprintf("%04d.fb", chunkIndex))
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("read chunk %d: %w", chunkIndex, err)
	}
	defer f.Close()

	data, err := e.readVersionedData(f)
	if err != nil {
		return nil, fmt.Errorf("read chunk %d data: %w", chunkIndex, err)
	}

	fbChunk := fbv1.GetRootAsChunk(data, 0)
	return e.convertChunk(fbChunk), nil
}

// GetChunkReader returns a reader for streaming chunk data
func (e *FlatBuffersEngine) GetChunkReader(ctx context.Context, filename string, chunkIndex int) (io.ReadCloser, error) {
	path := filepath.Join(e.dataDir, filename, "chunks", fmt.Sprintf("%04d.fb", chunkIndex))
	return os.Open(path)
}

// ChunkCount returns the number of chunks by reading manifest
func (e *FlatBuffersEngine) ChunkCount(ctx context.Context, filename string) (int, error) {
	manifest, err := e.GetManifest(ctx, filename)
	if err != nil {
		return 0, err
	}
	return int(manifest.ChunkCount), nil
}

// readVersionedData reads file data, handling the optional version prefix.
// Files may have a 4-byte version prefix (new format) or not (legacy format).
// This method provides backward compatibility with both formats.
func (e *FlatBuffersEngine) readVersionedData(f io.ReadSeeker) ([]byte, error) {
	// Read the entire file
	allData, err := io.ReadAll(f)
	if err != nil {
		return nil, err
	}

	// If file is too small to have version prefix, return as-is
	if len(allData) < versionPrefixSize {
		return allData, nil
	}

	// Check if this looks like a version prefix.
	// Version prefix is 4 bytes little-endian. For small version numbers (1-255),
	// bytes 2, 3, 4 will be zero: [version, 0x00, 0x00, 0x00]
	//
	// FlatBuffers files start with a root table offset (4 bytes little-endian).
	// The minimum offset is typically 16+ bytes (due to file structure).
	// Version numbers are small (1, 2, etc.), so we use the first byte value
	// combined with the zero check on bytes 2-4 to distinguish:
	// - Version prefix: first byte < 16 AND bytes 2-4 are all zero
	// - Legacy FlatBuffers: first byte >= 16 (typical root offsets)
	//
	// This heuristic works because:
	// - Version 1 = [0x01, 0x00, 0x00, 0x00]
	// - FlatBuffers root offset = [0x10+, 0x00, 0x00, 0x00] for small files

	// Check if bytes 2-4 are all zero AND first byte is small (< 16)
	// This distinguishes version prefix from FlatBuffers root offset
	hasVersionPrefix := allData[0] < 16 && allData[1] == 0 && allData[2] == 0 && allData[3] == 0

	if !hasVersionPrefix {
		// Legacy file without version prefix (or FlatBuffers root offset >= 16)
		return allData, nil
	}

	// Looks like a version prefix, read the version
	reader := bytes.NewReader(allData[:versionPrefixSize])
	version, err := ReadVersionPrefix(reader)
	if err != nil {
		// Can't read version, treat entire file as data (legacy)
		return allData, nil
	}

	// Check if version is supported
	switch version {
	case SchemaVersionV1:
		// Version prefix present and valid, skip it
		return allData[versionPrefixSize:], nil
	case SchemaVersionUnknown:
		// Version 0 with zeros in bytes 2-4 - unusual but treat as legacy
		return allData, nil
	default:
		// Unsupported version
		return nil, fmt.Errorf("unsupported flatbuffers schema version: %d", version)
	}
}

// Convert transforms a JSON recording to FlatBuffers format
func (e *FlatBuffersEngine) Convert(ctx context.Context, jsonPath, outputPath string) error {
	converter := NewConverter(DefaultChunkSize)
	return converter.Convert(ctx, jsonPath, outputPath, "flatbuffers")
}

// convertManifest converts FlatBuffers manifest to storage.Manifest
func (e *FlatBuffersEngine) convertManifest(fbm *fbv1.Manifest) *Manifest {
	manifest := &Manifest{
		Version:        fbm.Version(),
		WorldName:      string(fbm.WorldName()),
		MissionName:    string(fbm.MissionName()),
		FrameCount:     fbm.FrameCount(),
		ChunkSize:      fbm.ChunkSize(),
		CaptureDelayMs: fbm.CaptureDelayMs(),
		ChunkCount:     fbm.ChunkCount(),
	}

	// Convert entities
	for i := 0; i < fbm.EntitiesLength(); i++ {
		var ent fbv1.EntityDef
		if fbm.Entities(&ent, i) {
			manifest.Entities = append(manifest.Entities, EntityDef{
				ID:           ent.Id(),
				Type:         fbEntityTypeToString(ent.Type()),
				Name:         string(ent.Name()),
				Side:         fbSideToString(ent.Side()),
				Group:        string(ent.GroupName()),
				Role:         string(ent.Role()),
				StartFrame:   ent.StartFrame(),
				EndFrame:     ent.EndFrame(),
				IsPlayer:     ent.IsPlayer(),
				VehicleClass: string(ent.VehicleClass()),
			})
		}
	}

	// Convert events
	for i := 0; i < fbm.EventsLength(); i++ {
		var evt fbv1.Event
		if fbm.Events(&evt, i) {
			manifest.Events = append(manifest.Events, Event{
				FrameNum: evt.FrameNum(),
				Type:     string(evt.Type()),
				SourceID: evt.SourceId(),
				TargetID: evt.TargetId(),
				Message:  string(evt.Message()),
				Distance: evt.Distance(),
				Weapon:   string(evt.Weapon()),
			})
		}
	}

	return manifest
}

// convertChunk converts FlatBuffers chunk to storage.Chunk
func (e *FlatBuffersEngine) convertChunk(fbc *fbv1.Chunk) *Chunk {
	chunk := &Chunk{
		Index:      fbc.Index(),
		StartFrame: fbc.StartFrame(),
		FrameCount: fbc.FrameCount(),
	}

	for i := 0; i < fbc.FramesLength(); i++ {
		var frame fbv1.Frame
		if fbc.Frames(&frame, i) {
			f := Frame{
				FrameNum: frame.FrameNum(),
			}

			for j := 0; j < frame.EntitiesLength(); j++ {
				var state fbv1.EntityState
				if frame.Entities(&state, j) {
					es := EntityState{
						EntityID:    state.EntityId(),
						PosX:        state.PosX(),
						PosY:        state.PosY(),
						Direction:   state.Direction(),
						Alive:       state.Alive(),
						VehicleID:   state.VehicleId(),
						IsInVehicle: state.IsInVehicle(),
						Name:        string(state.Name()),
						IsPlayer:    state.IsPlayer(),
					}

					for k := 0; k < state.CrewIdsLength(); k++ {
						es.CrewIDs = append(es.CrewIDs, state.CrewIds(k))
					}

					f.Entities = append(f.Entities, es)
				}
			}

			chunk.Frames = append(chunk.Frames, f)
		}
	}

	return chunk
}

// Helper functions for type conversion

func fbEntityTypeToString(t fbv1.EntityType) string {
	switch t {
	case fbv1.EntityTypeUnit:
		return "unit"
	case fbv1.EntityTypeVehicle:
		return "vehicle"
	default:
		return "unknown"
	}
}

func stringToFBEntityType(s string) fbv1.EntityType {
	switch s {
	case "unit":
		return fbv1.EntityTypeUnit
	case "vehicle":
		return fbv1.EntityTypeVehicle
	default:
		return fbv1.EntityTypeUnknown
	}
}

func fbSideToString(s fbv1.Side) string {
	switch s {
	case fbv1.SideWest:
		return "WEST"
	case fbv1.SideEast:
		return "EAST"
	case fbv1.SideGuer:
		return "GUER"
	case fbv1.SideCiv:
		return "CIV"
	case fbv1.SideGlobal:
		return "GLOBAL"
	default:
		return "UNKNOWN"
	}
}

func stringToFBSide(s string) fbv1.Side {
	switch s {
	case "WEST":
		return fbv1.SideWest
	case "EAST":
		return fbv1.SideEast
	case "GUER", "INDEPENDENT":
		return fbv1.SideGuer
	case "CIV", "CIVILIAN":
		return fbv1.SideCiv
	case "GLOBAL":
		return fbv1.SideGlobal
	default:
		return fbv1.SideUnknown
	}
}
