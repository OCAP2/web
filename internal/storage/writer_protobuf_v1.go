package storage

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"google.golang.org/protobuf/proto"

	pbv1 "github.com/OCAP2/web/pkg/schemas/protobuf/v1"
)

func init() {
	RegisterWriter(&ProtobufWriterV1{})
}

// ProtobufWriterV1 writes ParseResult to protobuf v1 format
type ProtobufWriterV1 struct{}

// Version returns the schema version
func (w *ProtobufWriterV1) Version() SchemaVersion { return SchemaVersionV1 }

// Format returns the format name
func (w *ProtobufWriterV1) Format() string { return "protobuf" }

// WriteManifest writes the manifest to a protobuf file with version prefix
func (w *ProtobufWriterV1) WriteManifest(ctx context.Context, outputPath string, result *ParseResult) error {
	// Convert ParseResult to pbv1.Manifest
	manifest := w.toProtoManifest(result)

	// Create file
	f, err := os.Create(filepath.Join(outputPath, "manifest.pb"))
	if err != nil {
		return fmt.Errorf("create manifest file: %w", err)
	}
	defer f.Close()

	// Write version prefix (4 bytes, little-endian)
	if err := WriteVersionPrefix(f, SchemaVersionV1); err != nil {
		return fmt.Errorf("write version prefix: %w", err)
	}

	// Write protobuf data
	data, err := proto.Marshal(manifest)
	if err != nil {
		return fmt.Errorf("marshal manifest: %w", err)
	}
	if _, err := f.Write(data); err != nil {
		return fmt.Errorf("write manifest data: %w", err)
	}

	return nil
}

// WriteChunks writes all chunks to protobuf files with version prefix
func (w *ProtobufWriterV1) WriteChunks(ctx context.Context, outputPath string, result *ParseResult) error {
	// Create chunks directory
	chunksDir := filepath.Join(outputPath, "chunks")
	if err := os.MkdirAll(chunksDir, 0755); err != nil {
		return fmt.Errorf("create chunks directory: %w", err)
	}

	// Calculate chunk count
	chunkCount := (result.FrameCount + result.ChunkSize - 1) / result.ChunkSize
	if chunkCount == 0 {
		chunkCount = 1
	}

	// Write each chunk
	for chunkIdx := uint32(0); chunkIdx < chunkCount; chunkIdx++ {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		chunk := w.buildChunk(result, chunkIdx)
		if err := w.writeChunk(chunksDir, chunkIdx, chunk); err != nil {
			return fmt.Errorf("write chunk %d: %w", chunkIdx, err)
		}
	}

	return nil
}

// toProtoManifest converts ParseResult to pbv1.Manifest
func (w *ProtobufWriterV1) toProtoManifest(result *ParseResult) *pbv1.Manifest {
	// Calculate chunk count
	chunkCount := (result.FrameCount + result.ChunkSize - 1) / result.ChunkSize
	if chunkCount == 0 {
		chunkCount = 1
	}

	manifest := &pbv1.Manifest{
		Version:          uint32(SchemaVersionV1),
		WorldName:        result.WorldName,
		MissionName:      result.MissionName,
		FrameCount:       result.FrameCount,
		ChunkSize:        result.ChunkSize,
		CaptureDelayMs:   result.CaptureDelayMs,
		ChunkCount:       chunkCount,
		ExtensionVersion: result.ExtensionVersion,
		AddonVersion:     result.AddonVersion,
	}

	// Convert entities
	for _, e := range result.Entities {
		manifest.Entities = append(manifest.Entities, w.toProtoEntityDef(e))
	}

	// Convert events
	for _, e := range result.Events {
		manifest.Events = append(manifest.Events, w.toProtoEvent(e))
	}

	// Convert markers
	for _, m := range result.Markers {
		manifest.Markers = append(manifest.Markers, w.toProtoMarker(m))
	}

	// Convert times
	for _, t := range result.Times {
		manifest.Times = append(manifest.Times, w.toProtoTimeSample(t))
	}

	return manifest
}

// toProtoEntityDef converts schema-agnostic EntityDef to pbv1.EntityDef
func (w *ProtobufWriterV1) toProtoEntityDef(e EntityDef) *pbv1.EntityDef {
	def := &pbv1.EntityDef{
		Id:           e.ID,
		Type:         w.stringToEntityType(e.Type),
		Name:         e.Name,
		Side:         w.stringToSide(e.Side),
		GroupName:    e.Group,
		Role:         e.Role,
		StartFrame:   e.StartFrame,
		EndFrame:     e.EndFrame,
		IsPlayer:     e.IsPlayer,
		VehicleClass: e.VehicleClass,
	}

	// Convert frames fired
	for _, ff := range e.FramesFired {
		def.FramesFired = append(def.FramesFired, &pbv1.FiredFrame{
			FrameNum: ff.FrameNum,
			PosX:     ff.PosX,
			PosY:     ff.PosY,
			PosZ:     ff.PosZ,
		})
	}

	return def
}

// toProtoEvent converts schema-agnostic Event to pbv1.Event
func (w *ProtobufWriterV1) toProtoEvent(e Event) *pbv1.Event {
	return &pbv1.Event{
		FrameNum: e.FrameNum,
		Type:     e.Type,
		SourceId: e.SourceID,
		TargetId: e.TargetID,
		Message:  e.Message,
		Distance: e.Distance,
		Weapon:   e.Weapon,
	}
}

