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

	pb "github.com/OCAP2/web/schemas/protobuf"
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
	manifest, entityPositions, err := c.parseJSONData(data)
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

// EntityPositionData holds parsed position data for an entity
type entityPositionData struct {
	ID         uint32
	Type       string
	StartFrame uint32
	Positions  []interface{} // Raw position arrays
}

// parseJSONData converts JSON data to protobuf manifest and extracts position data
func (c *Converter) parseJSONData(data map[string]interface{}) (*pb.Manifest, []entityPositionData, error) {
	manifest := &pb.Manifest{
		Version:        1,
		WorldName:      getString(data, "worldName"),
		MissionName:    getString(data, "missionName"),
		FrameCount:     getUint32(data, "endFrame"),
		CaptureDelayMs: uint32(getFloat64(data, "captureDelay") * 1000),
	}

	var entityPositions []entityPositionData

	// Parse entities
	if entities, ok := data["entities"].([]interface{}); ok {
		for _, ent := range entities {
			em, ok := ent.(map[string]interface{})
			if !ok {
				continue
			}

			entityType := getString(em, "type")
			startFrame := getUint32(em, "startFrameNum")
			endFrame := c.calculateEndFrame(em, startFrame)

			def := &pb.EntityDef{
				Id:           getUint32(em, "id"),
				Type:         stringToEntityType(entityType),
				Name:         getString(em, "name"),
				Side:         stringToSide(getString(em, "side")),
				GroupName:    getString(em, "group"),
				Role:         getString(em, "role"),
				StartFrame:   startFrame,
				EndFrame:     endFrame,
				IsPlayer:     getFloat64(em, "isPlayer") == 1,
				VehicleClass: getString(em, "class"),
			}
			manifest.Entities = append(manifest.Entities, def)

			// Collect position data
			if positions, ok := em["positions"].([]interface{}); ok {
				entityPositions = append(entityPositions, entityPositionData{
					ID:         def.Id,
					Type:       entityType,
					StartFrame: startFrame,
					Positions:  positions,
				})
			}
		}
	}

	// Parse events
	if events, ok := data["events"].([]interface{}); ok {
		for _, evt := range events {
			evtArr, ok := evt.([]interface{})
			if !ok || len(evtArr) < 2 {
				continue
			}

			event := c.parseEvent(evtArr)
			if event != nil {
				manifest.Events = append(manifest.Events, event)
			}
		}
	}

	// Parse markers
	if markers, ok := data["Markers"].([]interface{}); ok {
		for _, m := range markers {
			markerArr, ok := m.([]interface{})
			if !ok {
				continue
			}

			marker := c.parseMarker(markerArr)
			if marker != nil {
				manifest.Markers = append(manifest.Markers, marker)
			}
		}
	}

	// Parse times
	if times, ok := data["times"].([]interface{}); ok {
		for _, t := range times {
			tm, ok := t.(map[string]interface{})
			if !ok {
				continue
			}

			timeSample := &pb.TimeSample{
				FrameNum:       getUint32(tm, "frameNum"),
				SystemTimeUtc:  getString(tm, "systemTimeUTC"),
				Date:           getString(tm, "date"),
				TimeMultiplier: float32(getFloat64(tm, "timeMultiplier")),
				Time:           float32(getFloat64(tm, "time")),
			}
			manifest.Times = append(manifest.Times, timeSample)
		}
	}

	return manifest, entityPositions, nil
}

// calculateEndFrame determines the end frame from positions array length
func (c *Converter) calculateEndFrame(em map[string]interface{}, startFrame uint32) uint32 {
	if positions, ok := em["positions"].([]interface{}); ok {
		return startFrame + uint32(len(positions)) - 1
	}
	return startFrame
}

