// Package storage provides versioned parsers for JSON input formats.
package storage

import "strings"

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
		WorldName:        getString(data, "worldName"),
		MissionName:      getString(data, "missionName"),
		FrameCount:       getUint32(data, "endFrame"),
		ChunkSize:        chunkSize,
		CaptureDelayMs:   uint32(getFloat64(data, "captureDelay") * 1000),
		ExtensionVersion: getString(data, "extensionVersion"),
		AddonVersion:     getString(data, "addonVersion"),
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
				FramesFired:  p.parseFramesFired(em),
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

// calculateEndFrame determines the end frame from positions array length.
// For sparse vehicle positions with [startFrame, endFrame] ranges, uses the last range's end.
func (p *ParserV1) calculateEndFrame(em map[string]interface{}, startFrame uint32) uint32 {
	positions, ok := em["positions"].([]interface{})
	if !ok || len(positions) == 0 {
		return startFrame
	}

	// Check if the last position has a sparse frame range at index 4
	if lastPos, ok := positions[len(positions)-1].([]interface{}); ok && len(lastPos) >= 5 {
		if framesArr, ok := lastPos[4].([]interface{}); ok && len(framesArr) >= 2 {
			return uint32(toFloat64(framesArr[1]))
		}
	}

	return startFrame + uint32(len(positions)) - 1
}

// parseEvent delegates to the package-level parseEventArray.
func (p *ParserV1) parseEvent(evtArr []interface{}) *Event {
	return parseEventArray(evtArr)
}

// parseEventArray converts a JSON event array to schema-agnostic Event.
func parseEventArray(evtArr []interface{}) *Event {
	if len(evtArr) < 2 {
		return nil
	}

	event := &Event{
		FrameNum: uint32(toFloat64(evtArr[0])),
		Type:     toString(evtArr[1]),
	}

	// Connect/disconnect events: [frameNum, "type", "playerName"]
	if event.Type == "connected" || event.Type == "disconnected" {
		if len(evtArr) > 2 {
			event.Message = toString(evtArr[2])
		}
		return event
	}

	// General events: [frameNum, "generalEvent", "message"]
	if event.Type == "generalEvent" {
		if len(evtArr) > 2 {
			event.Message = toString(evtArr[2])
		}
		return event
	}

	// End mission: [frameNum, "endMission", [side, message]] or [frameNum, "endMission", "message"]
	if event.Type == "endMission" {
		if len(evtArr) > 2 {
			if arr, ok := evtArr[2].([]interface{}); ok {
				parts := make([]string, len(arr))
				for i, v := range arr {
					parts[i] = toString(v)
				}
				event.Message = strings.Join(parts, ",")
			} else {
				event.Message = toString(evtArr[2])
			}
		}
		return event
	}

	// Captured and terminal hack events: [frameNum, "type", [data, ...]]
	if event.Type == "captured" || event.Type == "capturedFlag" || event.Type == "terminalHackStarted" || event.Type == "terminalHackCanceled" {
		if len(evtArr) > 2 {
			if arr, ok := evtArr[2].([]interface{}); ok {
				// Build message from string parts, extract position from array elements
				var parts []string
				var posFound bool
				for _, v := range arr {
					if posArr, ok := v.([]interface{}); ok && len(posArr) >= 2 {
						// Position array [x, y, z] — take first found as event position
						if !posFound {
							event.PosX = float32(toFloat64(posArr[0]))
							event.PosY = float32(toFloat64(posArr[1]))
							posFound = true
						}
					} else {
						parts = append(parts, toString(v))
					}
				}
				event.Message = strings.Join(parts, ",")
			}
		}
		return event
	}

	// Parse additional fields based on event type
	// Old extension format for killed/hit: [frameNum, "type", victimId, [killerId, weaponName], distance]
	// Alternative format: [frameNum, "type", sourceId, targetId, weapon, distance]

	// First, detect format by checking if index 3 is an array
	isOldExtensionFormat := false
	if len(evtArr) > 3 {
		_, isOldExtensionFormat = evtArr[3].([]interface{})
	}

	if isOldExtensionFormat {
		// Old extension format: [frameNum, "type", victimId, [killerId, weaponName], distance]
		if len(evtArr) > 2 {
			event.TargetID = uint32(toFloat64(evtArr[2])) // victimId
		}
		if len(evtArr) > 3 {
			if killerArr, ok := evtArr[3].([]interface{}); ok {
				if len(killerArr) > 0 {
					event.SourceID = uint32(toFloat64(killerArr[0])) // killerId
				}
				if len(killerArr) > 1 {
					event.Weapon = toString(killerArr[1]) // weaponName
				}
			}
		}
		if len(evtArr) > 4 {
			if d, ok := evtArr[4].(float64); ok {
				event.Distance = float32(d)
			}
		}
	} else {
		// Alternative format: [frameNum, "type", sourceId, targetId, weapon, distance]
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
	}

	return event
}

