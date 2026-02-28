package maptool

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestArmaToGeoJSON(t *testing.T) {
	// 0,0 Arma coords → 0,0 degrees
	result := armaToGeoJSON(0, 0)
	assert.Equal(t, 0.0, result[0])
	assert.Equal(t, 0.0, result[1])

	// 111320m east, 111320m north → 1°, 1°
	result = armaToGeoJSON(111320, 111320)
	assert.InDelta(t, 1.0, result[0], 0.001)
	assert.InDelta(t, 1.0, result[1], 0.001)
}

func TestArmaToGeoJSON_Altis(t *testing.T) {
	// Altis world size is 30720m
	// Expected: 30720 / 111320 ≈ 0.2759 degrees
	result := armaToGeoJSON(30720, 30720)
	assert.InDelta(t, 0.2759, result[0], 0.001)
	assert.InDelta(t, 0.2759, result[1], 0.001)
}

func TestArmaToGeoJSON_XIsLongitude(t *testing.T) {
	// x (east) maps to longitude (index 0)
	// z (north) maps to latitude (index 1)
	result := armaToGeoJSON(111320, 0)
	assert.InDelta(t, 1.0, result[0], 0.001) // longitude
	assert.Equal(t, 0.0, result[1])           // latitude
}

func TestWriteGeoJSON(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.geojson")

	fc := FeatureCollection{
		Type: "FeatureCollection",
		Features: []Feature{
			{
				Type: "Feature",
				Geometry: Geometry{
					Type:        "Point",
					Coordinates: []float64{1.0, 2.0},
				},
				Properties: map[string]any{"name": "test"},
			},
		},
	}

	err := WriteGeoJSON(path, fc)
	require.NoError(t, err)

	data, err := os.ReadFile(path)
	require.NoError(t, err)

	var parsed map[string]any
	require.NoError(t, json.Unmarshal(data, &parsed))
	assert.Equal(t, "FeatureCollection", parsed["type"])
	features := parsed["features"].([]any)
	assert.Len(t, features, 1)
}

func TestWriteGeoJSON_InvalidPath(t *testing.T) {
	fc := FeatureCollection{Type: "FeatureCollection"}
	err := WriteGeoJSON("/nonexistent/dir/test.geojson", fc)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "write geojson")
}
