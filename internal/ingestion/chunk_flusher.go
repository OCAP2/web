package ingestion

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"

	pbv2 "github.com/OCAP2/web/pkg/schemas/protobuf/v2"
	"google.golang.org/protobuf/proto"
)

// ChunkFlusher buffers one chunk. Late messages amend their on-disk chunk;
// independent extension workers need not deliver entity types in frame order.
// It is owned by the WebSocket read goroutine.
type ChunkFlusher struct {
	chunksDir     string
	chunkSize     uint32
	current       *pbv2.Chunk
	flushedChunks uint32
}

func NewChunkFlusher(outputDir string, chunkSize uint32) (*ChunkFlusher, error) {
	if chunkSize == 0 {
		return nil, fmt.Errorf("chunk size must be positive")
	}
	dir := filepath.Join(outputDir, "chunks")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, err
	}
	return &ChunkFlusher{chunksDir: dir, chunkSize: chunkSize}, nil
}

func (cf *ChunkFlusher) ChunkSize() uint32  { return cf.chunkSize }
func (cf *ChunkFlusher) ChunkCount() uint32 { return cf.flushedChunks }

func (cf *ChunkFlusher) AddSoldierState(frame uint32, state *pbv2.SoldierState) error {
	return cf.add(frame, func(f *pbv2.Frame) {
		for i, old := range f.Soldiers {
			if old.Id == state.Id {
				f.Soldiers[i] = state
				return
			}
		}
		f.Soldiers = append(f.Soldiers, state)
	})
}

func (cf *ChunkFlusher) AddVehicleState(frame uint32, state *pbv2.VehicleState) error {
	return cf.add(frame, func(f *pbv2.Frame) {
		for i, old := range f.Vehicles {
			if old.Id == state.Id {
				f.Vehicles[i] = state
				return
			}
		}
		f.Vehicles = append(f.Vehicles, state)
	})
}

// SeedFrame makes a chunk independently seekable without repeating unchanged
// states on disk for every frame. Actual samples at the boundary win.
func (cf *ChunkFlusher) SeedFrame(frame uint32, soldiers []*pbv2.SoldierState, vehicles []*pbv2.VehicleState) error {
	return cf.add(frame, func(f *pbv2.Frame) {
		seen := make(map[uint32]bool)
		for _, s := range f.Soldiers {
			seen[s.Id] = true
		}
		for _, s := range soldiers {
			if !seen[s.Id] {
				f.Soldiers = append(f.Soldiers, s)
			}
		}
		seen = make(map[uint32]bool)
		for _, v := range f.Vehicles {
			seen[v.Id] = true
		}
		for _, v := range vehicles {
			if !seen[v.Id] {
				f.Vehicles = append(f.Vehicles, v)
			}
		}
	})
}

func (cf *ChunkFlusher) add(frame uint32, update func(*pbv2.Frame)) error {
	idx := frame / cf.chunkSize
	if cf.current != nil && idx != cf.current.Index {
		if err := cf.Flush(); err != nil {
			return err
		}
	}
	late := idx < cf.flushedChunks
	var chunk *pbv2.Chunk
	if late {
		data, err := os.ReadFile(cf.chunkPath(idx))
		if err != nil {
			return err
		}
		chunk = &pbv2.Chunk{}
		if err := proto.Unmarshal(data, chunk); err != nil {
			return err
		}
	} else {
		if cf.current == nil {
			cf.current = cf.emptyChunk(idx)
		}
		chunk = cf.current
	}
	var target *pbv2.Frame
	for _, f := range chunk.Frames {
		if f.FrameNum == frame {
			target = f
			break
		}
	}
	if target == nil {
		target = &pbv2.Frame{FrameNum: frame}
		chunk.Frames = append(chunk.Frames, target)
	}
	update(target)
	if late {
		return cf.writeChunk(chunk)
	}
	return nil
}

// FlushThrough creates every chunk on the timeline, including event-only spans.
func (cf *ChunkFlusher) FlushThrough(frameCount uint32) error {
	if err := cf.Flush(); err != nil {
		return err
	}
	count := (uint64(frameCount) + uint64(cf.chunkSize) - 1) / uint64(cf.chunkSize)
	// Playback always requests chunk zero, even for a mission with no states.
	if count == 0 {
		count = 1
	}
	for uint64(cf.flushedChunks) < count {
		if err := cf.writeChunk(cf.emptyChunk(cf.flushedChunks)); err != nil {
			return err
		}
		cf.flushedChunks++
	}
	return nil
}

func (cf *ChunkFlusher) Flush() error {
	if cf.current == nil {
		return nil
	}
	for cf.flushedChunks < cf.current.Index {
		if err := cf.writeChunk(cf.emptyChunk(cf.flushedChunks)); err != nil {
			return err
		}
		cf.flushedChunks++
	}
	if err := cf.writeChunk(cf.current); err != nil {
		return err
	}
	cf.flushedChunks = cf.current.Index + 1
	cf.current = nil
	return nil
}

func (cf *ChunkFlusher) emptyChunk(idx uint32) *pbv2.Chunk {
	return &pbv2.Chunk{Index: idx, StartFrame: idx * cf.chunkSize, FrameCount: cf.chunkSize}
}
func (cf *ChunkFlusher) chunkPath(idx uint32) string {
	return filepath.Join(cf.chunksDir, fmt.Sprintf("%04d.pb", idx))
}
func (cf *ChunkFlusher) writeChunk(chunk *pbv2.Chunk) error {
	sort.Slice(chunk.Frames, func(i, j int) bool { return chunk.Frames[i].FrameNum < chunk.Frames[j].FrameNum })
	data, err := proto.Marshal(chunk)
	if err != nil {
		return err
	}
	return writeAtomic(cf.chunkPath(chunk.Index), data)
}

func writeAtomic(path string, data []byte) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".stream-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	_, writeErr := f.Write(data)
	closeErr := f.Close()
	if writeErr != nil {
		return writeErr
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(f.Name(), path)
}