// toProtoMarker converts schema-agnostic MarkerDef to pbv1.MarkerDef
func (w *ProtobufWriterV1) toProtoMarker(m MarkerDef) *pbv1.MarkerDef {
	marker := &pbv1.MarkerDef{
		Type:       m.Type,
		Text:       m.Text,
		StartFrame: m.StartFrame,
		EndFrame:   m.EndFrame,
		PlayerId:   m.PlayerID,
		Color:      m.Color,
		Side:       w.stringToSide(m.Side),
		Size:       m.Size,
		Shape:      m.Shape,
		Brush:      m.Brush,
	}

	// Convert positions
	for _, p := range m.Positions {
		marker.Positions = append(marker.Positions, &pbv1.MarkerPosition{
			FrameNum:   p.FrameNum,
			PosX:       p.PosX,
			PosY:       p.PosY,
			PosZ:       p.PosZ,
			Direction:  p.Direction,
			Alpha:      p.Alpha,
			LineCoords: p.LineCoords,
		})
	}

	return marker
}

// toProtoTimeSample converts schema-agnostic TimeSample to pbv1.TimeSample
func (w *ProtobufWriterV1) toProtoTimeSample(t TimeSample) *pbv1.TimeSample {
	return &pbv1.TimeSample{
		FrameNum:       t.FrameNum,
		SystemTimeUtc:  t.SystemTimeUTC,
		Date:           t.Date,
		TimeMultiplier: t.TimeMultiplier,
		Time:           t.Time,
	}
}

// buildChunk builds a protobuf Chunk from EntityPositions for the given chunk index
func (w *ProtobufWriterV1) buildChunk(result *ParseResult, chunkIdx uint32) *pbv1.Chunk {
	startFrame := chunkIdx * result.ChunkSize
	endFrame := startFrame + result.ChunkSize
	if endFrame > result.FrameCount {
		endFrame = result.FrameCount
	}

	chunk := &pbv1.Chunk{
		Index:      chunkIdx,
		StartFrame: startFrame,
		FrameCount: endFrame - startFrame,
	}

	// Build frames for this chunk
	for frameNum := startFrame; frameNum < endFrame; frameNum++ {
		frame := &pbv1.Frame{
			FrameNum: frameNum,
		}

		// Collect entity states for this frame
		for _, ep := range result.EntityPositions {
			state := w.getEntityStateAtFrame(ep, frameNum)
			if state != nil {
				frame.Entities = append(frame.Entities, state)
			}
		}

		chunk.Frames = append(chunk.Frames, frame)
	}

	return chunk
}

// getEntityStateAtFrame extracts entity state at a specific frame
func (w *ProtobufWriterV1) getEntityStateAtFrame(ep EntityPositionData, frameNum uint32) *pbv1.EntityState {
	// Find position for this frame
	for _, pos := range ep.Positions {
		if pos.FrameNum == frameNum {
			return &pbv1.EntityState{
				EntityId:    ep.EntityID,
				PosX:        pos.PosX,
				PosY:        pos.PosY,
				Direction:   pos.Direction,
				Alive:       pos.Alive,
				CrewIds:     pos.CrewIDs,
				VehicleId:   pos.VehicleID,
				IsInVehicle: pos.IsInVehicle,
				Name:        pos.Name,
				IsPlayer:    pos.IsPlayer,
			}
		}
	}
	return nil
}

// writeChunk writes a single chunk file with version prefix
func (w *ProtobufWriterV1) writeChunk(chunksDir string, index uint32, chunk *pbv1.Chunk) error {
	path := filepath.Join(chunksDir, fmt.Sprintf("%04d.pb", index))
	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("create chunk file: %w", err)
	}
	defer f.Close()

	// Write version prefix (4 bytes, little-endian)
	if err := WriteVersionPrefix(f, SchemaVersionV1); err != nil {
		return fmt.Errorf("write version prefix: %w", err)
	}

	// Write protobuf data
	data, err := proto.Marshal(chunk)
	if err != nil {
		return fmt.Errorf("marshal chunk: %w", err)
	}
	if _, err := f.Write(data); err != nil {
		return fmt.Errorf("write chunk data: %w", err)
	}

	return nil
}

// stringToEntityType converts a string to pbv1.EntityType
func (w *ProtobufWriterV1) stringToEntityType(s string) pbv1.EntityType {
	switch strings.ToLower(s) {
	case "unit":
		return pbv1.EntityType_ENTITY_TYPE_UNIT
	case "vehicle":
		return pbv1.EntityType_ENTITY_TYPE_VEHICLE
	default:
		return pbv1.EntityType_ENTITY_TYPE_UNKNOWN
	}
}

// stringToSide converts a string to pbv1.Side
func (w *ProtobufWriterV1) stringToSide(s string) pbv1.Side {
	switch strings.ToUpper(s) {
	case "WEST":
		return pbv1.Side_SIDE_WEST
	case "EAST":
		return pbv1.Side_SIDE_EAST
	case "GUER", "INDEPENDENT":
		return pbv1.Side_SIDE_GUER
	case "CIV", "CIVILIAN":
		return pbv1.Side_SIDE_CIV
	case "GLOBAL":
		return pbv1.Side_SIDE_GLOBAL
	default:
		return pbv1.Side_SIDE_UNKNOWN
	}
}
