package maptool

import "sort"

// LayerStyle defines a MapLibre GL style layer for a vector tile layer.
type LayerStyle struct {
	ID          string
	Type        string
	SourceLayer string
	MinZoom     int
	MaxZoom     int // 0 = no max
	Paint       map[string]interface{}
	Layout      map[string]interface{}
	Filter      interface{}
}

// roadWidthInterp returns a MapLibre interpolation expression for road width
// based on the "width" property.
func roadWidthInterp() interface{} {
	return []interface{}{
		"interpolate", []interface{}{"linear"}, []interface{}{"zoom"},
		float64(10), []interface{}{"/", []interface{}{"get", "width"}, float64(8)},
		float64(12), []interface{}{"/", []interface{}{"get", "width"}, float64(6)},
		float64(16), []interface{}{"/", []interface{}{"get", "width"}, float64(3)},
		float64(18), []interface{}{"*", []interface{}{"get", "width"}, 2.5},
		float64(20), []interface{}{"*", []interface{}{"get", "width"}, float64(3)},
	}
}

// roadOutlineWidthInterp returns a wider variant for road outlines.
func roadOutlineWidthInterp() interface{} {
	return []interface{}{
		"interpolate", []interface{}{"linear"}, []interface{}{"zoom"},
		float64(10), []interface{}{"/", []interface{}{"*", []interface{}{"get", "width"}, 1.3}, float64(8)},
		float64(12), []interface{}{"/", []interface{}{"*", []interface{}{"get", "width"}, 1.3}, float64(6)},
		float64(16), []interface{}{"/", []interface{}{"*", []interface{}{"get", "width"}, 1.3}, float64(3)},
		float64(18), []interface{}{"*", []interface{}{"*", []interface{}{"get", "width"}, 1.3}, 2.5},
		float64(20), []interface{}{"*", []interface{}{"*", []interface{}{"get", "width"}, 1.3}, float64(3)},
	}
}

// contourColorExpr returns a MapLibre case expression that uses underwater blue
// for negative elevation and the given landColor otherwise.
func contourColorExpr(landColor string) interface{} {
	return []interface{}{
		"case",
		[]interface{}{"<", []interface{}{"get", "elevation"}, float64(0)},
		"#a2b5ce",
		landColor,
	}
}

// iconLayout returns a standard symbol layout for an icon layer.
func iconLayout(iconImage string) map[string]interface{} {
	return map[string]interface{}{
		"icon-image":              iconImage,
		"icon-size":               []interface{}{"interpolate", []interface{}{"linear"}, []interface{}{"zoom"}, float64(12), 0.25, float64(16), float64(1)},
		"icon-anchor":             "center",
		"icon-allow-overlap":      false,
		"icon-ignore-placement":   false,
		"icon-rotation-alignment": "map",
	}
}

// textLayout returns a standard symbol layout for a text label layer.
func textLayout(font string, sizeExpr interface{}) map[string]interface{} {
	return map[string]interface{}{
		"text-field":               []interface{}{"get", "name"},
		"text-font":               []interface{}{font},
		"text-anchor":             "center",
		"text-size":               sizeExpr,
		"text-pitch-alignment":    "map",
		"text-rotation-alignment": "map",
		"text-allow-overlap":      true,
		"text-ignore-placement":   true,
		"text-justify":            "auto",
	}
}

// GetLayerStyles returns MapLibre style layers for a given grad_meh layer name.
// Known layers get rich styles; unknown layers get a generic fallback.
func GetLayerStyles(layerName string) []LayerStyle {
	if styles, ok := knownLayerStyles[layerName]; ok {
		return styles
	}
	// Fallback: generic gray circle
	return []LayerStyle{{
		ID:          layerName,
		Type:        "circle",
		SourceLayer: layerName,
		MinZoom:     14,
		Paint: map[string]interface{}{
			"circle-radius":  2,
			"circle-color":   "#888",
			"circle-opacity": 0.6,
		},
	}}
}

