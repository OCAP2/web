// server/storage/engine_test.go
package storage

import (
	"context"
	"io"
	"testing"

	"github.com/stretchr/testify/assert"
)

// mockEngine for testing registration
type mockEngine struct {
	name              string
	supportsStreaming bool
}

func (m *mockEngine) Name() string            { return m.name }
func (m *mockEngine) SupportsStreaming() bool { return m.supportsStreaming }
func (m *mockEngine) GetManifest(ctx context.Context, filename string) (*Manifest, error) {
	return nil, nil
}
func (m *mockEngine) GetManifestReader(ctx context.Context, filename string) (io.ReadCloser, error) {
	return nil, nil
}
func (m *mockEngine) GetChunk(ctx context.Context, filename string, chunkIndex int) (*Chunk, error) {
	return nil, nil
}
func (m *mockEngine) GetChunkReader(ctx context.Context, filename string, chunkIndex int) (io.ReadCloser, error) {
	return nil, nil
}
func (m *mockEngine) ChunkCount(ctx context.Context, filename string) (int, error) {
	return 0, nil
}
func (m *mockEngine) Convert(ctx context.Context, jsonPath, outputPath string) error {
	return nil
}

func TestRegisterAndGetEngine(t *testing.T) {
	// Register a mock engine
	mock := &mockEngine{name: "test", supportsStreaming: true}
	RegisterEngine(mock)

	// Get it back
	engine, err := GetEngine("test")
	assert.NoError(t, err)
	assert.Equal(t, "test", engine.Name())
	assert.True(t, engine.SupportsStreaming())

	// Unknown engine should error
	_, err = GetEngine("unknown")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "unknown storage engine")
}

func TestListEngines(t *testing.T) {
	// Register another engine
	RegisterEngine(&mockEngine{name: "another"})

	engines := ListEngines()
	assert.Contains(t, engines, "test")
	assert.Contains(t, engines, "another")
}
