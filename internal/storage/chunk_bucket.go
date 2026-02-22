package storage

import (
	"bufio"
	"encoding/binary"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"

	pbv1 "github.com/OCAP2/web/pkg/schemas/protobuf/v1"
	"google.golang.org/protobuf/proto"
)

// ChunkBucket manages per-chunk temp files for streaming conversion.
// Entity states are written to chunk-specific files during parsing,
// then read back during chunk assembly.
type ChunkBucket struct {
	dir     string
	writers map[uint32]*bufio.Writer
	files   map[uint32]*os.File
	mu      sync.Mutex
}

// NewChunkBucket creates a new bucket in the given directory.
func NewChunkBucket(dir string) (*ChunkBucket, error) {
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("create bucket dir: %w", err)
	}
	return &ChunkBucket{
		dir:     dir,
		writers: make(map[uint32]*bufio.Writer),
		files:   make(map[uint32]*os.File),
	}, nil
}

// Write appends a protobuf EntityState to the temp file for the given chunk index.
// Format: [4-byte little-endian length][protobuf bytes]
func (b *ChunkBucket) Write(chunkIdx uint32, state *pbv1.EntityState) error {
	b.mu.Lock()
	defer b.mu.Unlock()

	w, err := b.getWriter(chunkIdx)
	if err != nil {
		return err
	}

	data, err := proto.Marshal(state)
	if err != nil {
		return fmt.Errorf("marshal entity state: %w", err)
	}

	// Write length prefix
	var lenBuf [4]byte
	binary.LittleEndian.PutUint32(lenBuf[:], uint32(len(data)))
	if _, err := w.Write(lenBuf[:]); err != nil {
		return fmt.Errorf("write length: %w", err)
	}

	// Write protobuf data
	if _, err := w.Write(data); err != nil {
		return fmt.Errorf("write data: %w", err)
	}

	return nil
}

// Flush flushes all buffered writers to disk.
func (b *ChunkBucket) Flush() error {
	b.mu.Lock()
	defer b.mu.Unlock()

	for idx, w := range b.writers {
		if err := w.Flush(); err != nil {
			return fmt.Errorf("flush chunk %d: %w", idx, err)
		}
	}
	// Close all files after flushing
	for idx, f := range b.files {
		if err := f.Close(); err != nil {
			return fmt.Errorf("close chunk %d: %w", idx, err)
		}
		delete(b.files, idx)
		delete(b.writers, idx)
	}
	return nil
}

// Read reads all EntityState records from the temp file for the given chunk index.
func (b *ChunkBucket) Read(chunkIdx uint32) ([]*pbv1.EntityState, error) {
	path := b.chunkPath(chunkIdx)
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("open chunk %d: %w", chunkIdx, err)
	}
	defer f.Close()

	var states []*pbv1.EntityState
	reader := bufio.NewReader(f)

	for {
		// Read length prefix
		var lenBuf [4]byte
		if _, err := io.ReadFull(reader, lenBuf[:]); err != nil {
			if err == io.EOF {
				break
			}
			return nil, fmt.Errorf("read length: %w", err)
		}
		dataLen := binary.LittleEndian.Uint32(lenBuf[:])

		// Read protobuf data
		data := make([]byte, dataLen)
		if _, err := io.ReadFull(reader, data); err != nil {
			return nil, fmt.Errorf("read data: %w", err)
		}

		state := &pbv1.EntityState{}
		if err := proto.Unmarshal(data, state); err != nil {
			return nil, fmt.Errorf("unmarshal entity state: %w", err)
		}
		states = append(states, state)
	}

	return states, nil
}

// Cleanup closes open files and removes the temp directory.
func (b *ChunkBucket) Cleanup() error {
	b.mu.Lock()
	defer b.mu.Unlock()

	var firstErr error
	for _, f := range b.files {
		if err := f.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	b.files = make(map[uint32]*os.File)
	b.writers = make(map[uint32]*bufio.Writer)

	if err := os.RemoveAll(b.dir); err != nil && !os.IsNotExist(err) && firstErr == nil {
		firstErr = err
	}
	return firstErr
}

func (b *ChunkBucket) getWriter(chunkIdx uint32) (*bufio.Writer, error) {
	if w, ok := b.writers[chunkIdx]; ok {
		return w, nil
	}

	path := b.chunkPath(chunkIdx)
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		return nil, fmt.Errorf("open chunk file %d: %w", chunkIdx, err)
	}
	w := bufio.NewWriterSize(f, 64*1024) // 64KB buffer
	b.files[chunkIdx] = f
	b.writers[chunkIdx] = w
	return w, nil
}

func (b *ChunkBucket) chunkPath(chunkIdx uint32) string {
	return filepath.Join(b.dir, fmt.Sprintf("chunk_%04d.tmp", chunkIdx))
}