// knownLayerStyles maps grad_meh layer names to their MapLibre styles.
var knownLayerStyles = map[string][]LayerStyle{
	// --- Fills ---
	"forest": {{
		ID: "forest", Type: "fill", SourceLayer: "forest", MinZoom: 12,
		Paint: map[string]interface{}{
			"fill-color":     "rgba(159, 199, 99, 1)",
			"fill-opacity":   0.5,
			"fill-antialias": true,
		},
	}},
	"sea": {{
		ID: "sea-land", Type: "fill", SourceLayer: "sea", MinZoom: 8,
		Filter: []interface{}{">", []interface{}{"get", "ELEV_MAX"}, float64(0)},
		Paint:  map[string]interface{}{"fill-color": "#DFDFDF", "fill-opacity": float64(1), "fill-antialias": true},
	}, {
		ID: "sea-water", Type: "fill", SourceLayer: "sea", MinZoom: 8,
		Filter: []interface{}{"<=", []interface{}{"get", "ELEV_MAX"}, float64(0)},
		Paint:  map[string]interface{}{"fill-color": "#b7cbe6", "fill-opacity": float64(1), "fill-antialias": false},
	}},
	"rocks": {{
		ID: "rocks", Type: "fill", SourceLayer: "rocks", MinZoom: 16,
		Paint: map[string]interface{}{
			"fill-color":     "rgba(82, 82, 82, 1)",
			"fill-opacity":   0.7,
			"fill-antialias": true,
		},
	}},
	"house": {{
		ID: "house", Type: "fill", SourceLayer: "house", MinZoom: 13,
		Paint: map[string]interface{}{
			"fill-color":     []interface{}{"concat", "#", []interface{}{"get", "color"}},
			"fill-antialias": true,
			"fill-opacity":   float64(1),
		},
	}, {
		ID: "house-extrusion", Type: "fill-extrusion", SourceLayer: "house", MinZoom: 15,
		Paint: map[string]interface{}{
			"fill-extrusion-color":   []interface{}{"concat", "#", []interface{}{"get", "color"}},
			"fill-extrusion-height":  []interface{}{"get", "height"},
			"fill-extrusion-opacity": []interface{}{"interpolate", []interface{}{"linear"}, []interface{}{"zoom"}, float64(16), float64(1), float64(18), 0.85},
		},
	}},

	// --- Roads ---
	"trail": {{
		ID: "trail", Type: "line", SourceLayer: "trail", MinZoom: 14,
		Paint: map[string]interface{}{
			"line-color":   "rgba(0, 0, 0, 1)",
			"line-opacity": float64(1),
			"line-width":   roadWidthInterp(),
		},
	}},
	"track": {{
		ID: "track-outline", Type: "line", SourceLayer: "track", MinZoom: 12,
		Paint: map[string]interface{}{
			"line-color":   "rgba(0, 0, 0, 1)",
			"line-opacity": float64(1),
			"line-width":   roadOutlineWidthInterp(),
		},
	}, {
		ID: "track", Type: "line", SourceLayer: "track", MinZoom: 12,
		Paint: map[string]interface{}{
			"line-color":   "#D6C2A6",
			"line-opacity": float64(1),
			"line-width":   roadWidthInterp(),
		},
	}},
	"road": {{
		ID: "road-outline", Type: "line", SourceLayer: "road", MinZoom: 12,
		Paint: map[string]interface{}{
			"line-color":   "rgba(0, 0, 0, 1)",
			"line-opacity": float64(1),
			"line-width":   roadOutlineWidthInterp(),
		},
	}, {
		ID: "road", Type: "line", SourceLayer: "road", MinZoom: 12,
		Paint: map[string]interface{}{
			"line-color":   "#FFFFFF",
			"line-opacity": float64(1),
			"line-width":   roadWidthInterp(),
		},
	}},
	"main_road": {{
		ID: "main_road-outline", Type: "line", SourceLayer: "main_road", MinZoom: 12,
		Paint: map[string]interface{}{
			"line-color":   "rgba(230, 128, 77, 1)",
			"line-opacity": float64(1),
			"line-width":   roadOutlineWidthInterp(),
		},
	}, {
		ID: "main_road", Type: "line", SourceLayer: "main_road", MinZoom: 12,
		Layout: map[string]interface{}{
			"line-cap": "butt", "line-join": "round",
		},
		Paint: map[string]interface{}{
			"line-color":   "rgba(255, 153, 1, 1)",
			"line-opacity": float64(1),
			"line-width":   roadWidthInterp(),
		},
	}},

	// --- Bridges ---
	"road-bridge": {{
		ID: "road-bridge", Type: "fill-extrusion", SourceLayer: "road-bridge", MinZoom: 12,
		Paint: map[string]interface{}{
			"fill-extrusion-color":   "rgba(92, 92, 92, 1)",
			"fill-extrusion-opacity": float64(1),
			"fill-extrusion-height":  []interface{}{"get", "height"},
		},
	}},
	"main_road-bridge": {{
		ID: "main_road-bridge", Type: "fill-extrusion", SourceLayer: "main_road-bridge", MinZoom: 12,
		Paint: map[string]interface{}{
			"fill-extrusion-color":   "#BBB",
			"fill-extrusion-opacity": float64(1),
			"fill-extrusion-height":  []interface{}{"get", "height"},
		},
	}},
	"track-bridge": {{
		ID: "track-bridge", Type: "fill-extrusion", SourceLayer: "track-bridge", MinZoom: 12,
		Paint: map[string]interface{}{
			"fill-extrusion-color":   "rgba(92, 92, 92, 1)",
			"fill-extrusion-opacity": float64(1),
			"fill-extrusion-height":  []interface{}{"get", "height"},
		},
	}},
	"trail-bridge": {{
		ID: "trail-bridge", Type: "fill-extrusion", SourceLayer: "trail-bridge", MinZoom: 14,
		Paint: map[string]interface{}{
			"fill-extrusion-color":   "rgba(92, 92, 92, 1)",
			"fill-extrusion-opacity": float64(1),
			"fill-extrusion-height":  []interface{}{"get", "height"},
		},
	}},

	// --- Infrastructure lines ---
	"railway": {{
		ID: "railway-outline", Type: "line", SourceLayer: "railway", MinZoom: 14,
		Paint: map[string]interface{}{
			"line-color": "rgba(0, 0, 0, 1)",
			"line-width": []interface{}{
				"interpolate", []interface{}{"linear"}, []interface{}{"zoom"},
				float64(14), []interface{}{"/", []interface{}{"*", float64(4), 1.3}, float64(5)},
				float64(16), []interface{}{"/", []interface{}{"*", float64(4), 1.3}, float64(2)},
				float64(18), []interface{}{"*", []interface{}{"*", float64(4), 1.3}, 2.5},
				float64(20), []interface{}{"*", []interface{}{"*", float64(4), 1.3}, float64(3)},
			},
		},
	}, {
		ID: "railway", Type: "line", SourceLayer: "railway", MinZoom: 14,
		Paint: map[string]interface{}{
			"line-color": "#CC3300",
			"line-width": []interface{}{
				"interpolate", []interface{}{"linear"}, []interface{}{"zoom"},
				float64(14), []interface{}{"/", float64(4), float64(5)},
				float64(16), []interface{}{"/", float64(4), float64(2)},
				float64(18), []interface{}{"*", float64(4), 2.5},
				float64(20), []interface{}{"*", float64(4), float64(3)},
			},
		},
	}},
	"runway": {{
		ID: "runway", Type: "fill", SourceLayer: "runway", MinZoom: 8,
		Paint: map[string]interface{}{
			"fill-color":   "#808080",
			"fill-opacity": 0.8,
		},
	}},
	"powerline": {{
		ID: "powerline", Type: "line", SourceLayer: "powerline", MinZoom: 15,
		Paint: map[string]interface{}{
			"line-color":   "rgba(128, 121, 121, 1)",
			"line-opacity": float64(1),
			"line-width":   float64(2),
		},
	}},

	// --- Contours (legacy single-layer with type filter) ---
	"contours": {{
		ID: "contours", Type: "line", SourceLayer: "contours", MinZoom: 12,
		Filter: []interface{}{"==", "type", "minor"},
		Paint: map[string]interface{}{
			"line-color":   "#D1BA94",
			"line-opacity": 0.4,
			"line-width":   0.5,
		},
	}, {
		ID: "contours-major", Type: "line", SourceLayer: "contours", MinZoom: 10,
		Filter: []interface{}{"==", "type", "major"},
		Paint: map[string]interface{}{
			"line-color":   "#A67345",
			"line-opacity": 0.7,
			"line-width":   float64(1),
		},
	}},

	// --- Contours (4-interval GDAL layers) ---
	"contours100": {{
		ID: "contours100", Type: "line", SourceLayer: "contours100", MinZoom: 8, MaxZoom: 12,
		Paint: map[string]interface{}{
			"line-color":   contourColorExpr("#A67345"),
			"line-opacity": 0.7,
			"line-width":   float64(1),
		},
	}},
	"contours50": {{
		ID: "contours50", Type: "line", SourceLayer: "contours50", MinZoom: 12,
		Paint: map[string]interface{}{
			"line-color":   contourColorExpr("#A67345"),
			"line-opacity": 0.7,
			"line-width":   float64(1),
		},
	}, {
		ID: "contours50-label", Type: "symbol", SourceLayer: "contours50", MinZoom: 12,
		Layout: map[string]interface{}{
			"symbol-placement": "line",
			"text-field":       []interface{}{"concat", []interface{}{"to-string", []interface{}{"get", "elevation"}}, "m"},
			"text-font":        []interface{}{"Roboto Condensed Regular"},
			"text-size":        10,
			"text-max-angle":   30,
		},
		Paint: map[string]interface{}{
			"text-color":      contourColorExpr("#A67345"),
			"text-halo-color": "rgba(255,255,255,0.7)",
			"text-halo-width": float64(1),
		},
	}},
	"contours10": {{
		ID: "contours10", Type: "line", SourceLayer: "contours10", MinZoom: 14,
		Paint: map[string]interface{}{
			"line-color":   contourColorExpr("#D1BA94"),
			"line-opacity": 0.5,
			"line-width":   0.5,
		},
	}},
	"contours05": {{
		ID: "contours05", Type: "line", SourceLayer: "contours05", MinZoom: 16,
		Paint: map[string]interface{}{
			"line-color":   contourColorExpr("#D1BA94"),
			"line-opacity": 0.3,
			"line-width":   0.5,
		},
	}},

	// --- Object symbols ---
	"rock":        {makeIconStyle("rock", "objects/rock", 16)},
	"bush":        {makeIconStyle("bush", "objects/bush", 16)},
	"tree":        {makeIconStyle("tree", "objects/tree", 16)},
	"chapel":      {makeIconStyle("chapel", "objects/chapel", 15)},
	"church":      {makeIconStyle("church", "objects/church", 15)},
	"cross":       {makeIconStyle("cross", "objects/cross", 15)},
	"fuelstation": {makeIconStyle("fuelstation", "objects/fuelstation", 15)},
	"hospital":    {makeIconStyle("hospital", "objects/hospital", 15)},
	"lighthouse":  {makeIconStyle("lighthouse", "objects/lighthouse", 15)},
	"bunker":      {makeIconStyle("bunker", "objects/bunker", 15)},
	"fountain":    {makeIconStyle("fountain", "objects/fountain", 15)},
	"tourism":     {makeIconStyle("tourism", "objects/tourism", 15)},
	"ruin":        {makeIconStyle("ruin", "objects/ruin", 15)},
	"stack":       {makeIconStyle("stack", "objects/stack", 15)},
	"quay":        {makeIconStyle("quay", "objects/quay", 15)},
	"shipwreck":   {makeIconStyle("shipwreck", "objects/shipwreck", 15)},
	"watertower":  {makeIconStyle("watertower", "objects/watertower", 15)},
	"transmitter": {makeIconStyle("transmitter", "objects/transmitter", 15)},
	"powersolar":  {makeIconStyle("powersolar", "objects/powersolar", 15)},
	"powerwave":   {makeIconStyle("powerwave", "objects/powerwave", 15)},
	"powerwind":   {makeIconStyle("powerwind", "objects/powerwind", 15)},
	"viewtower":   {makeIconStyle("viewtower", "objects/viewtower", 15)},

	// --- Location labels ---
	"hill": {{
		ID: "hill", Type: "symbol", SourceLayer: "hill", MinZoom: 8,
		Layout: map[string]interface{}{
			"icon-image":              "locations/hill",
			"icon-size":               0.25,
			"icon-anchor":             "center",
			"text-field":              []interface{}{"get", "name"},
			"text-font":               []interface{}{"Roboto Condensed Regular"},
			"text-anchor":             "left",
			"text-size":               []interface{}{"interpolate", []interface{}{"exponential", float64(2)}, []interface{}{"zoom"}, float64(12), float64(12), float64(16), float64(32)},
			"text-offset":             []interface{}{float64(1), float64(0)},
			"icon-rotation-alignment": "map",
			"text-pitch-alignment":    "map",
			"text-rotation-alignment": "map",
		},
		Paint: map[string]interface{}{
			"text-color": "#000000", "text-opacity": float64(1),
			"text-halo-color": "rgba(255,255,255,0.7)", "text-halo-width": float64(1),
		},
	}},
	"namemarine": {{
		ID: "namemarine", Type: "symbol", SourceLayer: "namemarine", MinZoom: 8,
		Layout: textLayout("Roboto Condensed Regular",
			[]interface{}{"interpolate", []interface{}{"exponential", float64(2)}, []interface{}{"zoom"}, float64(12), float64(14), float64(16), float64(40)}),
		Paint: map[string]interface{}{
			"text-color": "#0D66CC", "text-opacity": float64(1),
			"text-halo-color": "rgba(255,255,255,0.7)", "text-halo-width": float64(1),
		},
	}},
	"namelocal": {{
		ID: "namelocal", Type: "symbol", SourceLayer: "namelocal", MinZoom: 8,
		Layout: textLayout("Roboto Condensed Bold",
			[]interface{}{"interpolate", []interface{}{"exponential", float64(2)}, []interface{}{"zoom"}, float64(12), float64(14), float64(16), float64(40)}),
		Paint: map[string]interface{}{
			"text-color": "#70614D", "text-opacity": float64(1),
			"text-halo-color": "rgba(255,255,255,0.7)", "text-halo-width": float64(1),
		},
	}},
	"namevillage": {{
		ID: "namevillage", Type: "symbol", SourceLayer: "namevillage", MinZoom: 8,
		Layout: textLayout("Roboto Condensed Regular",
			[]interface{}{"interpolate", []interface{}{"exponential", float64(2)}, []interface{}{"zoom"}, float64(12), float64(14), float64(16), float64(40)}),
		Paint: map[string]interface{}{
			"text-color": "#FFFFFF", "text-opacity": float64(1),
			"text-halo-color": "#000000", "text-halo-width": float64(1), "text-halo-blur": float64(0),
		},
	}},
	"namecity": {{
		ID: "namecity", Type: "symbol", SourceLayer: "namecity", MinZoom: 8,
		Layout: textLayout("Roboto Condensed Regular",
			[]interface{}{"interpolate", []interface{}{"exponential", float64(2)}, []interface{}{"zoom"}, float64(12), float64(18), float64(16), float64(46)}),
		Paint: map[string]interface{}{
			"text-color": "#FFFFFF", "text-opacity": float64(1),
			"text-halo-color": "#000000", "text-halo-width": float64(1), "text-halo-blur": float64(0),
		},
	}},
	"namecitycapital": {{
		ID: "namecitycapital", Type: "symbol", SourceLayer: "namecitycapital", MinZoom: 8,
		Layout: textLayout("Roboto Condensed Regular",
			[]interface{}{"interpolate", []interface{}{"exponential", float64(2)}, []interface{}{"zoom"}, float64(12), float64(24), float64(16), float64(54)}),
		Paint: map[string]interface{}{
			"text-color": "#FFFFFF", "text-opacity": float64(1),
			"text-halo-color": "#000000", "text-halo-width": float64(1), "text-halo-blur": float64(0),
		},
	}},
	"citycenter": {{
		ID: "citycenter", Type: "symbol", SourceLayer: "citycenter", MinZoom: 12,
		Layout: map[string]interface{}{
			"text-field":  []interface{}{"get", "name"},
			"text-font":   []interface{}{"Roboto Condensed Regular"},
			"text-anchor": "left",
			"text-size":   []interface{}{"interpolate", []interface{}{"linear"}, []interface{}{"zoom"}, float64(12), float64(5), float64(16), float64(20)},
			"text-justify": "auto",
		},
		Paint: map[string]interface{}{
			"text-color":      "#406633",
			"text-opacity":    float64(1),
			"text-halo-color": "rgba(255,255,255,0.7)",
			"text-halo-width": float64(1),
		},
	}},

	// --- Vegetation symbols ---
	"vegetationbroadleaf": {makeVegetationStyle("vegetationbroadleaf", "locations/vegetationbroadleaf", 0.5)},
	"vegetationfir":       {makeVegetationStyle("vegetationfir", "locations/vegetationfir", 0.3)},
	"vegetationpalm":      {makeVegetationStyle("vegetationpalm", "locations/vegetationpalm", 0.3)},
	"vegetationvineyard":  {makeVegetationStyle("vegetationvineyard", "locations/vegetationvineyard", 0.3)},
}

