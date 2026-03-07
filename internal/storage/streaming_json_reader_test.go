package storage

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
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
	assert.Equal(t, uint32(5), meta.EndFrame)
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

func TestStreamingJSONReader_PlainFile(t *testing.T) {
	jsonData := makeTestJSON(t)
	path := filepath.Join(t.TempDir(), "test.json")
	require.NoError(t, os.WriteFile(path, jsonData, 0644))

	reader, err := OpenStreamingJSONReader(path)
	require.NoError(t, err)
	defer reader.Close()

	meta, err := reader.Process(StreamingCallbacks{})
	require.NoError(t, err)
	assert.Equal(t, "Altis", meta.WorldName)
}

func TestStreamingJSONReader_FileNotFound(t *testing.T) {
	_, err := OpenStreamingJSONReader("/nonexistent/file.json")
	require.Error(t, err)
}

func TestStreamingJSONReader_EmptyInput(t *testing.T) {
	reader := NewStreamingJSONReader(bytes.NewReader([]byte{}))
	_, err := reader.Process(StreamingCallbacks{})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "expected opening brace")
}

func TestStreamingJSONReader_NotObject(t *testing.T) {
	reader := NewStreamingJSONReader(bytes.NewReader([]byte(`[1,2,3]`)))
	_, err := reader.Process(StreamingCallbacks{})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "expected '{'")
}

func TestStreamingJSONReader_CallbackError(t *testing.T) {
	data := makeTestJSON(t)

	t.Run("entity callback error", func(t *testing.T) {
		reader := NewStreamingJSONReader(bytes.NewReader(data))
		_, err := reader.Process(StreamingCallbacks{
			OnEntity: func(entity map[string]interface{}) error {
				return fmt.Errorf("entity error")
			},
		})
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "entity error")
	})

	t.Run("event callback error", func(t *testing.T) {
		reader := NewStreamingJSONReader(bytes.NewReader(data))
		_, err := reader.Process(StreamingCallbacks{
			OnEvent: func(event []interface{}) error {
				return fmt.Errorf("event error")
			},
		})
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "event error")
	})

	t.Run("marker callback error", func(t *testing.T) {
		reader := NewStreamingJSONReader(bytes.NewReader(data))
		_, err := reader.Process(StreamingCallbacks{
			OnMarker: func(marker []interface{}) error {
				return fmt.Errorf("marker error")
			},
		})
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "marker error")
	})

	t.Run("time callback error", func(t *testing.T) {
		reader := NewStreamingJSONReader(bytes.NewReader(data))
		_, err := reader.Process(StreamingCallbacks{
			OnTime: func(ts map[string]interface{}) error {
				return fmt.Errorf("time error")
			},
		})
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "time error")
	})
}

func TestStreamingJSONReader_MalformedEntities(t *testing.T) {
	// entities array contains a non-object
	data := []byte(`{"entities": ["not_an_object"]}`)
	reader := NewStreamingJSONReader(bytes.NewReader(data))
	_, err := reader.Process(StreamingCallbacks{
		OnEntity: func(entity map[string]interface{}) error { return nil },
	})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "stream entities")
}

func TestStreamingJSONReader_MalformedEvents(t *testing.T) {
	// events array contains a non-array
	data := []byte(`{"events": [{"not": "array"}]}`)
	reader := NewStreamingJSONReader(bytes.NewReader(data))
	_, err := reader.Process(StreamingCallbacks{
		OnEvent: func(event []interface{}) error { return nil },
	})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "stream events")
}

func TestStreamingJSONReader_MalformedMarkers(t *testing.T) {
	data := []byte(`{"Markers": [{"not": "array"}]}`)
	reader := NewStreamingJSONReader(bytes.NewReader(data))
	_, err := reader.Process(StreamingCallbacks{
		OnMarker: func(marker []interface{}) error { return nil },
	})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "stream markers")
}

func TestStreamingJSONReader_MalformedTimes(t *testing.T) {
	data := []byte(`{"times": ["not_an_object"]}`)
	reader := NewStreamingJSONReader(bytes.NewReader(data))
	_, err := reader.Process(StreamingCallbacks{
		OnTime: func(ts map[string]interface{}) error { return nil },
	})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "stream times")
}

func TestStreamingJSONReader_AllMetadataFields(t *testing.T) {
	data := []byte(`{
		"worldName": "Stratis",
		"missionName": "Full Meta",
		"missionAuthor": "TestAuthor",
		"endFrame": 42,
		"captureDelay": 0.5,
		"extensionVersion": "1.2.3",
		"addonVersion": "4.5.6",
		"unknownField": "ignored"
	}`)
	reader := NewStreamingJSONReader(bytes.NewReader(data))
	meta, err := reader.Process(StreamingCallbacks{})
	require.NoError(t, err)
	assert.Equal(t, "Stratis", meta.WorldName)
	assert.Equal(t, "Full Meta", meta.MissionName)
	assert.Equal(t, "TestAuthor", meta.MissionAuthor)
	assert.Equal(t, uint32(42), meta.EndFrame)
	assert.Equal(t, uint32(500), meta.CaptureDelayMs)
	assert.Equal(t, "1.2.3", meta.ExtensionVersion)
	assert.Equal(t, "4.5.6", meta.AddonVersion)
}

