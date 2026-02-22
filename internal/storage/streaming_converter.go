package storage

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"google.golang.org/protobuf/proto"

	pbv1 "github.com/OCAP2/web/pkg/schemas/protobuf/v1"
)

// DefaultChunkSize is the default number of frames per chunk (~5 minutes at 1 frame/second)
const DefaultChunkSize = 300

// Converter transforms JSON recordings to chunked protobuf format
// using streaming I/O to minimize memory usage.
type Converter struct {
	ChunkSize uint32
}

// NewConverter creates a converter with the given chunk size.
func NewConverter(chunkSize uint32) *Converter {
	if chunkSize == 0 {
		chunkSize = DefaultChunkSize
	}
	return &Converter{ChunkSize: chunkSize}
}

// Convert reads a JSON recording and writes chunked protobuf output files.
// It processes the JSON in a single pass, streaming entities directly from
// the decoder and bucketing positions to per-chunk temp files on disk.
func (sc *Converter) Convert(ctx context.Context, jsonPath, outputPath string) error {
	// Open streaming reader
	reader, err := OpenStreamingJSONReader(jsonPath)
	if err != nil {
		return fmt.Errorf("open JSON: %w", err)
	}
	defer reader.Close()

	// Create output directory
	if err := os.MkdirAll(outputPath, 0755); err != nil {
		return fmt.Errorf("create output directory: %w", err)
	}

	// Create temp bucket for chunk data
	bucketDir := filepath.Join(outputPath, ".tmp_chunks")
	bucket, err := NewChunkBucket(bucketDir)
	if err != nil {
		return fmt.Errorf("create chunk bucket: %w", err)
	}
	defer func() {
		bucket.Cleanup()
		os.RemoveAll(bucketDir)
	}()

	// Accumulators for manifest data (small — entities defs, events, markers, times)
	var entities []*pbv1.EntityDef
	var events []*pbv1.Event
	var markers []*pbv1.MarkerDef
	var times []*pbv1.TimeSample
	parser := &ParserV1{}

	// Single-pass processing: read the entire JSON sequentially,
	// streaming entities one-by-one and bucketing their positions to disk
	meta, err := reader.Process(StreamingCallbacks{
		OnEntity: func(em map[string]interface{}) error {
			select {
			case <-ctx.Done():
				return ctx.Err()
			default:
			}

			entityType := getString(em, "type")
			startFrame := getUint32(em, "startFrameNum")
			endFrame := parser.calculateEndFrame(em, startFrame)

			// Build entity definition for manifest
			def := &pbv1.EntityDef{
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

			// Parse frames fired
			for _, ff := range parser.parseFramesFired(em) {
				def.FramesFired = append(def.FramesFired, &pbv1.FiredFrame{
					FrameNum: ff.FrameNum,
					PosX:     ff.PosX,
					PosY:     ff.PosY,
					PosZ:     ff.PosZ,
				})
			}

			entities = append(entities, def)

			// Collect positions and bucket them to disk
			posData := parser.collectEntityPositions(em, def.Id, startFrame, entityType)
			if posData != nil {
				for _, pos := range posData.Positions {
					chunkIdx := pos.FrameNum / sc.ChunkSize
					state := &pbv1.EntityState{
						EntityId:    posData.EntityID,
						FrameNum:    pos.FrameNum,
						PosX:        pos.PosX,
						PosY:        pos.PosY,
						PosZ:        pos.PosZ,
						Direction:   pos.Direction,
						Alive:       pos.Alive,
						CrewIds:     pos.CrewIDs,
						VehicleId:   pos.VehicleID,
						IsInVehicle: pos.IsInVehicle,
						Name:        pos.Name,
						IsPlayer:    pos.IsPlayer,
						GroupName:   pos.GroupName,
						Side:        pos.Side,
					}
					if err := bucket.Write(chunkIdx, state); err != nil {
						return fmt.Errorf("bucket write: %w", err)
					}
				}
			}

			return nil
		},

		OnEvent: func(evtArr []interface{}) error {
			evt := parseEventArray(evtArr)
			if evt != nil {
				events = append(events, &pbv1.Event{
					FrameNum: evt.FrameNum,
					Type:     evt.Type,
					SourceId: evt.SourceID,
					TargetId: evt.TargetID,
					Message:  evt.Message,
					Distance: evt.Distance,
					Weapon:   evt.Weapon,
				})
			}
			return nil
		},

		OnMarker: func(markerArr []interface{}) error {
			m := parser.parseMarker(markerArr)
			if m != nil {
				pbMarker := &pbv1.MarkerDef{
					Type:       m.Type,
					Text:       m.Text,
					StartFrame: m.StartFrame,
					EndFrame:   m.EndFrame,
					PlayerId:   m.PlayerID,
					Color:      m.Color,
					Side:       stringToSide(m.Side),
					Size:       m.Size,
					Shape:      m.Shape,
					Brush:      m.Brush,
				}
				for _, p := range m.Positions {
					pbMarker.Positions = append(pbMarker.Positions, &pbv1.MarkerPosition{
						FrameNum:   p.FrameNum,
						PosX:       p.PosX,
						PosY:       p.PosY,
						PosZ:       p.PosZ,
						Direction:  p.Direction,
						Alpha:      p.Alpha,
						LineCoords: p.LineCoords,
					})
				}
				markers = append(markers, pbMarker)
			}
			return nil
		},

		OnTime: func(tm map[string]interface{}) error {
			times = append(times, &pbv1.TimeSample{
				FrameNum:       getUint32(tm, "frameNum"),
				SystemTimeUtc:  getString(tm, "systemTimeUTC"),
				Date:           getString(tm, "date"),
				TimeMultiplier: float32(getFloat64(tm, "timeMultiplier")),
				Time:           float32(getFloat64(tm, "time")),
			})
			return nil
		},
	})
	if err != nil {
		return fmt.Errorf("process JSON: %w", err)
	}

	// Validate required fields
	if meta.WorldName == "" || meta.MissionName == "" || meta.FrameCount == 0 {
		return fmt.Errorf("unknown JSON input version: missing required fields")
	}

	// Flush bucket before reading
	if err := bucket.Flush(); err != nil {
		return fmt.Errorf("flush bucket: %w", err)
	}

	// Phase 2: Assemble chunks
	chunksDir := filepath.Join(outputPath, "chunks")
	if err := os.MkdirAll(chunksDir, 0755); err != nil {
		return fmt.Errorf("create chunks directory: %w", err)
	}

	chunkCount := (meta.FrameCount + sc.ChunkSize - 1) / sc.ChunkSize
	if chunkCount == 0 {
		chunkCount = 1
	}

	for chunkIdx := uint32(0); chunkIdx < chunkCount; chunkIdx++ {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		if err := sc.assembleChunk(bucket, chunksDir, chunkIdx, meta.FrameCount); err != nil {
			return fmt.Errorf("assemble chunk %d: %w", chunkIdx, err)
		}
	}

	// Phase 3: Write manifest
	manifest := &pbv1.Manifest{
		Version:          uint32(SchemaVersionV1),
		WorldName:        meta.WorldName,
		MissionName:      meta.MissionName,
		FrameCount:       meta.FrameCount,
		ChunkSize:        sc.ChunkSize,
		CaptureDelayMs:   meta.CaptureDelayMs,
		ChunkCount:       chunkCount,
		ExtensionVersion: meta.ExtensionVersion,
		AddonVersion:     meta.AddonVersion,
		Entities:         entities,
		Events:           events,
		Markers:          markers,
		Times:            times,
	}

	data, err := proto.Marshal(manifest)
	if err != nil {
		return fmt.Errorf("marshal manifest: %w", err)
	}
	if err := os.WriteFile(filepath.Join(outputPath, "manifest.pb"), data, 0644); err != nil {
		return fmt.Errorf("write manifest: %w", err)
	}

	return nil
}

// assembleChunk reads entity states from the bucket, groups by frame, and writes the chunk.
func (sc *Converter) assembleChunk(bucket *ChunkBucket, chunksDir string, chunkIdx uint32, frameCount uint32) error {
	states, err := bucket.Read(chunkIdx)
	if err != nil {
		return fmt.Errorf("read bucket: %w", err)
	}

	startFrame := chunkIdx * sc.ChunkSize
	endFrame := startFrame + sc.ChunkSize
	if endFrame > frameCount {
		endFrame = frameCount
	}

	// Group states by frame number
	frameMap := make(map[uint32][]*pbv1.EntityState)
	for _, s := range states {
		frameMap[s.FrameNum] = append(frameMap[s.FrameNum], s)
	}

	chunk := &pbv1.Chunk{
		Index:      chunkIdx,
		StartFrame: startFrame,
		FrameCount: endFrame - startFrame,
	}

	for frameNum := startFrame; frameNum < endFrame; frameNum++ {
		frame := &pbv1.Frame{
			FrameNum: frameNum,
		}
		if frameStates, ok := frameMap[frameNum]; ok {
			for _, s := range frameStates {
				// Clear frame_num before writing (it's only used in temp files)
				s.FrameNum = 0
				frame.Entities = append(frame.Entities, s)
			}
		}
		chunk.Frames = append(chunk.Frames, frame)
	}

	// Marshal and write
	data, err := proto.Marshal(chunk)
	if err != nil {
		return fmt.Errorf("marshal chunk: %w", err)
	}

	path := filepath.Join(chunksDir, fmt.Sprintf("%04d.pb", chunkIdx))
	if err := os.WriteFile(path, data, 0644); err != nil {
		return fmt.Errorf("write chunk: %w", err)
	}

	return nil
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