func makeIconStyle(name, iconImage string, minZoom int) LayerStyle {
	return LayerStyle{
		ID: name, Type: "symbol", SourceLayer: name, MinZoom: minZoom,
		Layout: iconLayout(iconImage),
	}
}

func makeVegetationStyle(name, iconImage string, iconSize float64) LayerStyle {
	return LayerStyle{
		ID: name, Type: "symbol", SourceLayer: name, MinZoom: 12,
		Layout: map[string]interface{}{
			"icon-image":  iconImage,
			"icon-size":   iconSize,
			"icon-anchor": "center",
			"text-field":  []interface{}{"get", "name"},
			"text-font":   []interface{}{"Roboto Condensed Regular"},
			"text-anchor": "left",
			"text-size":   []interface{}{"interpolate", []interface{}{"linear"}, []interface{}{"zoom"}, float64(12), float64(5), float64(16), float64(20)},
			"text-offset": []interface{}{float64(1), float64(0)},
		},
		Paint: map[string]interface{}{"text-color": "#406633", "text-opacity": float64(1)},
	}
}

// StyleVariant identifies which style variant to generate.
type StyleVariant string

const (
	StyleColorRelief StyleVariant = "color-relief"
	StyleTopo        StyleVariant = "topo"
	StyleSatellite   StyleVariant = "satellite"
	StyleHybrid      StyleVariant = "hybrid"
)

