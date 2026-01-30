// server/storage/converter.go
package storage

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"google.golang.org/protobuf/proto"

	pb "github.com/OCAP2/web/pkg/schemas/protobuf"
)

// DefaultChunkSize is the default number of frames per chunk (~5 minutes at 1 frame/second)
const DefaultChunkSize = 300

// Converter transforms JSON recordings to chunked protobuf format
type Converter struct {
	ChunkSize uint32
}

// NewConverter creates a converter with the given chunk size
func NewConverter(chunkSize uint32) *Converter {
	if chunkSize == 0 {
		chunkSize = DefaultChunkSize
	}
	return &Converter{ChunkSize: chunkSize}
}

// Convert reads a JSON recording and writes chunked protobuf files
func (c *Converter) Convert(ctx context.Context, jsonPath, outputPath string) error {
	// Load the JSON file
	data, err := c.loadJSON(jsonPath)
	if err != nil {
		return fmt.Errorf("load JSON: %w", err)
	}

	// Parse into protobuf manifest and collect position data
	manifest, entityPositions, err := c.parseJSONDataVersioned(data)
	if err != nil {
		return fmt.Errorf("parse JSON: %w", err)
	}

	// Create output directory structure
	chunksDir := filepath.Join(outputPath, "chunks")
	if err := os.MkdirAll(chunksDir, 0755); err != nil {
		return fmt.Errorf("create output directory: %w", err)
	}

	// Calculate chunk count
	chunkCount := (manifest.FrameCount + c.ChunkSize - 1) / c.ChunkSize
	if chunkCount == 0 {
		chunkCount = 1
	}
	manifest.ChunkSize = c.ChunkSize
	manifest.ChunkCount = chunkCount

	// Write manifest
	if err := c.writeManifest(outputPath, manifest); err != nil {
		return fmt.Errorf("write manifest: %w", err)
	}

	// Write chunks
	if err := c.writeChunks(ctx, chunksDir, manifest, entityPositions); err != nil {
		return fmt.Errorf("write chunks: %w", err)
	}

	return nil
}

// loadJSON reads a JSON file (gzipped or plain)
func (c *Converter) loadJSON(path string) (map[string]interface{}, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var reader io.Reader = f

	// Check if gzipped by trying to read gzip header
	// or by file extension
	if filepath.Ext(path) == ".gz" {
		gr, err := gzip.NewReader(f)
		if err != nil {
			return nil, fmt.Errorf("gzip reader: %w", err)
		}
		defer gr.Close()
		reader = gr
	}

	var data map[string]interface{}
	if err := json.NewDecoder(reader).Decode(&data); err != nil {
		return nil, fmt.Errorf("decode JSON: %w", err)
	}

	return data, nil
}

// parseJSONDataVersioned detects version and uses appropriate parser
func (c *Converter) parseJSONDataVersioned(data map[string]interface{}) (*pb.Manifest, []entityPositionData, error) {
	version := DetectJSONVersion(data)
	if version == JSONVersionUnknown {
		// Fall back to V1 for backwards compatibility
		version = JSONVersionV1
	}

	parser, err := GetParser(version)
	if err != nil {
		return nil, nil, fmt.Errorf("get parser for %s: %w", version.String(), err)
	}

	result, err := parser.Parse(data, c.ChunkSize)
	if err != nil {
		return nil, nil, fmt.Errorf("parse with %s: %w", version.String(), err)
	}

	return result.Manifest, result.EntityPositions, nil
}

// writeManifest writes the manifest protobuf file
func (c *Converter) writeManifest(outputPath string, manifest *pb.Manifest) error {
	data, err := proto.Marshal(manifest)
	if err != nil {
		return fmt.Errorf("marshal manifest: %w", err)
	}

	path := filepath.Join(outputPath, "manifest.pb")
	if err := os.WriteFile(path, data, 0644); err != nil {
		return fmt.Errorf("write manifest file: %w", err)
	}

	return nil
}

// writeChunks writes all chunk files
func (c *Converter) writeChunks(ctx context.Context, chunksDir string, manifest *pb.Manifest, entityPositions []entityPositionData) error {
	// Build frame data by iterating through each chunk
	for chunkIdx := uint32(0); chunkIdx < manifest.ChunkCount; chunkIdx++ {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		startFrame := chunkIdx * c.ChunkSize
		endFrame := startFrame + c.ChunkSize
		if endFrame > manifest.FrameCount {
			endFrame = manifest.FrameCount
		}

		chunk := &pb.Chunk{
			Index:      chunkIdx,
			StartFrame: startFrame,
			FrameCount: endFrame - startFrame,
		}

		// Build frames for this chunk
		for frameNum := startFrame; frameNum < endFrame; frameNum++ {
			frame := &pb.Frame{
				FrameNum: frameNum,
			}

			// Collect entity states for this frame
			for _, ep := range entityPositions {
				state := c.getEntityStateAtFrame(ep, frameNum)
				if state != nil {
					frame.Entities = append(frame.Entities, state)
				}
			}

			chunk.Frames = append(chunk.Frames, frame)
		}

		// Write chunk file
		if err := c.writeChunk(chunksDir, chunkIdx, chunk); err != nil {
			return fmt.Errorf("write chunk %d: %w", chunkIdx, err)
		}
	}

	return nil
}

