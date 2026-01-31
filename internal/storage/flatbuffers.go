// server/storage/flatbuffers.go
package storage

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"

	fbv1 "github.com/OCAP2/web/pkg/schemas/flatbuffers/v1/generated"
	pbv1 "github.com/OCAP2/web/pkg/schemas/protobuf/v1"
	flatbuffers "github.com/google/flatbuffers/go"
)

// FlatBuffersEngine implements the Engine interface for FlatBuffers format
// FlatBuffers provides zero-copy read access for maximum performance
type FlatBuffersEngine struct {
	dataDir string
}

// NewFlatBuffersEngine creates a new FlatBuffers storage engine
func NewFlatBuffersEngine(dataDir string) *FlatBuffersEngine {
	return &FlatBuffersEngine{dataDir: dataDir}
}

// Name returns the engine identifier
func (e *FlatBuffersEngine) Name() string {
	return "flatbuffers"
}

// SupportsStreaming returns true as FlatBuffers supports chunked loading
func (e *FlatBuffersEngine) SupportsStreaming() bool {
	return true
}

// GetManifest reads and decodes the manifest file
func (e *FlatBuffersEngine) GetManifest(ctx context.Context, filename string) (*Manifest, error) {
	path := filepath.Join(e.dataDir, filename, "manifest.fb")
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("read manifest: %w", err)
	}
	defer f.Close()

	data, err := e.readVersionedData(f)
	if err != nil {
		return nil, fmt.Errorf("read manifest data: %w", err)
	}

	fbManifest := fbv1.GetRootAsManifest(data, 0)
	return e.convertManifest(fbManifest), nil
}

// GetManifestReader returns a reader for raw manifest data
func (e *FlatBuffersEngine) GetManifestReader(ctx context.Context, filename string) (io.ReadCloser, error) {
	path := filepath.Join(e.dataDir, filename, "manifest.fb")
	return os.Open(path)
}

// GetChunk reads and decodes a chunk file
func (e *FlatBuffersEngine) GetChunk(ctx context.Context, filename string, chunkIndex int) (*Chunk, error) {
	path := filepath.Join(e.dataDir, filename, "chunks", fmt.Sprintf("%04d.fb", chunkIndex))
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("read chunk %d: %w", chunkIndex, err)
	}
	defer f.Close()

	data, err := e.readVersionedData(f)
	if err != nil {
		return nil, fmt.Errorf("read chunk %d data: %w", chunkIndex, err)
	}

	fbChunk := fbv1.GetRootAsChunk(data, 0)
	return e.convertChunk(fbChunk), nil
}

// GetChunkReader returns a reader for streaming chunk data
func (e *FlatBuffersEngine) GetChunkReader(ctx context.Context, filename string, chunkIndex int) (io.ReadCloser, error) {
	path := filepath.Join(e.dataDir, filename, "chunks", fmt.Sprintf("%04d.fb", chunkIndex))
	return os.Open(path)
}

// ChunkCount returns the number of chunks by reading manifest
func (e *FlatBuffersEngine) ChunkCount(ctx context.Context, filename string) (int, error) {
	manifest, err := e.GetManifest(ctx, filename)
	if err != nil {
		return 0, err
	}
	return int(manifest.ChunkCount), nil
}