// StyleConfig holds the parameters for generating a style document.
type StyleConfig struct {
	WorldName      string
	URLPrefix      string // e.g. "images/maps/stratis"
	VectorLayers   []string
	HasSatellite   bool
	HasHeightmap   bool
	HasHillshade   bool
	HasColorRelief bool
}

const (
	spriteURL = "https://styles.ocap2.com/sprites/sprite"
	glyphsURL = "https://api.maptiler.com/fonts/{fontstack}/{range}.pbf?key=TyliLk8pnPbcLwptyzJS"
)

// GenerateStyleDocument creates a full MapLibre style JSON document for the given variant.
func GenerateStyleDocument(cfg StyleConfig, variant StyleVariant) map[string]interface{} {
	sources := buildSources(cfg)

	bgColor := "#000000"
	if variant == StyleTopo {
		bgColor = "#DFDFDF"
	}

	var layers []interface{}
	layers = append(layers, map[string]interface{}{
		"id":    "background",
		"type":  "background",
		"paint": map[string]interface{}{"background-color": bgColor},
	})

	switch variant {
	case StyleColorRelief:
		layers = append(layers, buildColorReliefLayers(cfg)...)
	case StyleTopo:
		layers = append(layers, buildTopoLayers(cfg)...)
	case StyleSatellite:
		layers = append(layers, buildSatelliteLayers(cfg)...)
	case StyleHybrid:
		layers = append(layers, buildHybridLayers(cfg)...)
	}

	doc := map[string]interface{}{
		"version": 8,
		"name":    cfg.WorldName + "-" + string(variant),
		"sources": sources,
		"layers":  layers,
		"sprite":  spriteURL,
		"glyphs":  glyphsURL,
	}
	return doc
}

