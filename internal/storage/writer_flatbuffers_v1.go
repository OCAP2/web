package storage

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	fbv1 "github.com/OCAP2/web/pkg/schemas/flatbuffers/v1/generated"
	flatbuffers "github.com/google/flatbuffers/go"
)

func init() {
	RegisterWriter(&FlatBuffersWriterV1{})
}

// FlatBuffersWriterV1 writes ParseResult to FlatBuffers v1 format
type FlatBuffersWriterV1 struct{}

// Version returns the schema version
func (w *FlatBuffersWriterV1) Version() SchemaVersion { return SchemaVersionV1 }

// Format returns the format name
func (w *FlatBuffersWriterV1) Format() string { return "flatbuffers" }

// WriteManifest writes the manifest to a FlatBuffers file with version prefix
func (w *FlatBuffersWriterV1) WriteManifest(ctx context.Context, outputPath string, result *ParseResult) error {
	builder := flatbuffers.NewBuilder(1024 * 1024)

	// Build manifest
	manifestOff := w.toFBManifest(builder, result)
	builder.Finish(manifestOff)

	// Create file
	f, err := os.Create(filepath.Join(outputPath, "manifest.fb"))
	if err != nil {
		return fmt.Errorf("create manifest file: %w", err)
	}
	defer f.Close()

	// Write version prefix (4 bytes, little-endian)
	if err := WriteVersionPrefix(f, SchemaVersionV1); err != nil {
		return fmt.Errorf("write version prefix: %w", err)
	}

	// Write FlatBuffer data
	if _, err := f.Write(builder.FinishedBytes()); err != nil {
		return fmt.Errorf("write manifest data: %w", err)
	}

	return nil
}

// WriteChunks writes all chunks to FlatBuffers files with version prefix
func (w *FlatBuffersWriterV1) WriteChunks(ctx context.Context, outputPath string, result *ParseResult) error {
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

		if err := w.writeChunk(chunksDir, chunkIdx, result); err != nil {
			return fmt.Errorf("write chunk %d: %w", chunkIdx, err)
		}
	}

	return nil
}

// toFBManifest builds a FlatBuffers Manifest from ParseResult
func (w *FlatBuffersWriterV1) toFBManifest(builder *flatbuffers.Builder, result *ParseResult) flatbuffers.UOffsetT {
	// Calculate chunk count
	chunkCount := (result.FrameCount + result.ChunkSize - 1) / result.ChunkSize
	if chunkCount == 0 {
		chunkCount = 1
	}

	// Build entity definitions
	entityOffsets := make([]flatbuffers.UOffsetT, len(result.Entities))
	for i, ent := range result.Entities {
		entityOffsets[i] = w.toFBEntityDef(builder, ent)
	}

	// Build entities vector (must build in reverse order)
	fbv1.ManifestStartEntitiesVector(builder, len(entityOffsets))
	for i := len(entityOffsets) - 1; i >= 0; i-- {
		builder.PrependUOffsetT(entityOffsets[i])
	}
	entitiesVec := builder.EndVector(len(entityOffsets))

	// Build events
	eventOffsets := make([]flatbuffers.UOffsetT, len(result.Events))
	for i, evt := range result.Events {
		eventOffsets[i] = w.toFBEvent(builder, evt)
	}

	// Build events vector
	fbv1.ManifestStartEventsVector(builder, len(eventOffsets))
	for i := len(eventOffsets) - 1; i >= 0; i-- {
		builder.PrependUOffsetT(eventOffsets[i])
	}
	eventsVec := builder.EndVector(len(eventOffsets))

	// Build markers
	markerOffsets := make([]flatbuffers.UOffsetT, len(result.Markers))
	for i, marker := range result.Markers {
		markerOffsets[i] = w.toFBMarker(builder, marker)
	}

	// Build markers vector
	fbv1.ManifestStartMarkersVector(builder, len(markerOffsets))
	for i := len(markerOffsets) - 1; i >= 0; i-- {
		builder.PrependUOffsetT(markerOffsets[i])
	}
	markersVec := builder.EndVector(len(markerOffsets))

	// Build times
	timeOffsets := make([]flatbuffers.UOffsetT, len(result.Times))
	for i, t := range result.Times {
		timeOffsets[i] = w.toFBTimeSample(builder, t)
	}

	// Build times vector
	fbv1.ManifestStartTimesVector(builder, len(timeOffsets))
	for i := len(timeOffsets) - 1; i >= 0; i-- {
		builder.PrependUOffsetT(timeOffsets[i])
	}
	timesVec := builder.EndVector(len(timeOffsets))

	// Build strings
	worldNameOff := builder.CreateString(result.WorldName)
	missionNameOff := builder.CreateString(result.MissionName)
	extensionVersionOff := builder.CreateString(result.ExtensionVersion)
	addonVersionOff := builder.CreateString(result.AddonVersion)

	// Build manifest
	fbv1.ManifestStart(builder)
	fbv1.ManifestAddVersion(builder, uint32(SchemaVersionV1))
	fbv1.ManifestAddWorldName(builder, worldNameOff)
	fbv1.ManifestAddMissionName(builder, missionNameOff)
	fbv1.ManifestAddFrameCount(builder, result.FrameCount)
	fbv1.ManifestAddChunkSize(builder, result.ChunkSize)
	fbv1.ManifestAddCaptureDelayMs(builder, result.CaptureDelayMs)
	fbv1.ManifestAddChunkCount(builder, chunkCount)
	fbv1.ManifestAddEntities(builder, entitiesVec)
	fbv1.ManifestAddEvents(builder, eventsVec)
	fbv1.ManifestAddMarkers(builder, markersVec)
	fbv1.ManifestAddTimes(builder, timesVec)
	fbv1.ManifestAddExtensionVersion(builder, extensionVersionOff)
	fbv1.ManifestAddAddonVersion(builder, addonVersionOff)

	return fbv1.ManifestEnd(builder)
}