// readVersionedData reads file data, handling the optional version prefix.
// Files may have a 4-byte version prefix (new format) or not (legacy format).
// This method provides backward compatibility with both formats.
func (e *FlatBuffersEngine) readVersionedData(f io.ReadSeeker) ([]byte, error) {
	// Read the entire file
	allData, err := io.ReadAll(f)
	if err != nil {
		return nil, err
	}

	// If file is too small to have version prefix, return as-is
	if len(allData) < versionPrefixSize {
		return allData, nil
	}

	// Check if this looks like a version prefix.
	// Version prefix is 4 bytes little-endian. For small version numbers (1-255),
	// bytes 2, 3, 4 will be zero: [version, 0x00, 0x00, 0x00]
	//
	// FlatBuffers files start with a root table offset (4 bytes little-endian).
	// The minimum offset is typically 16+ bytes (due to file structure).
	// Version numbers are small (1, 2, etc.), so we use the first byte value
	// combined with the zero check on bytes 2-4 to distinguish:
	// - Version prefix: first byte < 16 AND bytes 2-4 are all zero
	// - Legacy FlatBuffers: first byte >= 16 (typical root offsets)
	//
	// This heuristic works because:
	// - Version 1 = [0x01, 0x00, 0x00, 0x00]
	// - FlatBuffers root offset = [0x10+, 0x00, 0x00, 0x00] for small files

	// Check if bytes 2-4 are all zero AND first byte is small (< 16)
	// This distinguishes version prefix from FlatBuffers root offset
	hasVersionPrefix := allData[0] < 16 && allData[1] == 0 && allData[2] == 0 && allData[3] == 0

	if !hasVersionPrefix {
		// Legacy file without version prefix (or FlatBuffers root offset >= 16)
		return allData, nil
	}

	// Looks like a version prefix, read the version
	reader := bytes.NewReader(allData[:versionPrefixSize])
	version, err := ReadVersionPrefix(reader)
	if err != nil {
		// Can't read version, treat entire file as data (legacy)
		return allData, nil
	}

	// Check if version is supported
	switch version {
	case SchemaVersionV1:
		// Version prefix present and valid, skip it
		return allData[versionPrefixSize:], nil
	case SchemaVersionUnknown:
		// Version 0 with zeros in bytes 2-4 - unusual but treat as legacy
		return allData, nil
	default:
		// Unsupported version
		return nil, fmt.Errorf("unsupported flatbuffers schema version: %d", version)
	}
}

// Convert transforms a JSON recording to FlatBuffers format
func (e *FlatBuffersEngine) Convert(ctx context.Context, jsonPath, outputPath string) error {
	// Load JSON data using the converter helper
	converter := NewConverter(DefaultChunkSize)

	data, err := converter.loadJSON(jsonPath)
	if err != nil {
		return fmt.Errorf("load JSON: %w", err)
	}

	pbManifest, entityPositions, err := converter.parseJSONData(data)
	if err != nil {
		return fmt.Errorf("parse JSON: %w", err)
	}

	// Convert protobuf manifest to storage manifest
	manifest := pbManifestToStorageManifest(pbManifest)

	// Create output directory
	chunksDir := filepath.Join(outputPath, "chunks")
	if err := os.MkdirAll(chunksDir, 0755); err != nil {
		return fmt.Errorf("create output directory: %w", err)
	}

	// Calculate chunk count
	chunkCount := (manifest.FrameCount + converter.ChunkSize - 1) / converter.ChunkSize
	if chunkCount == 0 {
		chunkCount = 1
	}
	manifest.ChunkSize = converter.ChunkSize
	manifest.ChunkCount = chunkCount

	// Write manifest
	if err := e.writeManifest(outputPath, manifest); err != nil {
		return fmt.Errorf("write manifest: %w", err)
	}

	// Write chunks
	if err := e.writeChunks(ctx, chunksDir, manifest, entityPositions, converter); err != nil {
		return fmt.Errorf("write chunks: %w", err)
	}

	return nil
}

