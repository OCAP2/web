package ingestion

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"google.golang.org/protobuf/proto"

	pbv2 "github.com/OCAP2/web/pkg/schemas/protobuf/v2"
)

// ChunkFlusher writes v2 protobuf chunks incrementally during streaming.
// Every chunkSize frames, accumulated states are flushed to disk.
// All methods are called from a single goroutine (the WebSocket read loop).
type ChunkFlusher struct {
	chunksDir       string
	chunkSize       uint32
	currentChunkIdx uint32
	chunkStartFrame uint32

	// Buffered states keyed by frame number.
	soldierStates map[uint32][]*pbv2.SoldierState
	vehicleStates map[uint32][]*pbv2.VehicleState

	flushedChunks uint32
}

// NewChunkFlusher creates a flusher that writes chunks of chunkSize frames
// to the given output directory.
func NewChunkFlusher(outputDir string, chunkSize uint32) (*ChunkFlusher, error) {
	chunksDir := filepath.Join(outputDir, "chunks")
	if err := os.MkdirAll(chunksDir, 0755); err != nil {
		return nil, fmt.Errorf("create chunks dir: %w", err)
	}
	return &ChunkFlusher{
		chunksDir:     chunksDir,
		chunkSize:     chunkSize,
		soldierStates: make(map[uint32][]*pbv2.SoldierState),
		vehicleStates: make(map[uint32][]*pbv2.VehicleState),
	}, nil
}

// AddSoldierState buffers a soldier state and flushes if a chunk boundary is crossed.
func (cf *ChunkFlusher) AddSoldierState(frameNum uint32, state *pbv2.SoldierState) error {
	cf.soldierStates[frameNum] = append(cf.soldierStates[frameNum], state)
	return cf.maybeFlush(frameNum)
}

// AddVehicleState buffers a vehicle state and flushes if a chunk boundary is crossed.
func (cf *ChunkFlusher) AddVehicleState(frameNum uint32, state *pbv2.VehicleState) error {
	cf.vehicleStates[frameNum] = append(cf.vehicleStates[frameNum], state)
	return cf.maybeFlush(frameNum)
}

// Flush writes any remaining buffered frames as the final chunk.
func (cf *ChunkFlusher) Flush() error {
	if len(cf.soldierStates) == 0 && len(cf.vehicleStates) == 0 {
		return nil
	}
	return cf.writeCurrentChunk()
}

// ChunkCount returns the total number of chunks written (including pending).
func (cf *ChunkFlusher) ChunkCount() uint32 {
	return cf.flushedChunks
}

func (cf *ChunkFlusher) maybeFlush(frameNum uint32) error {
	// Check if this frame crosses the next chunk boundary.
	chunkEnd := cf.chunkStartFrame + cf.chunkSize
	if frameNum >= chunkEnd {
		return cf.writeCurrentChunk()
	}
	return nil
}

func (cf *ChunkFlusher) writeCurrentChunk() error {
	// Collect all frame numbers in this chunk.
	frameSet := make(map[uint32]bool)
	for f := range cf.soldierStates {
		frameSet[f] = true
	}
	for f := range cf.vehicleStates {
		frameSet[f] = true
	}

	if len(frameSet) == 0 {
		return nil
	}

	// Sort frame numbers.
	frames := make([]uint32, 0, len(frameSet))
	for f := range frameSet {
		frames = append(frames, f)
	}
	sort.Slice(frames, func(i, j int) bool { return frames[i] < frames[j] })

	// Determine which frames belong to the current chunk vs next.
	chunkEnd := cf.chunkStartFrame + cf.chunkSize
	var currentFrames, nextFrames []uint32
	for _, f := range frames {
		if f < chunkEnd {
			currentFrames = append(currentFrames, f)
		} else {
			nextFrames = append(nextFrames, f)
		}
	}

	// Build and write the current chunk from currentFrames.
	if len(currentFrames) > 0 {
		chunk := cf.buildChunk(cf.currentChunkIdx, cf.chunkStartFrame, currentFrames)
		if err := cf.writeChunkFile(chunk); err != nil {
			return err
		}

		// Remove flushed frames from buffers.
		for _, f := range currentFrames {
			delete(cf.soldierStates, f)
			delete(cf.vehicleStates, f)
		}

		cf.flushedChunks++
		cf.currentChunkIdx++
		cf.chunkStartFrame = chunkEnd
	}

	// If we have frames that spill into the next chunk, check again.
	// (Typically only one chunk boundary is crossed per state message.)
	if len(nextFrames) > 0 {
		// The next frames are already in the buffer, check if they cross another boundary.
		maxNext := nextFrames[len(nextFrames)-1]
		if maxNext >= cf.chunkStartFrame+cf.chunkSize {
			return cf.writeCurrentChunk()
		}
	}

	return nil
}

func (cf *ChunkFlusher) buildChunk(idx, startFrame uint32, frameNums []uint32) *pbv2.Chunk {
	chunk := &pbv2.Chunk{
		Index:      idx,
		StartFrame: startFrame,
		FrameCount: cf.chunkSize,
	}

	for _, fn := range frameNums {
		frame := &pbv2.Frame{
			FrameNum: fn,
			Soldiers: cf.soldierStates[fn],
			Vehicles: cf.vehicleStates[fn],
		}
		chunk.Frames = append(chunk.Frames, frame)
	}

	return chunk
}

func (cf *ChunkFlusher) writeChunkFile(chunk *pbv2.Chunk) error {
	data, err := proto.Marshal(chunk)
	if err != nil {
		return fmt.Errorf("marshal chunk %d: %w", chunk.Index, err)
	}

	path := filepath.Join(cf.chunksDir, fmt.Sprintf("%04d.pb", chunk.Index))
	if err := os.WriteFile(path, data, 0644); err != nil {
		return fmt.Errorf("write chunk %d: %w", chunk.Index, err)
	}

	return nil
}
