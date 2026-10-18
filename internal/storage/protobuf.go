// server/storage/protobuf.go
package storage

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"

	pbv1 "github.com/OCAP2/web/pkg/schemas/protobuf/v1"
	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/proto"
)

// ProtobufEngine reads chunked protobuf recordings
type ProtobufEngine struct {
	dataDir string
}

// NewProtobufEngine creates a protobuf engine for the given data directory
func NewProtobufEngine(dataDir string) *ProtobufEngine {
	return &ProtobufEngine{dataDir: dataDir}
}

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
	if protobufVersion(data) == 2 {
		return readV2Manifest(data)
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
		EndFrame:       pbManifest.EndFrame,
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

	for _, evt := range pbManifest.Events {
		manifest.Events = append(manifest.Events, Event{
			FrameNum:   evt.FrameNum,
			Type:       evt.Type,
			SourceID:   evt.SourceId,
			TargetID:   evt.TargetId,
			Message:    evt.Message,
			Distance:   evt.Distance,
			Weapon:     evt.Weapon,
			PosX:       evt.PosX,
			PosY:       evt.PosY,
			ObjectType: evt.ObjectType,
			UnitName:   evt.UnitName,
			Side:       evt.Side,
		})
	}

	return manifest, nil
}

func protobufVersion(data []byte) uint64 {
	for len(data) > 0 {
		num, typ, n := protowire.ConsumeTag(data)
		if n < 0 {
			return 0
		}
		data = data[n:]
		if num == 1 && typ == protowire.VarintType {
			v, _ := protowire.ConsumeVarint(data)
			return v
		}
		n = protowire.ConsumeFieldValue(num, typ, data)
		if n < 0 {
			return 0
		}
		data = data[n:]
	}
	return 0
}

func (e *ProtobufEngine) Convert(ctx context.Context, jsonPath, outputPath string) error {
	if data, err := os.ReadFile(filepath.Join(outputPath, "manifest.pb")); err == nil && protobufVersion(data) >= 2 {
		return fmt.Errorf("cannot replace a native v2 recording with legacy conversion")
	}
	converter := NewConverter(DefaultChunkSize)
	return converter.Convert(ctx, jsonPath, outputPath)
}