func TestStreamingJSONReader_MetadataWrongTypes(t *testing.T) {
	// All metadata fields have wrong types — should be silently ignored
	data := []byte(`{
		"worldName": 123,
		"missionName": true,
		"missionAuthor": 456,
		"endFrame": "not a number",
		"captureDelay": "nope",
		"extensionVersion": 789,
		"addonVersion": false
	}`)
	reader := NewStreamingJSONReader(bytes.NewReader(data))
	meta, err := reader.Process(StreamingCallbacks{})
	require.NoError(t, err)
	assert.Empty(t, meta.WorldName)
	assert.Empty(t, meta.MissionName)
	assert.Empty(t, meta.MissionAuthor)
	assert.Equal(t, uint32(0), meta.EndFrame)
	assert.Equal(t, uint32(0), meta.CaptureDelayMs)
	assert.Empty(t, meta.ExtensionVersion)
	assert.Empty(t, meta.AddonVersion)
}

func TestStreamingJSONReader_TruncatedJSON(t *testing.T) {
	// JSON that ends mid-value
	data := []byte(`{"worldName": "Altis", "entities": [{"id`)
	reader := NewStreamingJSONReader(bytes.NewReader(data))
	_, err := reader.Process(StreamingCallbacks{
		OnEntity: func(entity map[string]interface{}) error { return nil },
	})
	assert.Error(t, err)
}

func TestStreamingJSONReader_SkipArraysWithoutCallbacks(t *testing.T) {
	data := makeTestJSON(t)
	reader := NewStreamingJSONReader(bytes.NewReader(data))
	// Process with no callbacks — all arrays should be skipped
	meta, err := reader.Process(StreamingCallbacks{})
	require.NoError(t, err)
	assert.Equal(t, "Altis", meta.WorldName)
	assert.Equal(t, uint32(5), meta.EndFrame)
}

func TestStreamingJSONReader_EntitiesNotArray(t *testing.T) {
	// "entities" is a string instead of an array — triggers expectToken error
	data := []byte(`{"entities": "not_an_array"}`)
	reader := NewStreamingJSONReader(bytes.NewReader(data))
	_, err := reader.Process(StreamingCallbacks{
		OnEntity: func(entity map[string]interface{}) error { return nil },
	})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "stream entities")
}

func TestStreamingJSONReader_EventsNotArray(t *testing.T) {
	data := []byte(`{"events": "not_an_array"}`)
	reader := NewStreamingJSONReader(bytes.NewReader(data))
	_, err := reader.Process(StreamingCallbacks{
		OnEvent: func(event []interface{}) error { return nil },
	})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "stream events")
}

func TestStreamingJSONReader_MarkersNotArray(t *testing.T) {
	data := []byte(`{"Markers": 42}`)
	reader := NewStreamingJSONReader(bytes.NewReader(data))
	_, err := reader.Process(StreamingCallbacks{
		OnMarker: func(marker []interface{}) error { return nil },
	})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "stream markers")
}

func TestStreamingJSONReader_TimesNotArray(t *testing.T) {
	data := []byte(`{"times": true}`)
	reader := NewStreamingJSONReader(bytes.NewReader(data))
	_, err := reader.Process(StreamingCallbacks{
		OnTime: func(ts map[string]interface{}) error { return nil },
	})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "stream times")
}

func TestStreamingJSONReader_TruncatedArrayValue(t *testing.T) {
	// Array starts but data is truncated mid-element
	data := []byte(`{"entities": [{"id": 1, "name`)
	reader := NewStreamingJSONReader(bytes.NewReader(data))
	_, err := reader.Process(StreamingCallbacks{
		OnEntity: func(entity map[string]interface{}) error { return nil },
	})
	assert.Error(t, err)
}

func TestStreamingJSONReader_SkipNestedArrays(t *testing.T) {
	// Test skipToEndOfArray with deeply nested structures
	data := []byte(`{"entities": [[1, [2, [3]]], [4, {"a": [5]}]], "worldName": "Altis"}`)
	reader := NewStreamingJSONReader(bytes.NewReader(data))
	// No entity callback = skip the entire entities array
	meta, err := reader.Process(StreamingCallbacks{})
	require.NoError(t, err)
	assert.Equal(t, "Altis", meta.WorldName)
}

func TestStreamingJSONReader_InvalidGzipFile(t *testing.T) {
	// File starts with gzip magic bytes but contains invalid gzip data
	path := filepath.Join(t.TempDir(), "test.json.gz")
	data := []byte{0x1f, 0x8b, 0x00, 0x00, 0xFF, 0xFF} // gzip magic + garbage
	require.NoError(t, os.WriteFile(path, data, 0644))

	_, err := OpenStreamingJSONReader(path)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "gzip reader")
}

func TestStreamingJSONReader_TruncatedScalarValue(t *testing.T) {
	// JSON key present but value is truncated
	data := []byte(`{"worldName":`)
	reader := NewStreamingJSONReader(bytes.NewReader(data))
	_, err := reader.Process(StreamingCallbacks{})
	assert.Error(t, err)
}

func TestStreamingJSONReader_MultiCloserError(t *testing.T) {
	// Test multiCloser collects first error
	mc := &multiCloser{closers: []io.Closer{
		io.NopCloser(nil),
		io.NopCloser(nil),
	}}
	assert.NoError(t, mc.Close())
}

func TestStreamingJSONReader_CloseNilCloser(t *testing.T) {
	reader := NewStreamingJSONReader(bytes.NewReader([]byte(`{}`)))
	assert.NoError(t, reader.Close())
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