func buildSources(cfg StyleConfig) map[string]interface{} {
	sources := map[string]interface{}{}
	prefix := cfg.URLPrefix

	sources["features"] = map[string]interface{}{
		"type": "vector",
		"url":  "pmtiles://" + assetPath(prefix, "features.pmtiles"),
	}

	if cfg.HasSatellite {
		sources["satellite"] = map[string]interface{}{
			"type":     "raster",
			"url":      "pmtiles://" + assetPath(prefix, "satellite.pmtiles"),
			"tileSize": 256,
		}
	}

	if cfg.HasHeightmap {
		sources["heightmap"] = map[string]interface{}{
			"type":     "raster-dem",
			"url":      "pmtiles://" + assetPath(prefix, "heightmap.pmtiles"),
			"tileSize": 256,
		}
	}

	if cfg.HasHillshade {
		sources["hillshade"] = map[string]interface{}{
			"type":     "raster",
			"url":      "pmtiles://" + assetPath(prefix, "hillshade.pmtiles"),
			"tileSize": 256,
		}
	}

	if cfg.HasColorRelief {
		sources["color-relief"] = map[string]interface{}{
			"type":     "raster",
			"url":      "pmtiles://" + assetPath(prefix, "color-relief.pmtiles"),
			"tileSize": 256,
		}
	}

	return sources
}

