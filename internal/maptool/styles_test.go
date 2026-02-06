package maptool

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCategorizeLayer(t *testing.T) {
	tests := []struct {
		name     string
		expected string
	}{
		{"sea", "sea"},
		{"forest", "forest"},
		{"rocks", "rocks"},
		{"house", "buildings"},
		{"trail", "trail"},
		{"track", "track"},
		{"road", "road"},
		{"main_road", "main_road"},
		{"runway", "runway"},
		{"road-bridge", "bridges"},
		{"main_road-bridge", "bridges"},
		{"track-bridge", "bridges"},
		{"trail-bridge", "bridges"},
		{"railway", "railway"},
		{"powerline", "powerline"},
		{"contours", "contours"},
		{"contours05", "contours"},
		{"contours10", "contours"},
		{"contours50", "contours"},
		{"contours100", "contours"},
		{"vegetationbroadleaf", "vegetation"},
		{"vegetationfir", "vegetation"},
		{"vegetationpalm", "vegetation"},
		{"vegetationvineyard", "vegetation"},
		{"hill", "labels"},
		{"namemarine", "labels"},
		{"namelocal", "labels"},
		{"namevillage", "labels"},
		{"namecity", "labels"},
		{"namecitycapital", "labels"},
		{"citycenter", "labels"},
		// Icon objects
		{"church", "icons"},
		{"lighthouse", "icons"},
		{"hospital", "icons"},
		{"fuelstation", "icons"},
		{"bunker", "icons"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, categorizeLayer(tt.name))
		})
	}
}

func TestCategorizeLayer_UnknownReturnsOther(t *testing.T) {
	assert.Equal(t, "other", categorizeLayer("unknown_layer"))
}

func TestIsLayerVisible(t *testing.T) {
	allVisible := layerVisibility{
		seaLand: true, seaWater: true,
		forest: true, rocks: true, roads: true, buildings: true,
		contours: true, labels: true, icons: true,
		bridges: true, railway: true, powerline: true, vegetation: true,
	}
	noneVisible := layerVisibility{}

	// All visible
	assert.True(t, isLayerVisible("sea", allVisible))
	assert.True(t, isLayerVisible("forest", allVisible))
	assert.True(t, isLayerVisible("road", allVisible))
	assert.True(t, isLayerVisible("trail", allVisible))
	assert.True(t, isLayerVisible("main_road", allVisible))
	assert.True(t, isLayerVisible("namecity", allVisible))
	assert.True(t, isLayerVisible("church", allVisible))
	assert.True(t, isLayerVisible("vegetationfir", allVisible))

	// None visible
	assert.False(t, isLayerVisible("forest", noneVisible))
	assert.False(t, isLayerVisible("road", noneVisible))
	assert.False(t, isLayerVisible("namecity", noneVisible))
	assert.False(t, isLayerVisible("church", noneVisible))

	// Unknown layers are always visible
	assert.True(t, isLayerVisible("unknown_layer", noneVisible))
}

func TestIsLayerVisible_SeaPartial(t *testing.T) {
	// Sea visible if either seaLand or seaWater is true
	landOnly := layerVisibility{seaLand: true}
	waterOnly := layerVisibility{seaWater: true}
	neither := layerVisibility{}

	assert.True(t, isLayerVisible("sea", landOnly))
	assert.True(t, isLayerVisible("sea", waterOnly))
	assert.False(t, isLayerVisible("sea", neither))
}

func TestIsLayerVisible_SatelliteVariant(t *testing.T) {
	// Satellite mode: no forest, no vegetation, no sea-land
	assert.False(t, isLayerVisible("forest", layerVisSatellite))
	assert.False(t, isLayerVisible("vegetationbroadleaf", layerVisSatellite))
	assert.True(t, isLayerVisible("road", layerVisSatellite))
	assert.True(t, isLayerVisible("namecity", layerVisSatellite))
}

func TestGetLayerStyles_Known(t *testing.T) {
	styles := GetLayerStyles("road")
	require.Len(t, styles, 2, "road should have outline + fill")
	assert.Equal(t, "road-outline", styles[0].ID)
	assert.Equal(t, "road", styles[1].ID)
	assert.Equal(t, "line", styles[0].Type)
}

func TestGetLayerStyles_Fallback(t *testing.T) {
	styles := GetLayerStyles("unknown_layer")
	require.Len(t, styles, 1)
	assert.Equal(t, "unknown_layer", styles[0].ID)
	assert.Equal(t, "circle", styles[0].Type)
}

func TestBuildVectorFeatureLayers_SortsCorrectly(t *testing.T) {
	// Input in wrong order: labels before roads
	layers := []string{"namecity", "road", "sea", "forest", "contours"}
	result := buildVectorFeatureLayers(layers, layerVisStandard)

	// Extract layer IDs in order
	var ids []string
	for _, l := range result {
		m := l.(map[string]interface{})
		ids = append(ids, m["id"].(string))
	}

	// Verify order: sea < contours < forest < road < namecity
	idxSea := indexOf(ids, "sea-land")
	idxContours := indexOf(ids, "contours")
	idxForest := indexOf(ids, "forest")
	idxRoad := indexOf(ids, "road-outline")
	idxCity := indexOf(ids, "namecity")

	assert.Greater(t, idxContours, idxSea, "contours should be above sea")
	assert.Greater(t, idxForest, idxContours, "forest should be above contours")
	assert.Greater(t, idxRoad, idxForest, "road should be above forest")
	assert.Greater(t, idxCity, idxRoad, "namecity should be above road")
}

