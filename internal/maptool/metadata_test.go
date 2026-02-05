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
	meta := MapMeta{WorldName: "altis"}

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
}
