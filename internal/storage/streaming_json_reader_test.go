package storage

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestStreamingJSONReader_Metadata(t *testing.T) {
	data := makeTestJSON(t)
	reader := NewStreamingJSONReader(bytes.NewReader(data))

	meta, err := reader.Process(StreamingCallbacks{})
	require.NoError(t, err)
	assert.Equal(t, "Altis", meta.WorldName)
	assert.Equal(t, "Test Mission", meta.MissionName)
	assert.Equal(t, uint32(5), meta.FrameCount)
	assert.Equal(t, uint32(1000), meta.CaptureDelayMs)
}

func TestStreamingJSONReader_Entities(t *testing.T) {
	data := makeTestJSON(t)
	reader := NewStreamingJSONReader(bytes.NewReader(data))

	var entities []map[string]interface{}
	_, err := reader.Process(StreamingCallbacks{
		OnEntity: func(entity map[string]interface{}) error {
			entities = append(entities, entity)
			return nil
		},
	})
	require.NoError(t, err)
	require.Len(t, entities, 2)
	assert.Equal(t, "Player1", entities[0]["name"])
	assert.Equal(t, "Truck", entities[1]["name"])
}

func TestStreamingJSONReader_Events(t *testing.T) {
	data := makeTestJSON(t)
	reader := NewStreamingJSONReader(bytes.NewReader(data))

	var events [][]interface{}
	_, err := reader.Process(StreamingCallbacks{
		OnEvent: func(event []interface{}) error {
			events = append(events, event)
			return nil
		},
	})
	require.NoError(t, err)
	require.Len(t, events, 1)
}

func TestStreamingJSONReader_Markers(t *testing.T) {
	data := makeTestJSON(t)
	reader := NewStreamingJSONReader(bytes.NewReader(data))

	var markers [][]interface{}
	_, err := reader.Process(StreamingCallbacks{
		OnMarker: func(marker []interface{}) error {
			markers = append(markers, marker)
			return nil
		},
	})
	require.NoError(t, err)
	require.Len(t, markers, 1)
}

func TestStreamingJSONReader_Times(t *testing.T) {
	data := makeTestJSON(t)
	reader := NewStreamingJSONReader(bytes.NewReader(data))

	var times []map[string]interface{}
	_, err := reader.Process(StreamingCallbacks{
		OnTime: func(ts map[string]interface{}) error {
			times = append(times, ts)
			return nil
		},
	})
	require.NoError(t, err)
	require.Len(t, times, 1)
}

func TestStreamingJSONReader_GzippedFile(t *testing.T) {
	jsonData := makeTestJSON(t)

	// Gzip it
	var buf bytes.Buffer
	gw := gzip.NewWriter(&buf)
	_, err := gw.Write(jsonData)
	require.NoError(t, err)
	require.NoError(t, gw.Close())

	// Write to file
	path := filepath.Join(t.TempDir(), "test.json.gz")
	require.NoError(t, os.WriteFile(path, buf.Bytes(), 0644))

	// Use OpenStreamingJSONReader which handles gzip detection
	reader, err := OpenStreamingJSONReader(path)
	require.NoError(t, err)
	defer reader.Close()

	meta, err := reader.Process(StreamingCallbacks{})
	require.NoError(t, err)
	assert.Equal(t, "Altis", meta.WorldName)
}

func TestStreamingJSONReader_AllCallbacks(t *testing.T) {
	data := makeTestJSON(t)
	reader := NewStreamingJSONReader(bytes.NewReader(data))

	var entityCount, eventCount, markerCount, timeCount int
	meta, err := reader.Process(StreamingCallbacks{
		OnEntity: func(entity map[string]interface{}) error { entityCount++; return nil },
		OnEvent:  func(event []interface{}) error { eventCount++; return nil },
		OnMarker: func(marker []interface{}) error { markerCount++; return nil },
		OnTime:   func(ts map[string]interface{}) error { timeCount++; return nil },
	})
	require.NoError(t, err)
	assert.Equal(t, 2, entityCount)
	assert.Equal(t, 1, eventCount)
	assert.Equal(t, 1, markerCount)
	assert.Equal(t, 1, timeCount)
	assert.Equal(t, "Altis", meta.WorldName)
}

func makeTestJSON(t *testing.T) []byte {
	t.Helper()
	testData := map[string]interface{}{
		"worldName":    "Altis",
		"missionName":  "Test Mission",
		"endFrame":     5.0,
		"captureDelay": 1.0,
		"entities": []interface{}{
			map[string]interface{}{
				"id": 0.0, "type": "unit", "name": "Player1", "side": "WEST",
				"group": "Alpha", "role": "Rifleman", "startFrameNum": 0.0, "isPlayer": 1.0,
				"positions": []interface{}{
					[]interface{}{[]interface{}{100.0, 200.0, 0.0}, 90.0, 1.0, 0.0, "Player1", 1.0},
					[]interface{}{[]interface{}{101.0, 201.0, 0.0}, 91.0, 1.0, 0.0, "Player1", 1.0},
					[]interface{}{[]interface{}{102.0, 202.0, 0.0}, 92.0, 1.0, 0.0, "Player1", 1.0},
					[]interface{}{[]interface{}{103.0, 203.0, 0.0}, 93.0, 1.0, 0.0, "Player1", 1.0},
					[]interface{}{[]interface{}{104.0, 204.0, 0.0}, 94.0, 1.0, 0.0, "Player1", 1.0},
				},
			},
			map[string]interface{}{
				"id": 1.0, "type": "vehicle", "name": "Truck", "class": "B_Truck_01",
				"startFrameNum": 0.0,
				"positions": []interface{}{
					[]interface{}{[]interface{}{500.0, 600.0, 0.0}, 180.0, 1.0, []interface{}{}},
					[]interface{}{[]interface{}{501.0, 601.0, 0.0}, 181.0, 1.0, []interface{}{}},
					[]interface{}{[]interface{}{502.0, 602.0, 0.0}, 182.0, 1.0, []interface{}{0.0}},
					[]interface{}{[]interface{}{503.0, 603.0, 0.0}, 183.0, 1.0, []interface{}{0.0}},
					[]interface{}{[]interface{}{504.0, 604.0, 0.0}, 184.0, 1.0, []interface{}{}},
				},
			},
		},
		"events": []interface{}{
			[]interface{}{3.0, "killed", 0.0, 0.0, "arifle_MX"},
		},
		"Markers": []interface{}{
			[]interface{}{"ICON", "Alpha", 0.0, 5.0, 0.0, "ColorBlufor", 0.0,
				[]interface{}{[]interface{}{100.0, 200.0, 0.0}}, []interface{}{1.0, 1.0}, "ICON", "Solid"},
		},
		"times": []interface{}{
			map[string]interface{}{
				"frameNum": 0.0, "systemTimeUTC": "2035-06-10T10:00:00",
				"date": "2035-06-10", "time": 0.0, "timeMultiplier": 1.0,
			},
		},
	}
	data, err := json.Marshal(testData)
	require.NoError(t, err)
	return data
}
