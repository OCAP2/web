package storage

import (
	"compress/gzip"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

// The converter in python/convert_recording_gear.py rewrites a recording's
// player snapshots. The server has to keep parsing it, because a recording is
// converted to protobuf in the background and served in chunks after that.
//
// The file is a large local artifact, so the test skips when it is absent.
// Point it elsewhere with OCAP_TEST_RECORDING_V3.
func convertedRecordingPath(t *testing.T) string {
	t.Helper()
	if env := os.Getenv("OCAP_TEST_RECORDING_V3"); env != "" {
		return env
	}
	return filepath.Join("..", "..", "..", "No20Wonder20Conwoy_20260824_210930.v3.json.gz")
}

func TestParserV1_ParsesConvertedRecording(t *testing.T) {
	path := convertedRecordingPath(t)
	file, err := os.Open(path)
	if err != nil {
		t.Skipf("converted recording not present at %s", path)
	}
	defer file.Close()

	reader, err := gzip.NewReader(file)
	require.NoError(t, err)
	defer reader.Close()

	var data map[string]interface{}
	require.NoError(t, json.NewDecoder(reader).Decode(&data))

	result, err := (&ParserV1{}).Parse(data, 1000)
	require.NoError(t, err)
	require.NotNil(t, result)
	require.NotEmpty(t, result.Entities)
	require.NotEmpty(t, result.Events)

	byType := map[string]int{}
	for _, event := range result.Events {
		byType[event.Type]++

		switch event.Type {
		case "inventorySnapshot", "medicalSnapshot", "staminaSnapshot", "radioSnapshot", "serverFps",
			"weather", "zeusEntity", "zeusRemoteControl", "zeusCamera":
			// The payload survives as JSON in the generic message field, which is
			// what the web decoder parses back out on the other side.
			require.NotEmpty(t, event.Message, "%s at frame %d lost its payload", event.Type, event.FrameNum)
			var payload map[string]interface{}
			require.NoError(t, json.Unmarshal([]byte(event.Message), &payload),
				"%s at frame %d is not valid JSON", event.Type, event.FrameNum)
			switch event.Type {
			case "serverFps", "weather":
			case "zeusEntity", "zeusRemoteControl", "zeusCamera":
				require.Contains(t, payload, "curatorId",
					"%s at frame %d has no curatorId to key it by", event.Type, event.FrameNum)
			default:
				require.Contains(t, payload, "unitId",
					"%s at frame %d has no unitId to key it by", event.Type, event.FrameNum)
			}
		}
	}

	for _, kind := range []string{"inventorySnapshot", "medicalSnapshot", "staminaSnapshot", "radioSnapshot", "serverFps"} {
		require.Greater(t, byType[kind], 0, "no %s events survived parsing", kind)
	}
}

// FrameNum is a uint32, so a sample stamped at frame -1 wrapped to 4294967295 and
// landed past the end of the recording. The converter moves the serverFps sample
// that did this to frame 0.
//
// Upstream "connected" events are still written at -1 and are left alone: that
// predates the player-detail work and changing it is not this change's business.
func TestParserV1_ConvertedRecordingSnapshotFramesAreInRange(t *testing.T) {
	path := convertedRecordingPath(t)
	file, err := os.Open(path)
	if err != nil {
		t.Skipf("converted recording not present at %s", path)
	}
	defer file.Close()

	reader, err := gzip.NewReader(file)
	require.NoError(t, err)
	defer reader.Close()

	var data map[string]interface{}
	require.NoError(t, json.NewDecoder(reader).Decode(&data))

	events, ok := data["events"].([]interface{})
	require.True(t, ok)

	endFrame, ok := data["endFrame"].(float64)
	require.True(t, ok)

	tracked := map[string]bool{
		"inventorySnapshot": true,
		"medicalSnapshot":   true,
		"staminaSnapshot":   true,
		"radioSnapshot":     true,
		"serverFps":         true,
	}

	checked := 0
	for _, raw := range events {
		arr, ok := raw.([]interface{})
		if !ok || len(arr) < 2 {
			continue
		}
		kind, _ := arr[1].(string)
		if !tracked[kind] {
			continue
		}
		frame, ok := arr[0].(float64)
		require.True(t, ok)
		require.GreaterOrEqual(t, frame, float64(0), "%s sits before frame 0", kind)
		require.LessOrEqual(t, frame, endFrame, "%s sits past endFrame", kind)
		checked++
	}
	require.Greater(t, checked, 0)
}