// toFBEntityDef builds a FlatBuffers EntityDef
func (w *FlatBuffersWriterV1) toFBEntityDef(builder *flatbuffers.Builder, e EntityDef) flatbuffers.UOffsetT {
	nameOff := builder.CreateString(e.Name)
	groupOff := builder.CreateString(e.Group)
	roleOff := builder.CreateString(e.Role)
	classOff := builder.CreateString(e.VehicleClass)

	fbv1.EntityDefStart(builder)
	fbv1.EntityDefAddId(builder, e.ID)
	fbv1.EntityDefAddType(builder, w.stringToFBEntityType(e.Type))
	fbv1.EntityDefAddName(builder, nameOff)
	fbv1.EntityDefAddSide(builder, w.stringToFBSide(e.Side))
	fbv1.EntityDefAddGroupName(builder, groupOff)
	fbv1.EntityDefAddRole(builder, roleOff)
	fbv1.EntityDefAddStartFrame(builder, e.StartFrame)
	fbv1.EntityDefAddEndFrame(builder, e.EndFrame)
	fbv1.EntityDefAddIsPlayer(builder, e.IsPlayer)
	fbv1.EntityDefAddVehicleClass(builder, classOff)

	return fbv1.EntityDefEnd(builder)
}

// toFBEvent builds a FlatBuffers Event
func (w *FlatBuffersWriterV1) toFBEvent(builder *flatbuffers.Builder, e Event) flatbuffers.UOffsetT {
	typeOff := builder.CreateString(e.Type)
	msgOff := builder.CreateString(e.Message)
	weaponOff := builder.CreateString(e.Weapon)

	fbv1.EventStart(builder)
	fbv1.EventAddFrameNum(builder, e.FrameNum)
	fbv1.EventAddType(builder, typeOff)
	fbv1.EventAddSourceId(builder, e.SourceID)
	fbv1.EventAddTargetId(builder, e.TargetID)
	fbv1.EventAddMessage(builder, msgOff)
	fbv1.EventAddDistance(builder, e.Distance)
	fbv1.EventAddWeapon(builder, weaponOff)

	return fbv1.EventEnd(builder)
}

