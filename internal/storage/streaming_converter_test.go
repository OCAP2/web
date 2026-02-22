package storage

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/proto"

	pbv1 "github.com/OCAP2/web/pkg/schemas/protobuf/v1"
)

// TestStreamingConverter_MatchesOldConverter verifies the streaming converter
// produces identical output to the old converter for the same input.
func TestStreamingConverter_MatchesOldConverter(t *testing.T) {
	// Re-register real parser (parser_test.go tests may have replaced it with mocks)
	RegisterParser(&ParserV1{})

	tmpDir := t.TempDir()
	inputPath := filepath.Join(tmpDir, "test.json")
	oldOutputPath := filepath.Join(tmpDir, "old_output")
	newOutputPath := filepath.Join(tmpDir, "new_output")

	testData := map[string]interface{}{
		"worldName":    "Altis",
		"missionName":  "Test Mission",
		"endFrame":     10,
		"captureDelay": 1.0,
		"entities": []interface{}{
			map[string]interface{}{
				"id": 0, "type": "unit", "name": "Player1", "side": "WEST",
				"group": "Alpha", "role": "Rifleman", "startFrameNum": 0, "isPlayer": 1.0,
				"positions": []interface{}{
					[]interface{}{[]interface{}{100.0, 200.0, 0.0}, 90.0, 1.0, 0.0, "Player1", 1.0},
					[]interface{}{[]interface{}{101.0, 201.0, 0.0}, 91.0, 1.0, 0.0, "Player1", 1.0},
					[]interface{}{[]interface{}{102.0, 202.0, 0.0}, 92.0, 1.0, 0.0, "Player1", 1.0},
					[]interface{}{[]interface{}{103.0, 203.0, 0.0}, 93.0, 1.0, 0.0, "Player1", 1.0},
					[]interface{}{[]interface{}{104.0, 204.0, 0.0}, 94.0, 1.0, 0.0, "Player1", 1.0},
					[]interface{}{[]interface{}{105.0, 205.0, 0.0}, 95.0, 1.0, 0.0, "Player1", 1.0},
					[]interface{}{[]interface{}{106.0, 206.0, 0.0}, 96.0, 1.0, 0.0, "Player1", 1.0},
					[]interface{}{[]interface{}{107.0, 207.0, 0.0}, 97.0, 1.0, 0.0, "Player1", 1.0},
					[]interface{}{[]interface{}{108.0, 208.0, 0.0}, 98.0, 0.0, 0.0, "Player1", 1.0},
					[]interface{}{[]interface{}{108.0, 208.0, 0.0}, 98.0, 0.0, 0.0, "Player1", 1.0},
				},
			},
			map[string]interface{}{
				"id": 1, "type": "vehicle", "name": "Truck", "class": "B_Truck_01",
				"startFrameNum": 0,
				"positions": []interface{}{
					[]interface{}{[]interface{}{500.0, 600.0, 0.0}, 180.0, 1.0, []interface{}{}},
					[]interface{}{[]interface{}{500.0, 600.0, 0.0}, 180.0, 1.0, []interface{}{}},
					[]interface{}{[]interface{}{500.0, 600.0, 0.0}, 180.0, 1.0, []interface{}{}},
					[]interface{}{[]interface{}{500.0, 600.0, 0.0}, 180.0, 1.0, []interface{}{0.0}},
					[]interface{}{[]interface{}{510.0, 610.0, 0.0}, 185.0, 1.0, []interface{}{0.0}},
					[]interface{}{[]interface{}{520.0, 620.0, 0.0}, 190.0, 1.0, []interface{}{0.0}},
					[]interface{}{[]interface{}{530.0, 630.0, 0.0}, 195.0, 1.0, []interface{}{}},
					[]interface{}{[]interface{}{530.0, 630.0, 0.0}, 195.0, 1.0, []interface{}{}},
					[]interface{}{[]interface{}{530.0, 630.0, 0.0}, 195.0, 1.0, []interface{}{}},
					[]interface{}{[]interface{}{530.0, 630.0, 0.0}, 195.0, 1.0, []interface{}{}},
				},
			},
		},
		"events": []interface{}{
			[]interface{}{8.0, "killed", 0.0, 0.0, "arifle_MX"},
		},
		"Markers": []interface{}{
			[]interface{}{"ICON", "Alpha", 0.0, 10.0, 0.0, "ColorBlufor", 0.0,
				[]interface{}{[]interface{}{100.0, 200.0, 0.0}}, []interface{}{1.0, 1.0}, "ICON", "Solid"},
		},
		"times": []interface{}{
			map[string]interface{}{
				"frameNum": 0.0, "systemTimeUTC": "2035-06-10T10:00:00",
				"date": "2035-06-10", "time": 0.0, "timeMultiplier": 1.0,
			},
		},
	}

	jsonData, err := json.Marshal(testData)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(inputPath, jsonData, 0644))

	ctx := context.Background()
	chunkSize := uint32(5)

	// Run old converter
	oldConverter := NewConverter(chunkSize)
	require.NoError(t, oldConverter.Convert(ctx, inputPath, oldOutputPath, "protobuf"))

	// Run new streaming converter
	newConverter := NewStreamingConverter(chunkSize)
	require.NoError(t, newConverter.Convert(ctx, inputPath, newOutputPath))

	// Compare manifests
	oldManifest := readManifest(t, oldOutputPath)
	newManifest := readManifest(t, newOutputPath)

	assert.Equal(t, oldManifest.WorldName, newManifest.WorldName)
	assert.Equal(t, oldManifest.MissionName, newManifest.MissionName)
	assert.Equal(t, oldManifest.FrameCount, newManifest.FrameCount)
	assert.Equal(t, oldManifest.ChunkSize, newManifest.ChunkSize)
	assert.Equal(t, oldManifest.ChunkCount, newManifest.ChunkCount)
	assert.Equal(t, oldManifest.CaptureDelayMs, newManifest.CaptureDelayMs)
	require.Len(t, newManifest.Entities, len(oldManifest.Entities))
	require.Len(t, newManifest.Events, len(oldManifest.Events))
	require.Len(t, newManifest.Markers, len(oldManifest.Markers))
	require.Len(t, newManifest.Times, len(oldManifest.Times))

	// Compare each entity definition
	for i := range oldManifest.Entities {
		assert.Equal(t, oldManifest.Entities[i].Id, newManifest.Entities[i].Id)
		assert.Equal(t, oldManifest.Entities[i].Type, newManifest.Entities[i].Type)
		assert.Equal(t, oldManifest.Entities[i].Name, newManifest.Entities[i].Name)
		assert.Equal(t, oldManifest.Entities[i].Side, newManifest.Entities[i].Side)
		assert.Equal(t, oldManifest.Entities[i].StartFrame, newManifest.Entities[i].StartFrame)
		assert.Equal(t, oldManifest.Entities[i].EndFrame, newManifest.Entities[i].EndFrame)
	}

	// Compare chunks frame-by-frame
	for chunkIdx := uint32(0); chunkIdx < oldManifest.ChunkCount; chunkIdx++ {
		oldChunk := readChunk(t, oldOutputPath, chunkIdx)
		newChunk := readChunk(t, newOutputPath, chunkIdx)

		assert.Equal(t, oldChunk.Index, newChunk.Index)
		assert.Equal(t, oldChunk.StartFrame, newChunk.StartFrame)
		assert.Equal(t, oldChunk.FrameCount, newChunk.FrameCount)
		require.Len(t, newChunk.Frames, len(oldChunk.Frames), "chunk %d frame count", chunkIdx)

		for fi, oldFrame := range oldChunk.Frames {
			newFrame := newChunk.Frames[fi]
			assert.Equal(t, oldFrame.FrameNum, newFrame.FrameNum)
			require.Len(t, newFrame.Entities, len(oldFrame.Entities),
				"chunk %d frame %d entity count", chunkIdx, oldFrame.FrameNum)

			// Build map for comparison (order may differ)
			oldStates := make(map[uint32]*pbv1.EntityState)
			for _, s := range oldFrame.Entities {
				oldStates[s.EntityId] = s
			}
			for _, ns := range newFrame.Entities {
				os, ok := oldStates[ns.EntityId]
				require.True(t, ok, "entity %d in chunk %d frame %d", ns.EntityId, chunkIdx, oldFrame.FrameNum)
				assert.Equal(t, os.PosX, ns.PosX)
				assert.Equal(t, os.PosY, ns.PosY)
				assert.Equal(t, os.PosZ, ns.PosZ)
				assert.Equal(t, os.Direction, ns.Direction)
				assert.Equal(t, os.Alive, ns.Alive)
				assert.Equal(t, os.CrewIds, ns.CrewIds)
				assert.Equal(t, os.VehicleId, ns.VehicleId)
				assert.Equal(t, os.IsInVehicle, ns.IsInVehicle)
				assert.Equal(t, os.Name, ns.Name)
				assert.Equal(t, os.IsPlayer, ns.IsPlayer)
				assert.Equal(t, os.GroupName, ns.GroupName)
				assert.Equal(t, os.Side, ns.Side)
			}
		}
	}
}

func readManifest(t *testing.T, outputPath string) *pbv1.Manifest {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(outputPath, "manifest.pb"))
	require.NoError(t, err)
	var m pbv1.Manifest
	require.NoError(t, proto.Unmarshal(data, &m))
	return &m
}

func readChunk(t *testing.T, outputPath string, idx uint32) *pbv1.Chunk {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(outputPath, "chunks", fmt.Sprintf("%04d.pb", idx)))
	require.NoError(t, err)
	var c pbv1.Chunk
	require.NoError(t, proto.Unmarshal(data, &c))
	return &c
}