// convertManifest converts FlatBuffers manifest to storage.Manifest
func (e *FlatBuffersEngine) convertManifest(fbm *fbv1.Manifest) *Manifest {
	manifest := &Manifest{
		Version:        fbm.Version(),
		WorldName:      string(fbm.WorldName()),
		MissionName:    string(fbm.MissionName()),
		FrameCount:     fbm.FrameCount(),
		ChunkSize:      fbm.ChunkSize(),
		CaptureDelayMs: fbm.CaptureDelayMs(),
		ChunkCount:     fbm.ChunkCount(),
	}

	// Convert entities
	for i := 0; i < fbm.EntitiesLength(); i++ {
		var ent fbv1.EntityDef
		if fbm.Entities(&ent, i) {
			manifest.Entities = append(manifest.Entities, EntityDef{
				ID:           ent.Id(),
				Type:         fbEntityTypeToString(ent.Type()),
				Name:         string(ent.Name()),
				Side:         fbSideToString(ent.Side()),
				Group:        string(ent.GroupName()),
				Role:         string(ent.Role()),
				StartFrame:   ent.StartFrame(),
				EndFrame:     ent.EndFrame(),
				IsPlayer:     ent.IsPlayer(),
				VehicleClass: string(ent.VehicleClass()),
			})
		}
	}

	// Convert events
	for i := 0; i < fbm.EventsLength(); i++ {
		var evt fbv1.Event
		if fbm.Events(&evt, i) {
			manifest.Events = append(manifest.Events, Event{
				FrameNum: evt.FrameNum(),
				Type:     string(evt.Type()),
				SourceID: evt.SourceId(),
				TargetID: evt.TargetId(),
				Message:  string(evt.Message()),
				Distance: evt.Distance(),
				Weapon:   string(evt.Weapon()),
			})
		}
	}

	return manifest
}

// convertChunk converts FlatBuffers chunk to storage.Chunk
func (e *FlatBuffersEngine) convertChunk(fbc *fbv1.Chunk) *Chunk {
	chunk := &Chunk{
		Index:      fbc.Index(),
		StartFrame: fbc.StartFrame(),
		FrameCount: fbc.FrameCount(),
	}

	for i := 0; i < fbc.FramesLength(); i++ {
		var frame fbv1.Frame
		if fbc.Frames(&frame, i) {
			f := Frame{
				FrameNum: frame.FrameNum(),
			}

			for j := 0; j < frame.EntitiesLength(); j++ {
				var state fbv1.EntityState
				if frame.Entities(&state, j) {
					es := EntityState{
						EntityID:    state.EntityId(),
						PosX:        state.PosX(),
						PosY:        state.PosY(),
						Direction:   state.Direction(),
						Alive:       state.Alive(),
						VehicleID:   state.VehicleId(),
						IsInVehicle: state.IsInVehicle(),
						Name:        string(state.Name()),
						IsPlayer:    state.IsPlayer(),
					}

					for k := 0; k < state.CrewIdsLength(); k++ {
						es.CrewIDs = append(es.CrewIDs, state.CrewIds(k))
					}

					f.Entities = append(f.Entities, es)
				}
			}

			chunk.Frames = append(chunk.Frames, f)
		}
	}

	return chunk
}

