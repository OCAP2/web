// Package storage provides versioned parsers for JSON input formats.
package storage

func init() {
	RegisterParser(&ParserV1{})
}

// ParserV1 parses JSON input version 1 (current Arma 3 format)
type ParserV1 struct{}

// Version returns the JSON input version this parser handles
func (p *ParserV1) Version() JSONInputVersion {
	return JSONInputVersionV1
}

// Parse converts JSON data to schema-agnostic ParseResult
func (p *ParserV1) Parse(data map[string]interface{}, chunkSize uint32) (*ParseResult, error) {
	result := &ParseResult{
		WorldName:      getString(data, "worldName"),
		MissionName:    getString(data, "missionName"),
		FrameCount:     getUint32(data, "endFrame"),
		ChunkSize:      chunkSize,
		CaptureDelayMs: uint32(getFloat64(data, "captureDelay") * 1000),
	}

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

			def := EntityDef{
				ID:           getUint32(em, "id"),
				Type:         entityType,
				Name:         getString(em, "name"),
				Side:         getString(em, "side"),
				Group:        getString(em, "group"),
				Role:         getString(em, "role"),
				StartFrame:   startFrame,
				EndFrame:     endFrame,
				IsPlayer:     getFloat64(em, "isPlayer") == 1,
				VehicleClass: getString(em, "class"),
			}
			result.Entities = append(result.Entities, def)

			// Collect position data
			positionData := p.collectEntityPositions(em, def.ID, startFrame, entityType)
			if positionData != nil {
				result.EntityPositions = append(result.EntityPositions, *positionData)
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
				result.Events = append(result.Events, *event)
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
				result.Markers = append(result.Markers, *marker)
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

			timeSample := TimeSample{
				FrameNum:       getUint32(tm, "frameNum"),
				SystemTimeUTC:  getString(tm, "systemTimeUTC"),
				Date:           getString(tm, "date"),
				TimeMultiplier: float32(getFloat64(tm, "timeMultiplier")),
				Time:           float32(getFloat64(tm, "time")),
			}
			result.Times = append(result.Times, timeSample)
		}
	}

	return result, nil
}

// calculateEndFrame determines the end frame from positions array length
func (p *ParserV1) calculateEndFrame(em map[string]interface{}, startFrame uint32) uint32 {
	if positions, ok := em["positions"].([]interface{}); ok {
		return startFrame + uint32(len(positions)) - 1
	}
	return startFrame
}

// parseEvent converts a JSON event array to schema-agnostic Event
func (p *ParserV1) parseEvent(evtArr []interface{}) *Event {
	if len(evtArr) < 2 {
		return nil
	}

	event := &Event{
		FrameNum: uint32(toFloat64(evtArr[0])),
		Type:     toString(evtArr[1]),
	}

	// Parse additional fields based on event type
	// Common format: [frameNum, "type", sourceId, targetId, ...]
	if len(evtArr) > 2 {
		event.SourceID = uint32(toFloat64(evtArr[2]))
	}
	if len(evtArr) > 3 {
		event.TargetID = uint32(toFloat64(evtArr[3]))
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

// parseMarker converts a JSON marker array to schema-agnostic MarkerDef
func (p *ParserV1) parseMarker(markerArr []interface{}) *MarkerDef {
	// Format: ["type", "text", startFrame, endFrame, playerId, "color", sideIndex, positions, size, "shape", "brush"]
	if len(markerArr) < 7 {
		return nil
	}

	marker := &MarkerDef{
		Type:       toString(markerArr[0]),
		Text:       toString(markerArr[1]),
		StartFrame: uint32(toFloat64(markerArr[2])),
		EndFrame:   uint32(toFloat64(markerArr[3])),
		PlayerID:   int32(toFloat64(markerArr[4])),
		Color:      toString(markerArr[5]),
		Side:       sideIndexToString(int(toFloat64(markerArr[6]))),
	}

	// Parse positions (index 7)
	if len(markerArr) > 7 {
		if positions, ok := markerArr[7].([]interface{}); ok {
			for _, pos := range positions {
				mp := p.parseMarkerPosition(pos)
				if mp != nil {
					marker.Positions = append(marker.Positions, *mp)
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
func (p *ParserV1) parseMarkerPosition(pos interface{}) *MarkerPosition {
	// Position format can be: [x, y, z] or [[x, y, z], frameNum, direction, alpha]
	arr, ok := pos.([]interface{})
	if !ok || len(arr) == 0 {
		return nil
	}

	mp := &MarkerPosition{}

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

// collectEntityPositions extracts position data for an entity
func (p *ParserV1) collectEntityPositions(em map[string]interface{}, entityID uint32, startFrame uint32, entityType string) *EntityPositionData {
	positions, ok := em["positions"].([]interface{})
	if !ok {
		return nil
	}

	data := &EntityPositionData{
		EntityID:  entityID,
		Positions: make([]EntityPosition, 0, len(positions)),
	}

	for i, posData := range positions {
		posArr, ok := posData.([]interface{})
		if !ok || len(posArr) < 3 {
			continue
		}

		pos := EntityPosition{
			FrameNum: startFrame + uint32(i),
		}

		// Parse position [x, y, z] or [x, y]
		if coords, ok := posArr[0].([]interface{}); ok && len(coords) >= 2 {
			pos.PosX = float32(toFloat64(coords[0]))
			pos.PosY = float32(toFloat64(coords[1]))
		}

		// Direction (index 1)
		if len(posArr) > 1 {
			pos.Direction = uint32(toFloat64(posArr[1]))
		}

		// Alive status (index 2)
		if len(posArr) > 2 {
			pos.Alive = uint32(toFloat64(posArr[2]))
		}

		// Parse type-specific fields
		if entityType == "unit" {
			// Unit format: [[x, y, z], direction, alive, isInVehicle, "name", isPlayer]
			if len(posArr) > 3 {
				// isInVehicle can be: 0, 1, or vehicleId
				v := toFloat64(posArr[3])
				if v > 1 {
					pos.VehicleID = uint32(v)
					pos.IsInVehicle = true
				} else if v == 1 {
					pos.IsInVehicle = true
				}
			}
			if len(posArr) > 4 {
				pos.Name = toString(posArr[4])
			}
			if len(posArr) > 5 {
				pos.IsPlayer = toFloat64(posArr[5]) == 1
			}
		} else if entityType == "vehicle" {
			// Vehicle format: [[x, y, z], direction, alive, [crew_ids], [startFrame, endFrame]]
			if len(posArr) > 3 {
				if crewArr, ok := posArr[3].([]interface{}); ok {
					for _, crew := range crewArr {
						pos.CrewIDs = append(pos.CrewIDs, uint32(toFloat64(crew)))
					}
				}
			}
		}

		data.Positions = append(data.Positions, pos)
	}

	return data
}

// sideIndexToString converts a side index to side string
func sideIndexToString(idx int) string {
	switch idx {
	case 0:
		return "WEST"
	case 1:
		return "EAST"
	case 2:
		return "GUER"
	case 3:
		return "CIV"
	default:
		return ""
	}
}