func TestBuildVectorFeatureLayers_RoadSubOrder(t *testing.T) {
	layers := []string{"main_road", "trail", "road", "track"}
	result := buildVectorFeatureLayers(layers, layerVisStandard)

	var ids []string
	for _, l := range result {
		m := l.(map[string]interface{})
		ids = append(ids, m["id"].(string))
	}

	// trail < track < road < main_road (each has outline + fill)
	idxTrail := indexOf(ids, "trail")
	idxTrack := indexOf(ids, "track")
	idxRoad := indexOf(ids, "road")
	idxMain := indexOf(ids, "main_road")

	assert.Greater(t, idxTrack, idxTrail, "track should be above trail")
	assert.Greater(t, idxRoad, idxTrack, "road should be above track")
	assert.Greater(t, idxMain, idxRoad, "main_road should be above road")
}

func TestBuildVectorFeatureLayers_FiltersInvisible(t *testing.T) {
	layers := []string{"forest", "road", "namecity"}
	vis := layerVisibility{roads: true, labels: true} // forest disabled
	result := buildVectorFeatureLayers(layers, vis)

	var ids []string
	for _, l := range result {
		m := l.(map[string]interface{})
		ids = append(ids, m["id"].(string))
	}

	assert.Equal(t, -1, indexOf(ids, "forest"), "forest should be filtered out")
	assert.NotEqual(t, -1, indexOf(ids, "namecity"), "namecity should be present")
}

func TestBuildVectorFeatureLayers_DoesNotMutateInput(t *testing.T) {
	layers := []string{"namecity", "road", "sea"}
	original := make([]string, len(layers))
	copy(original, layers)

	buildVectorFeatureLayers(layers, layerVisStandard)

	assert.Equal(t, original, layers, "input slice should not be mutated")
}

func TestCopyMap(t *testing.T) {
	original := map[string]interface{}{"a": 1, "b": "two"}
	copied := copyMap(original)

	assert.Equal(t, original, copied)

	// Mutating copy should not affect original
	copied["c"] = 3
	assert.NotContains(t, original, "c")
}

func TestCopyMap_Nil(t *testing.T) {
	assert.Nil(t, copyMap(nil))
}

func TestGenerateStyleDocument_Structure(t *testing.T) {
	cfg := StyleConfig{
		WorldName:    "altis",
		URLPrefix:    "images/maps/altis",
		VectorLayers: []string{"sea", "road", "namecity"},
		HasSatellite: true,
	}

	doc := GenerateStyleDocument(cfg, StyleStandard)

	assert.Equal(t, 8, doc["version"])
	assert.Equal(t, "altis-standard", doc["name"])
	assert.NotNil(t, doc["sources"])
	assert.NotNil(t, doc["layers"])
	assert.NotEmpty(t, doc["sprite"])
	assert.NotEmpty(t, doc["glyphs"])
}

func TestGenerateStyleDocument_Variants(t *testing.T) {
	cfg := StyleConfig{
		WorldName:    "stratis",
		URLPrefix:    "images/maps/stratis",
		VectorLayers: []string{"sea"},
		HasSatellite: true,
		HasHeightmap: true,
		HasHillshade: true,
	}

	for _, variant := range []StyleVariant{StyleStandard, StyleSatellite, StyleHybrid} {
		t.Run(string(variant), func(t *testing.T) {
			doc := GenerateStyleDocument(cfg, variant)
			assert.Equal(t, "stratis-"+string(variant), doc["name"])
			layers := doc["layers"].([]interface{})
			assert.NotEmpty(t, layers)
			// First layer is always background
			first := layers[0].(map[string]interface{})
			assert.Equal(t, "background", first["id"])
		})
	}
}

func TestGenerateStyleDocument_Sources(t *testing.T) {
	cfg := StyleConfig{
		WorldName:      "altis",
		URLPrefix:      "images/maps/altis",
		VectorLayers:   []string{"sea"},
		HasSatellite:   true,
		HasHeightmap:   true,
		HasHillshade:   true,
		HasColorRelief: true,
	}

	doc := GenerateStyleDocument(cfg, StyleStandard)
	sources := doc["sources"].(map[string]interface{})

	assert.Contains(t, sources, "features")
	assert.Contains(t, sources, "satellite")
	assert.Contains(t, sources, "heightmap")
	assert.Contains(t, sources, "hillshade")
	assert.Contains(t, sources, "color-relief")
}

func TestGenerateStyleDocument_NoOptionalSources(t *testing.T) {
	cfg := StyleConfig{
		WorldName:    "test",
		URLPrefix:    "images/maps/test",
		VectorLayers: []string{"sea"},
	}

	doc := GenerateStyleDocument(cfg, StyleStandard)
	sources := doc["sources"].(map[string]interface{})

	assert.Contains(t, sources, "features")
	assert.NotContains(t, sources, "satellite")
	assert.NotContains(t, sources, "heightmap")
	assert.NotContains(t, sources, "hillshade")
	assert.NotContains(t, sources, "color-relief")
}

func indexOf(slice []string, val string) int {
	for i, s := range slice {
		if s == val {
			return i
		}
	}
	return -1
}
