package maptool

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGenerateMapJSON(t *testing.T) {
	dir := t.TempDir()
	meta := MapMeta{
		WorldName: "altis",
		WorldSize: 30720,
		ImageSize: 30720,
		MaxZoom:   6,
	}

	err := GenerateMapJSON(dir, meta)
	require.NoError(t, err)

	data, err := os.ReadFile(filepath.Join(dir, "map.json"))
	require.NoError(t, err)

	var result map[string]interface{}
	require.NoError(t, json.Unmarshal(data, &result))

	assert.Equal(t, "altis", result["name"])
	assert.Equal(t, float64(30720), result["worldSize"])
	assert.Equal(t, "style.json", result["maplibreStyle"])
}

func TestGenerateMapJSON_DefaultZoom(t *testing.T) {
	dir := t.TempDir()
	meta := MapMeta{WorldName: "test", WorldSize: 8192, ImageSize: 8192}

	err := GenerateMapJSON(dir, meta)
	require.NoError(t, err)

	data, err := os.ReadFile(filepath.Join(dir, "map.json"))
	require.NoError(t, err)

	var result map[string]interface{}
	require.NoError(t, json.Unmarshal(data, &result))
	assert.Equal(t, float64(6), result["maxZoom"])
}

func TestGenerateStyleJSON(t *testing.T) {
	dir := t.TempDir()
	meta := MapMeta{WorldName: "altis", MinZoom: 10, MaxZoom: 18}

	err := GenerateStyleJSON(dir, meta)
	require.NoError(t, err)

	data, err := os.ReadFile(filepath.Join(dir, "style.json"))
	require.NoError(t, err)

	var result map[string]interface{}
	require.NoError(t, json.Unmarshal(data, &result))

	assert.Equal(t, float64(8), result["version"])
	assert.Equal(t, "Altis", result["name"])

	sources := result["sources"].(map[string]interface{})
	topo := sources["topo"].(map[string]interface{})
	assert.Contains(t, topo["url"], "topo.pmtiles")
	assert.Equal(t, float64(10), topo["minzoom"])
	assert.Equal(t, float64(18), topo["maxzoom"])
}

func TestGenerateStyleJSON_WithVector(t *testing.T) {
	dir := t.TempDir()
	meta := MapMeta{WorldName: "altis", MinZoom: 10, MaxZoom: 18, HasVector: true}

	err := GenerateStyleJSON(dir, meta)
	require.NoError(t, err)

	data, err := os.ReadFile(filepath.Join(dir, "style.json"))
	require.NoError(t, err)

	var result map[string]interface{}
	require.NoError(t, json.Unmarshal(data, &result))

	sources := result["sources"].(map[string]interface{})
	assert.Contains(t, sources, "topo")
	assert.Contains(t, sources, "vectors")

	vectors := sources["vectors"].(map[string]interface{})
	assert.Equal(t, "vector", vectors["type"])
	assert.Contains(t, vectors["url"], "vector.pmtiles")

	layers := result["layers"].([]interface{})
	assert.Greater(t, len(layers), 1, "should have vector layers in addition to basemap")

	// Check for expected layer IDs
	layerIDs := make([]string, len(layers))
	for i, l := range layers {
		layerIDs[i] = l.(map[string]interface{})["id"].(string)
	}
	assert.Contains(t, layerIDs, "basemap")
	assert.Contains(t, layerIDs, "contours")
	assert.Contains(t, layerIDs, "contours-major")
	assert.Contains(t, layerIDs, "roads")
	assert.Contains(t, layerIDs, "buildings")
}

func TestGenerateStyleJSON_WithoutVector(t *testing.T) {
	dir := t.TempDir()
	meta := MapMeta{WorldName: "altis", MinZoom: 10, MaxZoom: 18, HasVector: false}

	err := GenerateStyleJSON(dir, meta)
	require.NoError(t, err)

	data, err := os.ReadFile(filepath.Join(dir, "style.json"))
	require.NoError(t, err)

	var result map[string]interface{}
	require.NoError(t, json.Unmarshal(data, &result))

	sources := result["sources"].(map[string]interface{})
	assert.NotContains(t, sources, "vectors")

	layers := result["layers"].([]interface{})
	assert.Len(t, layers, 1, "should only have basemap layer")
}

func TestGenerateStyleJSON_DefaultZoom(t *testing.T) {
	dir := t.TempDir()
	meta := MapMeta{WorldName: "test"}

	err := GenerateStyleJSON(dir, meta)
	require.NoError(t, err)

	data, err := os.ReadFile(filepath.Join(dir, "style.json"))
	require.NoError(t, err)

	var result map[string]interface{}
	require.NoError(t, json.Unmarshal(data, &result))

	sources := result["sources"].(map[string]interface{})
	topo := sources["topo"].(map[string]interface{})
	assert.Equal(t, float64(0), topo["minzoom"])
	assert.Equal(t, float64(6), topo["maxzoom"])
}
