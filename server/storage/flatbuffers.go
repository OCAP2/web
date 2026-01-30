// server/storage/flatbuffers.go
package storage

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"

	fb "github.com/OCAP2/web/schemas/flatbuffers/generated"
	pb "github.com/OCAP2/web/schemas/protobuf"
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
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read manifest: %w", err)
	}

	fbManifest := fb.GetRootAsManifest(data, 0)
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
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read chunk %d: %w", chunkIndex, err)
	}

	fbChunk := fb.GetRootAsChunk(data, 0)
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
func (e *FlatBuffersEngine) convertManifest(fbm *fb.Manifest) *Manifest {
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
		var ent fb.EntityDef
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
		var evt fb.Event
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
func (e *FlatBuffersEngine) convertChunk(fbc *fb.Chunk) *Chunk {
	chunk := &Chunk{
		Index:      fbc.Index(),
		StartFrame: fbc.StartFrame(),
		FrameCount: fbc.FrameCount(),
	}

	for i := 0; i < fbc.FramesLength(); i++ {
		var frame fb.Frame
		if fbc.Frames(&frame, i) {
			f := Frame{
				FrameNum: frame.FrameNum(),
			}

			for j := 0; j < frame.EntitiesLength(); j++ {
				var state fb.EntityState
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

		fb.EntityDefStart(builder)
		fb.EntityDefAddId(builder, ent.ID)
		fb.EntityDefAddType(builder, stringToFBEntityType(ent.Type))
		fb.EntityDefAddName(builder, nameOff)
		fb.EntityDefAddSide(builder, stringToFBSide(ent.Side))
		fb.EntityDefAddGroupName(builder, groupOff)
		fb.EntityDefAddRole(builder, roleOff)
		fb.EntityDefAddStartFrame(builder, ent.StartFrame)
		fb.EntityDefAddEndFrame(builder, ent.EndFrame)
		fb.EntityDefAddIsPlayer(builder, ent.IsPlayer)
		fb.EntityDefAddVehicleClass(builder, classOff)
		entityOffsets[i] = fb.EntityDefEnd(builder)
	}

	fb.ManifestStartEntitiesVector(builder, len(entityOffsets))
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

		fb.EventStart(builder)
		fb.EventAddFrameNum(builder, evt.FrameNum)
		fb.EventAddType(builder, typeOff)
		fb.EventAddSourceId(builder, evt.SourceID)
		fb.EventAddTargetId(builder, evt.TargetID)
		fb.EventAddMessage(builder, msgOff)
		fb.EventAddDistance(builder, evt.Distance)
		fb.EventAddWeapon(builder, weaponOff)
		eventOffsets[i] = fb.EventEnd(builder)
	}

	fb.ManifestStartEventsVector(builder, len(eventOffsets))
	for i := len(eventOffsets) - 1; i >= 0; i-- {
		builder.PrependUOffsetT(eventOffsets[i])
	}
	eventsVec := builder.EndVector(len(eventOffsets))

	// Build manifest
	worldNameOff := builder.CreateString(manifest.WorldName)
	missionNameOff := builder.CreateString(manifest.MissionName)

	fb.ManifestStart(builder)
	fb.ManifestAddVersion(builder, manifest.Version)
	fb.ManifestAddWorldName(builder, worldNameOff)
	fb.ManifestAddMissionName(builder, missionNameOff)
	fb.ManifestAddFrameCount(builder, manifest.FrameCount)
	fb.ManifestAddChunkSize(builder, manifest.ChunkSize)
	fb.ManifestAddCaptureDelayMs(builder, manifest.CaptureDelayMs)
	fb.ManifestAddChunkCount(builder, manifest.ChunkCount)
	fb.ManifestAddEntities(builder, entitiesVec)
	fb.ManifestAddEvents(builder, eventsVec)
	manifestOff := fb.ManifestEnd(builder)

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
				fb.EntityStateStartCrewIdsVector(builder, len(state.CrewIds))
				for i := len(state.CrewIds) - 1; i >= 0; i-- {
					builder.PrependUint32(state.CrewIds[i])
				}
				crewVec = builder.EndVector(len(state.CrewIds))
			}

			nameOff := builder.CreateString(state.Name)

			fb.EntityStateStart(builder)
			fb.EntityStateAddEntityId(builder, state.EntityId)
			fb.EntityStateAddPosX(builder, state.PosX)
			fb.EntityStateAddPosY(builder, state.PosY)
			fb.EntityStateAddDirection(builder, state.Direction)
			fb.EntityStateAddAlive(builder, state.Alive)
			if len(state.CrewIds) > 0 {
				fb.EntityStateAddCrewIds(builder, crewVec)
			}
			fb.EntityStateAddVehicleId(builder, state.VehicleId)
			fb.EntityStateAddIsInVehicle(builder, state.IsInVehicle)
			fb.EntityStateAddName(builder, nameOff)
			fb.EntityStateAddIsPlayer(builder, state.IsPlayer)
			stateOffsets = append(stateOffsets, fb.EntityStateEnd(builder))
		}

		// Build entities vector
		fb.FrameStartEntitiesVector(builder, len(stateOffsets))
		for i := len(stateOffsets) - 1; i >= 0; i-- {
			builder.PrependUOffsetT(stateOffsets[i])
		}
		entitiesVec := builder.EndVector(len(stateOffsets))

		// Build frame
		fb.FrameStart(builder)
		fb.FrameAddFrameNum(builder, frameNum)
		fb.FrameAddEntities(builder, entitiesVec)
		frameOffsets = append(frameOffsets, fb.FrameEnd(builder))
	}

	// Build frames vector
	fb.ChunkStartFramesVector(builder, len(frameOffsets))
	for i := len(frameOffsets) - 1; i >= 0; i-- {
		builder.PrependUOffsetT(frameOffsets[i])
	}
	framesVec := builder.EndVector(len(frameOffsets))

	// Build chunk
	fb.ChunkStart(builder)
	fb.ChunkAddIndex(builder, chunkIdx)
	fb.ChunkAddStartFrame(builder, startFrame)
	fb.ChunkAddFrameCount(builder, endFrame-startFrame)
	fb.ChunkAddFrames(builder, framesVec)
	chunkOff := fb.ChunkEnd(builder)

	builder.Finish(chunkOff)

	path := filepath.Join(chunksDir, fmt.Sprintf("%04d.fb", chunkIdx))
	return os.WriteFile(path, builder.FinishedBytes(), 0644)
}

