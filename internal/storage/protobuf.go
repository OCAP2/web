// server/storage/protobuf.go
package storage

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"google.golang.org/protobuf/proto"

	pbv1 "github.com/OCAP2/web/pkg/schemas/protobuf/v1"
)

// versionPrefixSize is the size of the version prefix in bytes
const versionPrefixSize = 4

// ProtobufEngine reads chunked protobuf recordings
type ProtobufEngine struct {
	dataDir string
}

// NewProtobufEngine creates a protobuf engine for the given data directory
func NewProtobufEngine(dataDir string) *ProtobufEngine {
	return &ProtobufEngine{dataDir: dataDir}
}

func (e *ProtobufEngine) Name() string            { return "protobuf" }
func (e *ProtobufEngine) SupportsStreaming() bool { return true }

func (e *ProtobufEngine) GetManifest(ctx context.Context, filename string) (*Manifest, error) {
	path := filepath.Join(e.dataDir, filename, "manifest.pb")
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("read manifest: %w", err)
	}
	defer f.Close()

	data, err := e.readVersionedData(f)
	if err != nil {
		return nil, fmt.Errorf("read manifest data: %w", err)
	}

	var pbManifest pbv1.Manifest
	if err := proto.Unmarshal(data, &pbManifest); err != nil {
		return nil, fmt.Errorf("unmarshal manifest: %w", err)
	}

	// Convert protobuf to storage types
	manifest := &Manifest{
		Version:        pbManifest.Version,
		WorldName:      pbManifest.WorldName,
		MissionName:    pbManifest.MissionName,
		FrameCount:     pbManifest.FrameCount,
		ChunkSize:      pbManifest.ChunkSize,
		CaptureDelayMs: pbManifest.CaptureDelayMs,
		ChunkCount:     pbManifest.ChunkCount,
	}

	for _, ent := range pbManifest.Entities {
		manifest.Entities = append(manifest.Entities, EntityDef{
			ID:           ent.Id,
			Type:         entityTypeToString(ent.Type),
			Name:         ent.Name,
			Side:         sideToString(ent.Side),
			Group:        ent.GroupName,
			Role:         ent.Role,
			StartFrame:   ent.StartFrame,
			EndFrame:     ent.EndFrame,
			IsPlayer:     ent.IsPlayer,
			VehicleClass: ent.VehicleClass,
		})
	}

	return manifest, nil
}

func (e *ProtobufEngine) GetManifestReader(ctx context.Context, filename string) (io.ReadCloser, error) {
	path := filepath.Join(e.dataDir, filename, "manifest.pb")
	return os.Open(path)
}

func (e *ProtobufEngine) GetChunk(ctx context.Context, filename string, chunkIndex int) (*Chunk, error) {
	path := filepath.Join(e.dataDir, filename, "chunks", fmt.Sprintf("%04d.pb", chunkIndex))
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("read chunk %d: %w", chunkIndex, err)
	}
	defer f.Close()

	data, err := e.readVersionedData(f)
	if err != nil {
		return nil, fmt.Errorf("read chunk %d data: %w", chunkIndex, err)
	}

	var pbChunk pbv1.Chunk
	if err := proto.Unmarshal(data, &pbChunk); err != nil {
		return nil, fmt.Errorf("unmarshal chunk: %w", err)
	}

	chunk := &Chunk{
		Index:      pbChunk.Index,
		StartFrame: pbChunk.StartFrame,
		FrameCount: pbChunk.FrameCount,
	}

	for _, f := range pbChunk.Frames {
		frame := Frame{FrameNum: f.FrameNum}
		for _, es := range f.Entities {
			frame.Entities = append(frame.Entities, EntityState{
				EntityID:    es.EntityId,
				PosX:        es.PosX,
				PosY:        es.PosY,
				Direction:   es.Direction,
				Alive:       es.Alive,
				CrewIDs:     es.CrewIds,
				VehicleID:   es.VehicleId,
				IsInVehicle: es.IsInVehicle,
				Name:        es.Name,
				IsPlayer:    es.IsPlayer,
			})
		}
		chunk.Frames = append(chunk.Frames, frame)
	}

	return chunk, nil
}

func (e *ProtobufEngine) GetChunkReader(ctx context.Context, filename string, chunkIndex int) (io.ReadCloser, error) {
	path := filepath.Join(e.dataDir, filename, "chunks", fmt.Sprintf("%04d.pb", chunkIndex))
	return os.Open(path)
}

func (e *ProtobufEngine) ChunkCount(ctx context.Context, filename string) (int, error) {
	path := filepath.Join(e.dataDir, filename, "manifest.pb")
	f, err := os.Open(path)
	if err != nil {
		return 0, err
	}
	defer f.Close()

	data, err := e.readVersionedData(f)
	if err != nil {
		return 0, err
	}

	var manifest pbv1.Manifest
	if err := proto.Unmarshal(data, &manifest); err != nil {
		return 0, err
	}

	return int(manifest.ChunkCount), nil
}

// readVersionedData reads file data, handling the optional version prefix.
// Files may have a 4-byte version prefix (new format) or not (legacy format).
// This method provides backward compatibility with both formats.
func (e *ProtobufEngine) readVersionedData(f io.ReadSeeker) ([]byte, error) {
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
	// Legacy protobuf files start with a field tag. Common first bytes:
	// - 0x08 (field 1, varint)
	// - 0x0A (field 1, length-delimited)
	// - 0x10 (field 2, varint)
	// - 0x12 (field 2, length-delimited)
	//
	// These are followed by actual data, not zeros.
	// So we can distinguish by checking if bytes 2-4 are all zero.

	// Check if bytes 2-4 are all zero (indicates version prefix)
	hasVersionPrefix := allData[1] == 0 && allData[2] == 0 && allData[3] == 0

	if !hasVersionPrefix {
		// Legacy file without version prefix
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
		return nil, fmt.Errorf("unsupported protobuf schema version: %d", version)
	}
}

func (e *ProtobufEngine) Convert(ctx context.Context, jsonPath, outputPath string) error {
	converter := NewConverter(DefaultChunkSize)
	return converter.Convert(ctx, jsonPath, outputPath, "protobuf")
}

func entityTypeToString(t pbv1.EntityType) string {
	switch t {
	case pbv1.EntityType_ENTITY_TYPE_UNIT:
		return "unit"
	case pbv1.EntityType_ENTITY_TYPE_VEHICLE:
		return "vehicle"
	default:
		return "unknown"
	}
}

func sideToString(s pbv1.Side) string {
	switch s {
	case pbv1.Side_SIDE_WEST:
		return "WEST"
	case pbv1.Side_SIDE_EAST:
		return "EAST"
	case pbv1.Side_SIDE_GUER:
		return "GUER"
	case pbv1.Side_SIDE_CIV:
		return "CIV"
	case pbv1.Side_SIDE_GLOBAL:
		return "GLOBAL"
	default:
		return "UNKNOWN"
	}
}