// --- Color Relief style layers ---

func buildColorReliefLayers(cfg StyleConfig) []interface{} {
	var layers []interface{}

	// Color relief
	if cfg.HasColorRelief {
		layers = append(layers, map[string]interface{}{
			"id": "color-relief", "type": "raster", "source": "color-relief",
		})
	}

	// Hillshade (raster) at 50% opacity
	if cfg.HasHillshade {
		layers = append(layers, map[string]interface{}{
			"id": "hillshade-raster", "type": "raster", "source": "hillshade",
			"paint": map[string]interface{}{"raster-opacity": 0.5},
		})
	}

	// Satellite (hidden by default, allows layer toggle in UI)
	if cfg.HasSatellite {
		layers = append(layers, map[string]interface{}{
			"id": "satellite", "type": "raster", "source": "satellite",
			"layout": map[string]interface{}{"visibility": "none"},
		})
	}

	// Vector feature layers
	layers = append(layers, buildVectorFeatureLayers(cfg.VectorLayers, layerVisStandard)...)

	return layers
}

// --- Topo style layers (color relief hidden) ---

func buildTopoLayers(cfg StyleConfig) []interface{} {
	var layers []interface{}

	// Color relief present but hidden
	if cfg.HasColorRelief {
		layers = append(layers, map[string]interface{}{
			"id": "color-relief", "type": "raster", "source": "color-relief",
			"layout": map[string]interface{}{"visibility": "none"},
		})
	}

	// Hillshade (raster) at 50% opacity
	if cfg.HasHillshade {
		layers = append(layers, map[string]interface{}{
			"id": "hillshade-raster", "type": "raster", "source": "hillshade",
			"paint": map[string]interface{}{"raster-opacity": 0.5},
		})
	}

	// Satellite (hidden by default)
	if cfg.HasSatellite {
		layers = append(layers, map[string]interface{}{
			"id": "satellite", "type": "raster", "source": "satellite",
			"layout": map[string]interface{}{"visibility": "none"},
		})
	}

	// Vector feature layers (same as color relief)
	layers = append(layers, buildVectorFeatureLayers(cfg.VectorLayers, layerVisStandard)...)

	return layers
}