// writeManifest writes the manifest in FlatBuffers format
func (e *FlatBuffersEngine) writeManifest(outputPath string, manifest *Manifest) error {
	builder := flatbuffers.NewBuilder(1024 * 1024)

	// Build entity definitions
	entityOffsets := make([]flatbuffers.UOffsetT, len(manifest.Entities))
	for i, ent := range manifest.Entities {
		nameOff := builder.CreateString(ent.Name)
		groupOff := builder.CreateString(ent.Group)
		roleOff := builder.CreateString(ent.Role)
		classOff := builder.CreateString(ent.VehicleClass)

		fbv1.EntityDefStart(builder)
		fbv1.EntityDefAddId(builder, ent.ID)
		fbv1.EntityDefAddType(builder, stringToFBEntityType(ent.Type))
		fbv1.EntityDefAddName(builder, nameOff)
		fbv1.EntityDefAddSide(builder, stringToFBSide(ent.Side))
		fbv1.EntityDefAddGroupName(builder, groupOff)
		fbv1.EntityDefAddRole(builder, roleOff)
		fbv1.EntityDefAddStartFrame(builder, ent.StartFrame)
		fbv1.EntityDefAddEndFrame(builder, ent.EndFrame)
		fbv1.EntityDefAddIsPlayer(builder, ent.IsPlayer)
		fbv1.EntityDefAddVehicleClass(builder, classOff)
		entityOffsets[i] = fbv1.EntityDefEnd(builder)
	}

	fbv1.ManifestStartEntitiesVector(builder, len(entityOffsets))
	for i := len(entityOffsets) - 1; i >= 0; i-- {
		builder.PrependUOffsetT(entityOffsets[i])
	}
	entitiesVec := builder.EndVector(len(entityOffsets))

	// Build events
	eventOffsets := make([]flatbuffers.UOffsetT, len(manifest.Events))
	for i, evt := range manifest.Events {
		typeOff := builder.CreateString(evt.Type)
		msgOff := builder.CreateString(evt.Message)
		weaponOff := builder.CreateString(evt.Weapon)

		fbv1.EventStart(builder)
		fbv1.EventAddFrameNum(builder, evt.FrameNum)
		fbv1.EventAddType(builder, typeOff)
		fbv1.EventAddSourceId(builder, evt.SourceID)
		fbv1.EventAddTargetId(builder, evt.TargetID)
		fbv1.EventAddMessage(builder, msgOff)
		fbv1.EventAddDistance(builder, evt.Distance)
		fbv1.EventAddWeapon(builder, weaponOff)
		eventOffsets[i] = fbv1.EventEnd(builder)
	}

	fbv1.ManifestStartEventsVector(builder, len(eventOffsets))
	for i := len(eventOffsets) - 1; i >= 0; i-- {
		builder.PrependUOffsetT(eventOffsets[i])
	}
	eventsVec := builder.EndVector(len(eventOffsets))

	// Build manifest
	worldNameOff := builder.CreateString(manifest.WorldName)
	missionNameOff := builder.CreateString(manifest.MissionName)

	fbv1.ManifestStart(builder)
	fbv1.ManifestAddVersion(builder, manifest.Version)
	fbv1.ManifestAddWorldName(builder, worldNameOff)
	fbv1.ManifestAddMissionName(builder, missionNameOff)
	fbv1.ManifestAddFrameCount(builder, manifest.FrameCount)
	fbv1.ManifestAddChunkSize(builder, manifest.ChunkSize)
	fbv1.ManifestAddCaptureDelayMs(builder, manifest.CaptureDelayMs)
	fbv1.ManifestAddChunkCount(builder, manifest.ChunkCount)
	fbv1.ManifestAddEntities(builder, entitiesVec)
	fbv1.ManifestAddEvents(builder, eventsVec)
	manifestOff := fbv1.ManifestEnd(builder)

	builder.Finish(manifestOff)

	path := filepath.Join(outputPath, "manifest.fb")
	return os.WriteFile(path, builder.FinishedBytes(), 0644)
}

// writeChunks writes all chunk files in FlatBuffers format
func (e *FlatBuffersEngine) writeChunks(ctx context.Context, chunksDir string, manifest *Manifest, entityPositions []entityPositionData, converter *Converter) error {
	for chunkIdx := uint32(0); chunkIdx < manifest.ChunkCount; chunkIdx++ {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		startFrame := chunkIdx * manifest.ChunkSize
		endFrame := startFrame + manifest.ChunkSize
		if endFrame > manifest.FrameCount {
			endFrame = manifest.FrameCount
		}

		if err := e.writeChunk(chunksDir, chunkIdx, startFrame, endFrame, entityPositions, converter); err != nil {
			return fmt.Errorf("write chunk %d: %w", chunkIdx, err)
		}
	}
	return nil
}