// parseMarker converts a JSON marker array to schema-agnostic MarkerDef
func (p *ParserV1) parseMarker(markerArr []interface{}) *MarkerDef {
	// Format: ["type", "text", startFrame, endFrame, playerId, "color", sideIndex, positions, size, "shape", "brush"]
	if len(markerArr) < 7 {
		return nil
	}

	// v1 JSON uses -1 for "forever" markers. Convert to 0 (FrameForever).
	rawEndFrame := toFloat64(markerArr[3])
	var endFrame uint32
	if rawEndFrame < 0 {
		endFrame = 0 // FrameForever
	} else {
		endFrame = uint32(rawEndFrame)
	}

	marker := &MarkerDef{
		Type:       toString(markerArr[0]),
		Text:       toString(markerArr[1]),
		StartFrame: uint32(toFloat64(markerArr[2])),
		EndFrame:   endFrame,
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
	// Position formats:
	// - Old extension format: [frameNum, [x, y], direction, ?alpha]
	// - POLYLINE format: [frameNum, [[x1, y1], [x2, y2], ...], direction, alpha]
	// - Alternative format: [[x, y, z], frameNum, direction, alpha]
	// - Simple format: [x, y, z]
	arr, ok := pos.([]interface{})
	if !ok || len(arr) == 0 {
		return nil
	}

	mp := &MarkerPosition{}

	// Check if second element is a position array (old extension format or POLYLINE)
	if len(arr) > 1 {
		if posArr, ok := arr[1].([]interface{}); ok {
			mp.FrameNum = uint32(toFloat64(arr[0]))

			// Check if this is POLYLINE format: [[x1, y1], [x2, y2], ...]
			// by checking if first element of posArr is also an array
			if len(posArr) > 0 {
				if coordArr, isPolyline := posArr[0].([]interface{}); isPolyline {
					// POLYLINE format: [frameNum, [[x1, y1], [x2, y2], ...], direction, alpha]
					// Store all coordinates as flat array [x1, y1, x2, y2, ...]
					for _, coord := range posArr {
						if xy, ok := coord.([]interface{}); ok && len(xy) >= 2 {
							mp.LineCoords = append(mp.LineCoords, float32(toFloat64(xy[0])))
							mp.LineCoords = append(mp.LineCoords, float32(toFloat64(xy[1])))
						}
					}
					// Set first coordinate as PosX/PosY for backwards compatibility
					if len(coordArr) >= 2 {
						mp.PosX = float32(toFloat64(coordArr[0]))
						mp.PosY = float32(toFloat64(coordArr[1]))
					}
				} else {
					// Old extension format: [frameNum, [x, y], direction, ?alpha]
					if len(posArr) >= 2 {
						mp.PosX = float32(toFloat64(posArr[0]))
						mp.PosY = float32(toFloat64(posArr[1]))
						if len(posArr) > 2 {
							mp.PosZ = float32(toFloat64(posArr[2]))
						}
					}
				}
			}

			if len(arr) > 2 {
				mp.Direction = float32(toFloat64(arr[2]))
			}
			if len(arr) > 3 {
				mp.Alpha = float32(toFloat64(arr[3]))
			}
			// Parse style override fields: [frame, pos, dir, alpha, text, color, size, type, brush, ...]
			if len(arr) > 4 {
				mp.Text = toString(arr[4])
			}
			if len(arr) > 5 {
				mp.Color = toString(arr[5])
			}
			if len(arr) > 6 {
				if sizeArr, ok := arr[6].([]interface{}); ok {
					for _, s := range sizeArr {
						mp.Size = append(mp.Size, float32(toFloat64(s)))
					}
				}
			}
			if len(arr) > 7 {
				mp.Type = toString(arr[7])
			}
			if len(arr) > 8 {
				mp.Brush = toString(arr[8])
			}
			return mp
		}
	}

	// Check if first element is a position array (alternative format)
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

// collectEntityPositions extracts position data for an entity.
// For vehicles with sparse frame ranges ([startFrame, endFrame] at index 4),
// expands each sparse entry into one EntityPosition per frame in the range.
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

		pos := EntityPosition{}

		// Parse position [x, y, z] or [x, y]
		if coords, ok := posArr[0].([]interface{}); ok && len(coords) >= 2 {
			pos.PosX = float32(toFloat64(coords[0]))
			pos.PosY = float32(toFloat64(coords[1]))
			if len(coords) > 2 {
				pos.PosZ = float32(toFloat64(coords[2]))
			}
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
			if len(posArr) > 7 {
				pos.GroupName = toString(posArr[7])
			}
			if len(posArr) > 8 {
				pos.Side = toString(posArr[8])
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

		// Check for sparse frame range (vehicle format with [startFrame, endFrame] at index 4)
		if entityType == "vehicle" && len(posArr) >= 5 {
			if framesArr, ok := posArr[4].([]interface{}); ok && len(framesArr) >= 2 {
				rangeStart := uint32(toFloat64(framesArr[0]))
				rangeEnd := uint32(toFloat64(framesArr[1]))
				// Expand: create one position entry per frame in the range
				for f := rangeStart; f <= rangeEnd; f++ {
					expanded := pos
					expanded.FrameNum = f
					if len(pos.CrewIDs) > 0 {
						expanded.CrewIDs = make([]uint32, len(pos.CrewIDs))
						copy(expanded.CrewIDs, pos.CrewIDs)
					}
					data.Positions = append(data.Positions, expanded)
				}
				continue
			}
		}

		// Dense format: one position per frame
		pos.FrameNum = startFrame + uint32(i)
		data.Positions = append(data.Positions, pos)
	}

	return data
}

// parseFramesFired extracts fired frame data from an entity
// Format: [[frameNum, [x, y, z]], ...]
func (p *ParserV1) parseFramesFired(em map[string]interface{}) []FiredFrame {
	framesFired, ok := em["framesFired"].([]interface{})
	if !ok {
		return nil
	}

	result := make([]FiredFrame, 0, len(framesFired))
	for _, ff := range framesFired {
		arr, ok := ff.([]interface{})
		if !ok || len(arr) < 2 {
			continue
		}

		frame := FiredFrame{
			FrameNum: uint32(toFloat64(arr[0])),
		}

		// Parse position [x, y, z]
		if posArr, ok := arr[1].([]interface{}); ok && len(posArr) >= 2 {
			frame.PosX = float32(toFloat64(posArr[0]))
			frame.PosY = float32(toFloat64(posArr[1]))
			if len(posArr) > 2 {
				frame.PosZ = float32(toFloat64(posArr[2]))
			}
		}

		result = append(result, frame)
	}

	return result
}