// --- Satellite style layers ---

func buildSatelliteLayers(cfg StyleConfig) []interface{} {
	var layers []interface{}

	// Hillshade at 40% with high contrast
	if cfg.HasHillshade {
		layers = append(layers, map[string]interface{}{
			"id": "hillshade-raster", "type": "raster", "source": "hillshade",
			"paint": map[string]interface{}{
				"raster-opacity": 0.4,
				"raster-contrast": 0.3,
			},
		})
	}

	// Satellite at 100%
	if cfg.HasSatellite {
		layers = append(layers, map[string]interface{}{
			"id": "satellite", "type": "raster", "source": "satellite",
		})
	}

	// Sea fill at 50% opacity, no land fill
	layers = append(layers, buildVectorFeatureLayers(cfg.VectorLayers, layerVisSatellite)...)

	return layers
}

// --- Hybrid style layers ---

func buildHybridLayers(cfg StyleConfig) []interface{} {
	var layers []interface{}

	// Native hillshade from heightmap DEM source
	if cfg.HasHeightmap {
		layers = append(layers, map[string]interface{}{
			"id":     "hillshade-native",
			"type":   "hillshade",
			"source": "heightmap",
			"paint": map[string]interface{}{
				"hillshade-shadow-color":    "#000000",
				"hillshade-highlight-color": "#ffffff",
				"hillshade-exaggeration":    0.3,
			},
		})
	}

	// Satellite at 60% with reduced saturation
	if cfg.HasSatellite {
		layers = append(layers, map[string]interface{}{
			"id": "satellite", "type": "raster", "source": "satellite",
			"paint": map[string]interface{}{
				"raster-opacity":   0.6,
				"raster-saturation": -0.3,
			},
		})
	}

	// Full vector features
	layers = append(layers, buildVectorFeatureLayers(cfg.VectorLayers, layerVisHybrid)...)

	return layers
}

// layerVisibility controls per-layer visibility across style variants.
type layerVisibility struct {
	seaLand     bool
	seaWater    bool
	seaOpacity  float64 // override sea-water opacity (0 = use default)
	forest      bool
	rocks       bool
	roads       bool
	buildings   bool
	contours    bool
	labels      bool
	icons       bool
	bridges     bool
	railway     bool
	powerline   bool
	vegetation  bool
}

var layerVisStandard = layerVisibility{
	seaLand: true, seaWater: true,
	forest: true, rocks: true, roads: true, buildings: true,
	contours: true, labels: true, icons: true,
	bridges: true, railway: true, powerline: true, vegetation: true,
}

var layerVisSatellite = layerVisibility{
	seaLand: false, seaWater: true, seaOpacity: 0.5,
	forest: false, rocks: true, roads: true, buildings: true,
	contours: true, labels: true, icons: true,
	bridges: true, railway: true, powerline: true, vegetation: false,
}

var layerVisHybrid = layerVisibility{
	seaLand: true, seaWater: true,
	forest: true, rocks: true, roads: true, buildings: true,
	contours: true, labels: true, icons: true,
	bridges: true, railway: true, powerline: true, vegetation: true,
}