// writeChunk writes a single chunk file in FlatBuffers format
func (e *FlatBuffersEngine) writeChunk(chunksDir string, chunkIdx, startFrame, endFrame uint32, entityPositions []entityPositionData, converter *Converter) error {
	builder := flatbuffers.NewBuilder(1024 * 1024)

	// Build frames
	frameOffsets := make([]flatbuffers.UOffsetT, 0, endFrame-startFrame)
	for frameNum := startFrame; frameNum < endFrame; frameNum++ {
		// Build entity states for this frame
		var stateOffsets []flatbuffers.UOffsetT
		for _, ep := range entityPositions {
			state := converter.getEntityStateAtFrame(ep, frameNum)
			if state == nil {
				continue
			}

			// Build crew IDs vector if present
			var crewVec flatbuffers.UOffsetT
			if len(state.CrewIds) > 0 {
				fbv1.EntityStateStartCrewIdsVector(builder, len(state.CrewIds))
				for i := len(state.CrewIds) - 1; i >= 0; i-- {
					builder.PrependUint32(state.CrewIds[i])
				}
				crewVec = builder.EndVector(len(state.CrewIds))
			}

			nameOff := builder.CreateString(state.Name)

			fbv1.EntityStateStart(builder)
			fbv1.EntityStateAddEntityId(builder, state.EntityId)
			fbv1.EntityStateAddPosX(builder, state.PosX)
			fbv1.EntityStateAddPosY(builder, state.PosY)
			fbv1.EntityStateAddDirection(builder, state.Direction)
			fbv1.EntityStateAddAlive(builder, state.Alive)
			if len(state.CrewIds) > 0 {
				fbv1.EntityStateAddCrewIds(builder, crewVec)
			}
			fbv1.EntityStateAddVehicleId(builder, state.VehicleId)
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
	chunkOff := fbv1.ChunkEnd(builder)

	builder.Finish(chunkOff)

	path := filepath.Join(chunksDir, fmt.Sprintf("%04d.fb", chunkIdx))
	return os.WriteFile(path, builder.FinishedBytes(), 0644)
}

// Helper functions for type conversion

func fbEntityTypeToString(t fbv1.EntityType) string {
	switch t {
	case fbv1.EntityTypeUnit:
		return "unit"
	case fbv1.EntityTypeVehicle:
		return "vehicle"
	default:
		return "unknown"
	}
}

func stringToFBEntityType(s string) fbv1.EntityType {
	switch s {
	case "unit":
		return fbv1.EntityTypeUnit
	case "vehicle":
		return fbv1.EntityTypeVehicle
	default:
		return fbv1.EntityTypeUnknown
	}
}

func fbSideToString(s fbv1.Side) string {
	switch s {
	case fbv1.SideWest:
		return "WEST"
	case fbv1.SideEast:
		return "EAST"
	case fbv1.SideGuer:
		return "GUER"
	case fbv1.SideCiv:
		return "CIV"
	case fbv1.SideGlobal:
		return "GLOBAL"
	default:
		return "UNKNOWN"
	}
}

func stringToFBSide(s string) fbv1.Side {
	switch s {
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

// pbManifestToStorageManifest converts protobuf manifest to storage.Manifest
func pbManifestToStorageManifest(pbm *pbv1.Manifest) *Manifest {
	manifest := &Manifest{
		Version:        pbm.Version,
		WorldName:      pbm.WorldName,
		MissionName:    pbm.MissionName,
		FrameCount:     pbm.FrameCount,
		ChunkSize:      pbm.ChunkSize,
		CaptureDelayMs: pbm.CaptureDelayMs,
		ChunkCount:     pbm.ChunkCount,
	}

	for _, ent := range pbm.Entities {
		manifest.Entities = append(manifest.Entities, EntityDef{
			ID:           ent.Id,
			Type:         pbEntityTypeToString(ent.Type),
			Name:         ent.Name,
			Side:         pbSideToString(ent.Side),
			Group:        ent.GroupName,
			Role:         ent.Role,
			StartFrame:   ent.StartFrame,
			EndFrame:     ent.EndFrame,
			IsPlayer:     ent.IsPlayer,
			VehicleClass: ent.VehicleClass,
		})
	}

	for _, evt := range pbm.Events {
		manifest.Events = append(manifest.Events, Event{
			FrameNum: evt.FrameNum,
			Type:     evt.Type,
			SourceID: evt.SourceId,
			TargetID: evt.TargetId,
			Message:  evt.Message,
			Distance: evt.Distance,
			Weapon:   evt.Weapon,
		})
	}

	return manifest
}

func pbEntityTypeToString(t pbv1.EntityType) string {
	switch t {
	case pbv1.EntityType_ENTITY_TYPE_UNIT:
		return "unit"
	case pbv1.EntityType_ENTITY_TYPE_VEHICLE:
		return "vehicle"
	default:
		return "unknown"
	}
}

func pbSideToString(s pbv1.Side) string {
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