// toFBMarker builds a FlatBuffers MarkerDef
func (w *FlatBuffersWriterV1) toFBMarker(builder *flatbuffers.Builder, m MarkerDef) flatbuffers.UOffsetT {
	typeOff := builder.CreateString(m.Type)
	textOff := builder.CreateString(m.Text)
	colorOff := builder.CreateString(m.Color)
	shapeOff := builder.CreateString(m.Shape)
	brushOff := builder.CreateString(m.Brush)

	// Build positions
	posOffsets := make([]flatbuffers.UOffsetT, len(m.Positions))
	for i, p := range m.Positions {
		fbv1.MarkerPositionStart(builder)
		fbv1.MarkerPositionAddFrameNum(builder, p.FrameNum)
		fbv1.MarkerPositionAddPosX(builder, p.PosX)
		fbv1.MarkerPositionAddPosY(builder, p.PosY)
		fbv1.MarkerPositionAddPosZ(builder, p.PosZ)
		fbv1.MarkerPositionAddDirection(builder, p.Direction)
		fbv1.MarkerPositionAddAlpha(builder, p.Alpha)
		posOffsets[i] = fbv1.MarkerPositionEnd(builder)
	}

	// Build positions vector
	fbv1.MarkerDefStartPositionsVector(builder, len(posOffsets))
	for i := len(posOffsets) - 1; i >= 0; i-- {
		builder.PrependUOffsetT(posOffsets[i])
	}
	positionsVec := builder.EndVector(len(posOffsets))

	// Build size vector
	fbv1.MarkerDefStartSizeVector(builder, len(m.Size))
	for i := len(m.Size) - 1; i >= 0; i-- {
		builder.PrependFloat32(m.Size[i])
	}
	sizeVec := builder.EndVector(len(m.Size))

	fbv1.MarkerDefStart(builder)
	fbv1.MarkerDefAddType(builder, typeOff)
	fbv1.MarkerDefAddText(builder, textOff)
	fbv1.MarkerDefAddStartFrame(builder, m.StartFrame)
	fbv1.MarkerDefAddEndFrame(builder, m.EndFrame)
	fbv1.MarkerDefAddPlayerId(builder, m.PlayerID)
	fbv1.MarkerDefAddColor(builder, colorOff)
	fbv1.MarkerDefAddSide(builder, w.stringToFBSide(m.Side))
	fbv1.MarkerDefAddSize(builder, sizeVec)
	fbv1.MarkerDefAddShape(builder, shapeOff)
	fbv1.MarkerDefAddBrush(builder, brushOff)
	fbv1.MarkerDefAddPositions(builder, positionsVec)

	return fbv1.MarkerDefEnd(builder)
}

// toFBTimeSample builds a FlatBuffers TimeSample
func (w *FlatBuffersWriterV1) toFBTimeSample(builder *flatbuffers.Builder, t TimeSample) flatbuffers.UOffsetT {
	systemTimeOff := builder.CreateString(t.SystemTimeUTC)
	dateOff := builder.CreateString(t.Date)

	fbv1.TimeSampleStart(builder)
	fbv1.TimeSampleAddFrameNum(builder, t.FrameNum)
	fbv1.TimeSampleAddSystemTimeUtc(builder, systemTimeOff)
	fbv1.TimeSampleAddDate(builder, dateOff)
	fbv1.TimeSampleAddTimeMultiplier(builder, t.TimeMultiplier)
	fbv1.TimeSampleAddTime(builder, t.Time)

	return fbv1.TimeSampleEnd(builder)
}

// writeChunk writes a single chunk file with version prefix
func (w *FlatBuffersWriterV1) writeChunk(chunksDir string, chunkIdx uint32, result *ParseResult) error {
	builder := flatbuffers.NewBuilder(1024 * 1024)

	// Build chunk
	chunkOff := w.buildFBChunk(builder, result, chunkIdx)
	builder.Finish(chunkOff)

	// Create file
	path := filepath.Join(chunksDir, fmt.Sprintf("%04d.fb", chunkIdx))
	f, err := os.Create(path)
	if err != nil {
		return fmt.Errorf("create chunk file: %w", err)
	}
	defer f.Close()

	// Write version prefix (4 bytes, little-endian)
	if err := WriteVersionPrefix(f, SchemaVersionV1); err != nil {
		return fmt.Errorf("write version prefix: %w", err)
	}

	// Write FlatBuffer data
	if _, err := f.Write(builder.FinishedBytes()); err != nil {
		return fmt.Errorf("write chunk data: %w", err)
	}

	return nil
}