// categorizeLayer returns which visibility category a layer belongs to.
func categorizeLayer(name string) string {
	switch name {
	case "sea":
		return "sea"
	case "forest":
		return "forest"
	case "rocks":
		return "rocks"
	case "house":
		return "buildings"
	case "trail", "track", "road", "main_road", "runway":
		return name
	case "road-bridge", "main_road-bridge", "track-bridge", "trail-bridge":
		return "bridges"
	case "railway":
		return "railway"
	case "powerline":
		return "powerline"
	case "contours", "contours05", "contours10", "contours50", "contours100":
		return "contours"
	case "vegetationbroadleaf", "vegetationfir", "vegetationpalm", "vegetationvineyard":
		return "vegetation"
	case "hill", "namemarine", "namelocal", "namevillage", "namecity",
		"namecitycapital", "citycenter":
		return "labels"
	}
	// Object icons
	if _, ok := knownLayerStyles[name]; ok {
		for _, s := range knownLayerStyles[name] {
			if s.Type == "symbol" && s.Layout != nil {
				if _, hasIcon := s.Layout["icon-image"]; hasIcon {
					return "icons"
				}
			}
		}
	}
	return "other"
}

func isLayerVisible(name string, vis layerVisibility) bool {
	cat := categorizeLayer(name)
	switch cat {
	case "sea":
		return vis.seaLand || vis.seaWater
	case "forest":
		return vis.forest
	case "rocks":
		return vis.rocks
	case "buildings":
		return vis.buildings
	case "trail", "track", "road", "main_road", "runway":
		return vis.roads
	case "bridges":
		return vis.bridges
	case "railway":
		return vis.railway
	case "powerline":
		return vis.powerline
	case "contours":
		return vis.contours
	case "labels":
		return vis.labels
	case "icons":
		return vis.icons
	case "vegetation":
		return vis.vegetation
	default:
		return true
	}
}

// categoryRenderOrder defines the bottom-to-top painting order for layer
// categories. Lower values render first (below), higher values render last
// (on top). Labels and icons must be above roads to remain readable.
var categoryRenderOrder = map[string]int{
	"sea":         0,
	"contours":    1,
	"forest":      2,
	"rocks":       3,
	"buildings":   4,
	"trail":       5,
	"track":       6,
	"road":        7,
	"main_road":   8,
	"runway":      9,
	"railway":     10,
	"powerline":   11,
	"bridges":     12,
	"vegetation":  13,
	"icons":       14,
	"labels":      15,
	"other":       16,
}

// buildVectorFeatureLayers generates MapLibre layers from vector layer names,
// filtered by the given visibility rules. Layers are sorted by cartographic
// render order so labels always appear above roads regardless of input order.
func buildVectorFeatureLayers(layerNames []string, vis layerVisibility) []interface{} {
	sorted := make([]string, len(layerNames))
	copy(sorted, layerNames)
	sort.SliceStable(sorted, func(i, j int) bool {
		return categoryRenderOrder[categorizeLayer(sorted[i])] < categoryRenderOrder[categorizeLayer(sorted[j])]
	})

	var result []interface{}
	for _, name := range sorted {
		if !isLayerVisible(name, vis) {
			continue
		}
		for _, style := range GetLayerStyles(name) {
			layer := map[string]interface{}{
				"id":           style.ID,
				"type":         style.Type,
				"source":       "features",
				"source-layer": style.SourceLayer,
			}
			if style.MinZoom > 0 {
				layer["minzoom"] = style.MinZoom
			}
			if style.MaxZoom > 0 {
				layer["maxzoom"] = style.MaxZoom
			}

			paint := copyMap(style.Paint)
			if style.Layout != nil {
				layer["layout"] = style.Layout
			}
			if style.Filter != nil {
				layer["filter"] = style.Filter
			}

			// Apply sea layer visibility/opacity overrides
			if name == "sea" {
				if style.ID == "sea-land" && !vis.seaLand {
					continue
				}
				if style.ID == "sea-water" {
					if !vis.seaWater {
						continue
					}
					if vis.seaOpacity > 0 {
						paint["fill-opacity"] = vis.seaOpacity
					}
				}
			}

			if paint != nil {
				layer["paint"] = paint
			}
			result = append(result, layer)
		}
	}
	return result
}

// copyMap makes a shallow copy of a map.
func copyMap(m map[string]interface{}) map[string]interface{} {
	if m == nil {
		return nil
	}
	out := make(map[string]interface{}, len(m))
	for k, v := range m {
		out[k] = v
	}
	return out
}