// Helper functions for type conversion

func fbEntityTypeToString(t fb.EntityType) string {
	switch t {
	case fb.EntityTypeUnit:
		return "unit"
	case fb.EntityTypeVehicle:
		return "vehicle"
	default:
		return "unknown"
	}
}

func stringToFBEntityType(s string) fb.EntityType {
	switch s {
	case "unit":
		return fb.EntityTypeUnit
	case "vehicle":
		return fb.EntityTypeVehicle
	default:
		return fb.EntityTypeUnknown
	}
}

func fbSideToString(s fb.Side) string {
	switch s {
	case fb.SideWest:
		return "WEST"
	case fb.SideEast:
		return "EAST"
	case fb.SideGuer:
		return "GUER"
	case fb.SideCiv:
		return "CIV"
	case fb.SideGlobal:
		return "GLOBAL"
	default:
		return "UNKNOWN"
	}
}

func stringToFBSide(s string) fb.Side {
	switch s {
	case "WEST":
		return fb.SideWest
	case "EAST":
		return fb.SideEast
	case "GUER", "INDEPENDENT":
		return fb.SideGuer
	case "CIV", "CIVILIAN":
		return fb.SideCiv
	case "GLOBAL":
		return fb.SideGlobal
	default:
		return fb.SideUnknown
	}
}

// pbManifestToStorageManifest converts protobuf manifest to storage.Manifest
func pbManifestToStorageManifest(pbm *pb.Manifest) *Manifest {
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

func pbEntityTypeToString(t pb.EntityType) string {
	switch t {
	case pb.EntityType_ENTITY_TYPE_UNIT:
		return "unit"
	case pb.EntityType_ENTITY_TYPE_VEHICLE:
		return "vehicle"
	default:
		return "unknown"
	}
}

func pbSideToString(s pb.Side) string {
	switch s {
	case pb.Side_SIDE_WEST:
		return "WEST"
	case pb.Side_SIDE_EAST:
		return "EAST"
	case pb.Side_SIDE_GUER:
		return "GUER"
	case pb.Side_SIDE_CIV:
		return "CIV"
	case pb.Side_SIDE_GLOBAL:
		return "GLOBAL"
	default:
		return "UNKNOWN"
	}
}
