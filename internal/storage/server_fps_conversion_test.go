package storage

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/proto"

	pbv1 "github.com/OCAP2/web/pkg/schemas/protobuf/v1"
)

func TestPreFrameServerFPSConversion(t *testing.T) {
	// Older recorders sampled FPS before the first frame. Both conversion paths
	// must match JSON playback's frame-zero normalization, without wrapping -1.
	const recording = `{
		"worldName":"altis", "missionName":"Pre-frame FPS", "endFrame":20,
		"captureDelay":1, "entities":[], "events":[
			[-1,"serverFps",{"fps":40}],
			[10,"serverFps",{"fps":48}],
			[15,"connected","Player"]
		]
	}`
	for _, streaming := range []bool{false, true} {
		name := "parser-and-writer"
		if streaming {
			name = "streaming-converter"
		}
		t.Run(name, func(t *testing.T) {
			ctx := context.Background()
			dir := t.TempDir()
			output := filepath.Join(dir, "converted")
			if streaming {
				input := filepath.Join(dir, "recording.json")
				require.NoError(t, os.WriteFile(input, []byte(recording), 0600))
				require.NoError(t, NewConverter(300).Convert(ctx, input, output))
			} else {
				require.NoError(t, os.MkdirAll(output, 0755))
				var data map[string]interface{}
				require.NoError(t, json.Unmarshal([]byte(recording), &data))
				result, err := (&ParserV1{}).Parse(data, 300)
				require.NoError(t, err)
				require.NoError(t, (&ProtobufWriterV1{}).WriteManifest(ctx, output, result))
			}

			data, err := os.ReadFile(filepath.Join(output, "manifest.pb"))
			require.NoError(t, err)
			var manifest pbv1.Manifest
			require.NoError(t, proto.Unmarshal(data, &manifest))
			require.Len(t, manifest.Events, 3)
			for i, frame := range []uint32{0, 10, 15} {
				require.Equal(t, frame, manifest.Events[i].FrameNum)
				require.LessOrEqual(t, manifest.Events[i].FrameNum, manifest.EndFrame)
			}
			require.Equal(t, "serverFps", manifest.Events[0].Type)
			require.JSONEq(t, `{"fps":40}`, manifest.Events[0].Message)
			require.JSONEq(t, `{"fps":48}`, manifest.Events[1].Message)
			require.Equal(t, "connected", manifest.Events[2].Type)
			require.Equal(t, "Player", manifest.Events[2].Message)
		})
	}
}