// buildFBChunk builds a FlatBuffers Chunk from ParseResult
func (w *FlatBuffersWriterV1) buildFBChunk(builder *flatbuffers.Builder, result *ParseResult, chunkIdx uint32) flatbuffers.UOffsetT {
	startFrame := chunkIdx * result.ChunkSize
	endFrame := startFrame + result.ChunkSize
	if endFrame > result.FrameCount {
		endFrame = result.FrameCount
	}

	// Build frames
	frameOffsets := make([]flatbuffers.UOffsetT, 0, endFrame-startFrame)
	for frameNum := startFrame; frameNum < endFrame; frameNum++ {
		// Build entity states for this frame
		var stateOffsets []flatbuffers.UOffsetT
		for _, ep := range result.EntityPositions {
			state := w.getEntityStateAtFrame(ep, frameNum)
			if state == nil {
				continue
			}

			// Build crew IDs vector if present
			var crewVec flatbuffers.UOffsetT
			if len(state.CrewIDs) > 0 {
				fbv1.EntityStateStartCrewIdsVector(builder, len(state.CrewIDs))
				for i := len(state.CrewIDs) - 1; i >= 0; i-- {
					builder.PrependUint32(state.CrewIDs[i])
				}
				crewVec = builder.EndVector(len(state.CrewIDs))
			}

			nameOff := builder.CreateString(state.Name)

			fbv1.EntityStateStart(builder)
			fbv1.EntityStateAddEntityId(builder, state.EntityID)
			fbv1.EntityStateAddPosX(builder, state.PosX)
			fbv1.EntityStateAddPosY(builder, state.PosY)
			fbv1.EntityStateAddDirection(builder, state.Direction)
			fbv1.EntityStateAddAlive(builder, state.Alive)
			if len(state.CrewIDs) > 0 {
				fbv1.EntityStateAddCrewIds(builder, crewVec)
			}
			fbv1.EntityStateAddVehicleId(builder, state.VehicleID)
			fbv1.EntityStateAddIsInVehicle(builder, state.IsInVehicle)
			fbv1.EntityStateAddName(builder, nameOff)
			fbv1.EntityStateAddIsPlayer(builder, state.IsPlayer)
			stateOffsets = append(stateOffsets, fbv1.EntityStateEnd(builder))
		}

		// Build entities vector
		fbv1.FrameStartEntitiesVector(builder, len(stateOffsets))
		for i := len(stateOffsets) - 1; i >= 0; i-- {
			builder.PrependUOffsetT(stateOffsets[i])
		}
		entitiesVec := builder.EndVector(len(stateOffsets))

		// Build frame
		fbv1.FrameStart(builder)
		fbv1.FrameAddFrameNum(builder, frameNum)
		fbv1.FrameAddEntities(builder, entitiesVec)
		frameOffsets = append(frameOffsets, fbv1.FrameEnd(builder))
	}

	// Build frames vector
	fbv1.ChunkStartFramesVector(builder, len(frameOffsets))
	for i := len(frameOffsets) - 1; i >= 0; i-- {
		builder.PrependUOffsetT(frameOffsets[i])
	}
	framesVec := builder.EndVector(len(frameOffsets))

	// Build chunk
	fbv1.ChunkStart(builder)
	fbv1.ChunkAddIndex(builder, chunkIdx)
	fbv1.ChunkAddStartFrame(builder, startFrame)
	fbv1.ChunkAddFrameCount(builder, endFrame-startFrame)
	fbv1.ChunkAddFrames(builder, framesVec)

	return fbv1.ChunkEnd(builder)
}

// getEntityStateAtFrame extracts entity state at a specific frame
func (w *FlatBuffersWriterV1) getEntityStateAtFrame(ep EntityPositionData, frameNum uint32) *entityStateData {
	for _, pos := range ep.Positions {
		if pos.FrameNum == frameNum {
			return &entityStateData{
				EntityID:    ep.EntityID,
				PosX:        pos.PosX,
				PosY:        pos.PosY,
				Direction:   pos.Direction,
				Alive:       pos.Alive,
				CrewIDs:     pos.CrewIDs,
				VehicleID:   pos.VehicleID,
				IsInVehicle: pos.IsInVehicle,
				Name:        pos.Name,
				IsPlayer:    pos.IsPlayer,
			}
		}
	}
	return nil
}

// entityStateData is an internal struct for entity state data
type entityStateData struct {
	EntityID    uint32
	PosX        float32
	PosY        float32
	Direction   uint32
	Alive       uint32
	CrewIDs     []uint32
	VehicleID   uint32
	IsInVehicle bool
	Name        string
	IsPlayer    bool
}

// stringToFBEntityType converts a string to fbv1.EntityType
func (w *FlatBuffersWriterV1) stringToFBEntityType(s string) fbv1.EntityType {
	switch strings.ToLower(s) {
	case "unit":
		return fbv1.EntityTypeUnit
	case "vehicle":
		return fbv1.EntityTypeVehicle
	default:
		return fbv1.EntityTypeUnknown
	}
}

// stringToFBSide converts a string to fbv1.Side
func (w *FlatBuffersWriterV1) stringToFBSide(s string) fbv1.Side {
	switch strings.ToUpper(s) {
	case "WEST":
		return fbv1.SideWest
	case "EAST":
		return fbv1.SideEast
	case "GUER", "INDEPENDENT":
		return fbv1.SideGuer
	case "CIV", "CIVILIAN":
		return fbv1.SideCiv
	case "GLOBAL":
		return fbv1.SideGlobal
	default:
		return fbv1.SideUnknown
	}
}
