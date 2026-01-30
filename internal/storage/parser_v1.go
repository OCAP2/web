// internal/storage/parser_v1.go
package storage

import (
	pb "github.com/OCAP2/web/pkg/schemas/protobuf"
)

func init() {
	RegisterParser(&ParserV1{})
}

// ParserV1 parses the original OCAP JSON format (version 1)
type ParserV1 struct{}

// Version returns JSONVersionV1
func (p *ParserV1) Version() JSONVersion {
	return JSONVersionV1
}

// Parse converts V1 JSON data to ParseResult
func (p *ParserV1) Parse(data map[string]interface{}, chunkSize uint32) (*ParseResult, error) {
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
			endFrame := p.calculateEndFrame(em, startFrame)

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

			event := p.parseEvent(evtArr)
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

			marker := p.parseMarker(markerArr)
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

	return &ParseResult{
		Manifest:        manifest,
		EntityPositions: entityPositions,
	}, nil
}

// calculateEndFrame determines the end frame from positions array length
func (p *ParserV1) calculateEndFrame(em map[string]interface{}, startFrame uint32) uint32 {
	if positions, ok := em["positions"].([]interface{}); ok {
		return startFrame + uint32(len(positions)) - 1
	}
	return startFrame
}

// parseEvent converts a JSON event array to protobuf Event
func (p *ParserV1) parseEvent(evtArr []interface{}) *pb.Event {
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
func (p *ParserV1) parseMarker(markerArr []interface{}) *pb.MarkerDef {
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
				mp := p.parseMarkerPosition(pos)
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
func (p *ParserV1) parseMarkerPosition(pos interface{}) *pb.MarkerPosition {
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
