package storage

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/proto"

	pbv1 "github.com/OCAP2/web/pkg/schemas/protobuf/v1"
)

// TestStreamingConverter_RealFile tests against a real mission file.
// Skipped if the file doesn't exist (CI won't have it).
func TestStreamingConverter_RealFile(t *testing.T) {
	realFile := "/mnt/c/Users/info/Downloads/2026_02_15__21_45_OperationOkenraven.json.gz"
	if _, err := os.Stat(realFile); os.IsNotExist(err) {
		t.Skipf("real file not found at %s", realFile)
	}

	outputPath := filepath.Join(t.TempDir(), "output")

	converter := NewConverter(DefaultChunkSize)
	ctx := context.Background()
	require.NoError(t, converter.Convert(ctx, realFile, outputPath))

	// Verify manifest
	manifestData, err := os.ReadFile(filepath.Join(outputPath, "manifest.pb"))
	require.NoError(t, err)

	var manifest pbv1.Manifest
	require.NoError(t, proto.Unmarshal(manifestData, &manifest))

	assert.NotEmpty(t, manifest.WorldName)
	assert.NotEmpty(t, manifest.MissionName)
	assert.Greater(t, manifest.FrameCount, uint32(0))
	assert.Greater(t, len(manifest.Entities), 0)
	t.Logf("Manifest: %s on %s, %d frames, %d entities, %d events, %d chunks",
		manifest.MissionName, manifest.WorldName, manifest.FrameCount,
		len(manifest.Entities), len(manifest.Events), manifest.ChunkCount)

	// Verify each chunk exists and is valid
	for i := uint32(0); i < manifest.ChunkCount; i++ {
		chunkPath := filepath.Join(outputPath, "chunks", fmt.Sprintf("%04d.pb", i))
		assert.FileExists(t, chunkPath)

		if i == 0 {
			// Spot-check first chunk
			data, err := os.ReadFile(chunkPath)
			require.NoError(t, err)
			var chunk pbv1.Chunk
			require.NoError(t, proto.Unmarshal(data, &chunk))
			assert.Equal(t, uint32(0), chunk.Index)
			assert.NotEmpty(t, chunk.Frames)
			assert.NotEmpty(t, chunk.Frames[0].Entities)
			t.Logf("Chunk 0: %d frames, first frame has %d entities",
				len(chunk.Frames), len(chunk.Frames[0].Entities))
		}
	}
}