// getEntityStateAtFrame extracts entity state from position data at a specific frame
func (c *Converter) getEntityStateAtFrame(ep entityPositionData, frameNum uint32) *pb.EntityState {
	// Calculate index into positions array
	if frameNum < ep.StartFrame {
		return nil
	}
	posIdx := int(frameNum - ep.StartFrame)
	if posIdx >= len(ep.Positions) {
		return nil
	}

	posData := ep.Positions[posIdx]
	posArr, ok := posData.([]interface{})
	if !ok || len(posArr) < 3 {
		return nil
	}

	state := &pb.EntityState{
		EntityId: ep.ID,
	}

	// Parse position [x, y, z] or [x, y]
	if coords, ok := posArr[0].([]interface{}); ok && len(coords) >= 2 {
		state.PosX = float32(toFloat64(coords[0]))
		state.PosY = float32(toFloat64(coords[1]))
	}

	// Direction (index 1)
	if len(posArr) > 1 {
		state.Direction = uint32(toFloat64(posArr[1]))
	}

	// Alive status (index 2)
	if len(posArr) > 2 {
		state.Alive = uint32(toFloat64(posArr[2]))
	}

	// Parse type-specific fields
	if ep.Type == "unit" {
		// Unit format: [[x, y, z], direction, alive, isInVehicle, "name", isPlayer]
		if len(posArr) > 3 {
			// isInVehicle can be: 0, 1, or vehicleId
			v := toFloat64(posArr[3])
			if v > 1 {
				state.VehicleId = uint32(v)
				state.IsInVehicle = true
			} else if v == 1 {
				state.IsInVehicle = true
			}
		}
		if len(posArr) > 4 {
			state.Name = toString(posArr[4])
		}
		if len(posArr) > 5 {
			state.IsPlayer = toFloat64(posArr[5]) == 1
		}
	} else if ep.Type == "vehicle" {
		// Vehicle format: [[x, y, z], direction, alive, [crew_ids], [startFrame, endFrame]]
		if len(posArr) > 3 {
			if crewArr, ok := posArr[3].([]interface{}); ok {
				for _, crew := range crewArr {
					state.CrewIds = append(state.CrewIds, uint32(toFloat64(crew)))
				}
			}
		}
	}

	return state
}

// writeChunk writes a single chunk file
func (c *Converter) writeChunk(chunksDir string, index uint32, chunk *pb.Chunk) error {
	data, err := proto.Marshal(chunk)
	if err != nil {
		return fmt.Errorf("marshal chunk: %w", err)
	}

	path := filepath.Join(chunksDir, fmt.Sprintf("%04d.pb", index))
	if err := os.WriteFile(path, data, 0644); err != nil {
		return fmt.Errorf("write chunk file: %w", err)
	}

	return nil
}

// Helper functions for type conversion

func stringToEntityType(s string) pb.EntityType {
	switch s {
	case "unit":
		return pb.EntityType_ENTITY_TYPE_UNIT
	case "vehicle":
		return pb.EntityType_ENTITY_TYPE_VEHICLE
	default:
		return pb.EntityType_ENTITY_TYPE_UNKNOWN
	}
}

func stringToSide(s string) pb.Side {
	switch s {
	case "WEST":
		return pb.Side_SIDE_WEST
	case "EAST":
		return pb.Side_SIDE_EAST
	case "GUER", "INDEPENDENT":
		return pb.Side_SIDE_GUER
	case "CIV", "CIVILIAN":
		return pb.Side_SIDE_CIV
	case "GLOBAL":
		return pb.Side_SIDE_GLOBAL
	default:
		return pb.Side_SIDE_UNKNOWN
	}
}

func sideIndexToSide(idx int) pb.Side {
	switch idx {
	case 0:
		return pb.Side_SIDE_WEST
	case 1:
		return pb.Side_SIDE_EAST
	case 2:
		return pb.Side_SIDE_GUER
	case 3:
		return pb.Side_SIDE_CIV
	default:
		return pb.Side_SIDE_UNKNOWN
	}
}

func toFloat64(v interface{}) float64 {
	if f, ok := v.(float64); ok {
		return f
	}
	return 0
}

func toString(v interface{}) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}
