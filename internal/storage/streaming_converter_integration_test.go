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
// Set OCAP_LARGE_TEST_FILE to enable (skipped otherwise).
func TestStreamingConverter_RealFile(t *testing.T) {
	realFile := os.Getenv("OCAP_LARGE_TEST_FILE")
	if realFile == "" {
		t.Skip("skipping: OCAP_LARGE_TEST_FILE not set")
	}
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
	assert.Greater(t, manifest.EndFrame, uint32(0))
	assert.Greater(t, len(manifest.Entities), 0)
	t.Logf("Manifest: %s on %s, endFrame %d, %d entities, %d events, %d chunks",
		manifest.MissionName, manifest.WorldName, manifest.EndFrame,
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

	// Player snapshots must have left the manifest for their own sidecars —
	// that is what keeps the up-front download small on a real recording.
	for _, e := range manifest.Events {
		require.False(t, IsPlayerSnapshotEvent(e.Type),
			"player snapshot %s left in manifest", e.Type)
	}

	var sidecarBytes int64
	for _, unitID := range manifest.SnapshotUnitIds {
		path := filepath.Join(outputPath, SnapshotsDirName, fmt.Sprintf("%d.pb", unitID))
		info, err := os.Stat(path)
		require.NoError(t, err)
		sidecarBytes += info.Size()

		data, err := os.ReadFile(path)
		require.NoError(t, err)
		var series pbv1.PlayerSnapshotSeries
		require.NoError(t, proto.Unmarshal(data, &series))
		require.Equal(t, unitID, series.UnitId)
		require.NotEmpty(t, series.Events)
	}

	if len(manifest.SnapshotUnitIds) > 0 {
		t.Logf("Manifest: %d KB up front; %d snapshot sidecars totalling %d KB, largest fetched on demand",
			len(manifestData)/1024, len(manifest.SnapshotUnitIds), sidecarBytes/1024)
	}
}
