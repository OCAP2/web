// server/storage/protobuf.go
package storage

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"google.golang.org/protobuf/proto"

	pbv1 "github.com/OCAP2/web/pkg/schemas/protobuf/v1"
)

// ProtobufEngine reads chunked protobuf recordings
type ProtobufEngine struct {
	dataDir string
}

// NewProtobufEngine creates a protobuf engine for the given data directory
func NewProtobufEngine(dataDir string) *ProtobufEngine {
	return &ProtobufEngine{dataDir: dataDir}
}

func (e *ProtobufEngine) SupportsStreaming() bool { return true }

func (e *ProtobufEngine) GetManifest(ctx context.Context, filename string) (*Manifest, error) {
	path := filepath.Join(e.dataDir, filename, "manifest.pb")
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("read manifest: %w", err)
	}
	defer f.Close()

	data, err := io.ReadAll(f)
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

	data, err := io.ReadAll(f)
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