// parseEvent converts a JSON event array to protobuf Event
func (c *Converter) parseEvent(evtArr []interface{}) *pb.Event {
	if len(evtArr) < 2 {
		return nil
	}

	event := &pb.Event{
		FrameNum: uint32(toFloat64(evtArr[0])),
		Type:     toString(evtArr[1]),
	}

	// Parse additional fields based on event type
	// Common format: [frameNum, "type", sourceId, targetId, ...]
	if len(evtArr) > 2 {
		event.SourceId = uint32(toFloat64(evtArr[2]))
	}
	if len(evtArr) > 3 {
		event.TargetId = uint32(toFloat64(evtArr[3]))
	}
	if len(evtArr) > 4 {
		// Could be weapon name, message, or distance depending on event type
		switch v := evtArr[4].(type) {
		case string:
			if event.Type == "hit" || event.Type == "killed" {
				event.Weapon = v
			} else {
				event.Message = v
			}
		case float64:
			event.Distance = float32(v)
		}
	}
	if len(evtArr) > 5 {
		if d, ok := evtArr[5].(float64); ok {
			event.Distance = float32(d)
		}
	}

	return event
}

// parseMarker converts a JSON marker array to protobuf MarkerDef
func (c *Converter) parseMarker(markerArr []interface{}) *pb.MarkerDef {
	// Format: ["type", "text", startFrame, endFrame, playerId, "color", sideIndex, positions, size, "shape", "brush"]
	if len(markerArr) < 7 {
		return nil
	}

	marker := &pb.MarkerDef{
		Type:       toString(markerArr[0]),
		Text:       toString(markerArr[1]),
		StartFrame: uint32(toFloat64(markerArr[2])),
		EndFrame:   uint32(toFloat64(markerArr[3])),
		PlayerId:   int32(toFloat64(markerArr[4])),
		Color:      toString(markerArr[5]),
		Side:       sideIndexToSide(int(toFloat64(markerArr[6]))),
	}

	// Parse positions (index 7)
	if len(markerArr) > 7 {
		if positions, ok := markerArr[7].([]interface{}); ok {
			for _, pos := range positions {
				mp := c.parseMarkerPosition(pos)
				if mp != nil {
					marker.Positions = append(marker.Positions, mp)
				}
			}
		}
	}

	// Parse size (index 8)
	if len(markerArr) > 8 {
		if sizeArr, ok := markerArr[8].([]interface{}); ok {
			for _, s := range sizeArr {
				marker.Size = append(marker.Size, float32(toFloat64(s)))
			}
		}
	}

	// Parse shape (index 9)
	if len(markerArr) > 9 {
		marker.Shape = toString(markerArr[9])
	}

	// Parse brush (index 10)
	if len(markerArr) > 10 {
		marker.Brush = toString(markerArr[10])
	}

	return marker
}

// parseMarkerPosition converts position data to MarkerPosition
func (c *Converter) parseMarkerPosition(pos interface{}) *pb.MarkerPosition {
	// Position format can be: [x, y, z] or [[x, y, z], frameNum, direction, alpha]
	arr, ok := pos.([]interface{})
	if !ok || len(arr) == 0 {
		return nil
	}

	mp := &pb.MarkerPosition{}

	// Check if first element is a position array
	if posArr, ok := arr[0].([]interface{}); ok {
		// Format: [[x, y, z], frameNum, direction, alpha]
		if len(posArr) >= 2 {
			mp.PosX = float32(toFloat64(posArr[0]))
			mp.PosY = float32(toFloat64(posArr[1]))
			if len(posArr) > 2 {
				mp.PosZ = float32(toFloat64(posArr[2]))
			}
		}
		if len(arr) > 1 {
			mp.FrameNum = uint32(toFloat64(arr[1]))
		}
		if len(arr) > 2 {
			mp.Direction = float32(toFloat64(arr[2]))
		}
		if len(arr) > 3 {
			mp.Alpha = float32(toFloat64(arr[3]))
		}
	} else {
		// Simple format: [x, y, z]
		if len(arr) >= 2 {
			mp.PosX = float32(toFloat64(arr[0]))
			mp.PosY = float32(toFloat64(arr[1]))
			if len(arr) > 2 {
				mp.PosZ = float32(toFloat64(arr[2]))
			}
		}
	}

	return mp
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
