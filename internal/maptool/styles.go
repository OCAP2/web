package maptool

import "sort"

const (
	// arma3SeaColor matches Arma 3's colorSea {0.56, 0.8, 0.98, 0.5}.
	arma3SeaColor = "#8FCCFA"
	// arma3SeaColorDark is a darkened variant for the topo-dark theme.
	arma3SeaColorDark = "#3a6a9c"
	// arma3UnderwaterContour is the contour line color for negative elevations.
	arma3UnderwaterContour = "#4A8BBF"
	// landColor is the base terrain fill for light style variants.
	landColor = "#DFDFDF"
	// landColorDark is the base terrain fill for the topo-dark variant.
	landColorDark = "#2a2a2a"
)

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
		10.0, []interface{}{"/", []interface{}{"get", "width"}, 8.0},
		12.0, []interface{}{"/", []interface{}{"get", "width"}, 6.0},
		16.0, []interface{}{"/", []interface{}{"get", "width"}, 3.0},
		18.0, []interface{}{"*", []interface{}{"get", "width"}, 2.5},
		20.0, []interface{}{"*", []interface{}{"get", "width"}, 3.0},
	}
}

// roadOutlineWidthInterp returns a wider variant for road outlines.
func roadOutlineWidthInterp() interface{} {
	return []interface{}{
		"interpolate", []interface{}{"linear"}, []interface{}{"zoom"},
		10.0, []interface{}{"/", []interface{}{"*", []interface{}{"get", "width"}, 1.3}, 8.0},
		12.0, []interface{}{"/", []interface{}{"*", []interface{}{"get", "width"}, 1.3}, 6.0},
		16.0, []interface{}{"/", []interface{}{"*", []interface{}{"get", "width"}, 1.3}, 3.0},
		18.0, []interface{}{"*", []interface{}{"*", []interface{}{"get", "width"}, 1.3}, 2.5},
		20.0, []interface{}{"*", []interface{}{"*", []interface{}{"get", "width"}, 1.3}, 3.0},
	}
}

// contourColorExpr returns a MapLibre case expression that uses underwater blue
// for negative elevation and the given landColor otherwise.
func contourColorExpr(landColor string) interface{} {
	return []interface{}{
		"case",
		[]interface{}{"<", []interface{}{"get", "elevation"}, 0.0},
		arma3UnderwaterContour,
		landColor,
	}
}

// topoContourColorExpr returns a case expression for topo-style contours.
// Uses arma3UnderwaterContour for underwater (elevation <= 0) and #D1BA94 for land.
func topoContourColorExpr() interface{} {
	return []interface{}{
		"case",
		[]interface{}{"<=", []interface{}{"get", "elevation"}, 0.0},
		arma3UnderwaterContour,
		"#D1BA94",
	}
}

// topoContourTextColorExpr returns a darker case expression for topo contour labels.
func topoContourTextColorExpr() interface{} {
	return []interface{}{
		"case",
		[]interface{}{"<=", []interface{}{"get", "elevation"}, 0.0},
		"#2A6B9F",
		"#9A8060",
	}
}

// topoDarkContourTextColorExpr returns a darker case expression for topo-dark contour labels.
func topoDarkContourTextColorExpr() interface{} {
	return []interface{}{
		"case",
		[]interface{}{"<=", []interface{}{"get", "elevation"}, 0.0},
		"#2A6B9F",
		"#3a2a1a",
	}
}

// seaContourOpacityExpr returns a zoom-interpolated opacity for underwater contours
// that fades in from low opacity when zoomed out to full when zoomed in.
// Land contours keep the given landOpacity at all zoom levels.
func seaContourOpacityExpr(landOpacity float64) interface{} {
	// zoom must be top-level — nest case inside interpolate stops
	seaLow := []interface{}{
		"case",
		[]interface{}{"<=", []interface{}{"get", "elevation"}, 0.0},
		0.15,
		landOpacity,
	}
	return []interface{}{
		"interpolate", []interface{}{"linear"}, []interface{}{"zoom"},
		12.0, seaLow,
		15.0, landOpacity,
	}
}

// topoTextLayout returns a label layout for the topo style variant.
func topoTextLayout() map[string]interface{} {
	return map[string]interface{}{
		"text-field":  []interface{}{"get", "name"},
		"text-font":   []interface{}{"OpenSans-Regular"},
		"text-anchor": "left",
		"text-size":   []interface{}{"interpolate", []interface{}{"linear"}, []interface{}{"zoom"}, 12.0, 5.0, 16.0, 20.0},
		"text-offset": []interface{}{1.0, 0.0},
	}
}

// topoTextPaint returns topo-style text paint with a black halo.
func topoTextPaint(color string) map[string]interface{} {
	return map[string]interface{}{
		"text-color":      color,
		"text-opacity":    1.0,
		"text-halo-color": "#000000",
		"text-halo-width": 1.0,
		"text-halo-blur":  0.0,
	}
}

// topoDarkContourColorExpr returns a case expression for topo-dark contours.
// Uses arma3UnderwaterContour for underwater (elevation <= 0) and #5a4a3a for land.
func topoDarkContourColorExpr() interface{} {
	return []interface{}{
		"case",
		[]interface{}{"<=", []interface{}{"get", "elevation"}, 0.0},
		arma3UnderwaterContour,
		"#5a4a3a",
	}
}

// topoDarkTextPaint returns topo-dark text paint with a dark halo for light text.
func topoDarkTextPaint(color string) map[string]interface{} {
	return map[string]interface{}{
		"text-color":      color,
		"text-opacity":    1.0,
		"text-halo-color": "#111111",
		"text-halo-width": 1.0,
		"text-halo-blur":  0.0,
	}
}

func makeTopoDarkLabel(name, color string) LayerStyle {
	return LayerStyle{
		ID: name, Type: "symbol", SourceLayer: name,
		Layout: topoTextLayout(),
		Paint:  topoDarkTextPaint(color),
	}
}

// makeTopoSymbol creates a symbol layer style shared by topo and topo-dark variants.
func makeTopoSymbol(name, iconImage string, iconSize float64, allowOverlap bool) LayerStyle {
	return LayerStyle{
		ID: name, Type: "symbol", SourceLayer: name,
		Layout: map[string]interface{}{
			"icon-image": iconImage, "icon-anchor": "center",
			"icon-size":             []interface{}{"interpolate", []interface{}{"linear"}, []interface{}{"zoom"}, 12.0, iconSize, 16.0, iconSize * 4},
			"icon-allow-overlap":    allowOverlap,
			"icon-ignore-placement": allowOverlap,
		},
	}
}

// iconLayout returns a standard symbol layout for an icon layer.
func iconLayout(iconImage string) map[string]interface{} {
	return map[string]interface{}{
		"icon-image":              iconImage,
		"icon-size":               []interface{}{"interpolate", []interface{}{"linear"}, []interface{}{"zoom"}, 12.0, 0.25, 16.0, 1.0},
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
		ID: "land", Type: "fill", SourceLayer: "sea",
		Filter: []interface{}{">", []interface{}{"get", "ELEV_MAX"}, 0.0},
		Paint:  map[string]interface{}{"fill-color": landColor, "fill-opacity": 1.0, "fill-antialias": true},
	}, {
		ID: "sea", Type: "fill", SourceLayer: "sea",
		Filter: []interface{}{"<=", []interface{}{"get", "ELEV_MAX"}, 0.0},
		Paint:  map[string]interface{}{"fill-color": arma3SeaColor, "fill-opacity": 0.5, "fill-antialias": false},
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
			"fill-opacity":   1.0,
		},
	}, {
		ID: "house-extrusion", Type: "fill-extrusion", SourceLayer: "house", MinZoom: 15,
		Paint: map[string]interface{}{
			"fill-extrusion-color":   []interface{}{"concat", "#", []interface{}{"get", "color"}},
			"fill-extrusion-height":  []interface{}{"get", "height"},
			"fill-extrusion-opacity": []interface{}{"interpolate", []interface{}{"linear"}, []interface{}{"zoom"}, 16.0, 1.0, 18.0, 0.85},
		},
	}},

	// --- Roads ---
	"trail": {{
		ID: "trail", Type: "line", SourceLayer: "trail", MinZoom: 14,
		Paint: map[string]interface{}{
			"line-color":   "rgba(0, 0, 0, 1)",
			"line-opacity": 1.0,
			"line-width":   roadWidthInterp(),
		},
	}},
	"track": {{
		ID: "track-outline", Type: "line", SourceLayer: "track", MinZoom: 12,
		Paint: map[string]interface{}{
			"line-color":   "rgba(0, 0, 0, 1)",
			"line-opacity": 1.0,
			"line-width":   roadOutlineWidthInterp(),
		},
	}, {
		ID: "track", Type: "line", SourceLayer: "track", MinZoom: 12,
		Paint: map[string]interface{}{
			"line-color":   "#D6C2A6",
			"line-opacity": 1.0,
			"line-width":   roadWidthInterp(),
		},
	}},
	"road": {{
		ID: "road-outline", Type: "line", SourceLayer: "road", MinZoom: 12,
		Paint: map[string]interface{}{
			"line-color":   "rgba(0, 0, 0, 1)",
			"line-opacity": 1.0,
			"line-width":   roadOutlineWidthInterp(),
		},
	}, {
		ID: "road", Type: "line", SourceLayer: "road", MinZoom: 12,
		Paint: map[string]interface{}{
			"line-color":   "#FFFFFF",
			"line-opacity": 1.0,
			"line-width":   roadWidthInterp(),
		},
	}},
	"main_road": {{
		ID: "main_road-outline", Type: "line", SourceLayer: "main_road", MinZoom: 12,
		Paint: map[string]interface{}{
			"line-color":   "rgba(230, 128, 77, 1)",
			"line-opacity": 1.0,
			"line-width":   roadOutlineWidthInterp(),
		},
	}, {
		ID: "main_road", Type: "line", SourceLayer: "main_road", MinZoom: 12,
		Layout: map[string]interface{}{
			"line-cap": "butt", "line-join": "round",
		},
		Paint: map[string]interface{}{
			"line-color":   "rgba(255, 153, 1, 1)",
			"line-opacity": 1.0,
			"line-width":   roadWidthInterp(),
		},
	}},

	// --- Bridges ---
	"road-bridge": {{
		ID: "road-bridge", Type: "fill-extrusion", SourceLayer: "road-bridge", MinZoom: 12,
		Paint: map[string]interface{}{
			"fill-extrusion-color":   "rgba(92, 92, 92, 1)",
			"fill-extrusion-opacity": 1.0,
			"fill-extrusion-height":  []interface{}{"get", "height"},
		},
	}},
	"main_road-bridge": {{
		ID: "main_road-bridge", Type: "fill-extrusion", SourceLayer: "main_road-bridge", MinZoom: 12,
		Paint: map[string]interface{}{
			"fill-extrusion-color":   "#BBB",
			"fill-extrusion-opacity": 1.0,
			"fill-extrusion-height":  []interface{}{"get", "height"},
		},
	}},
	"track-bridge": {{
		ID: "track-bridge", Type: "fill-extrusion", SourceLayer: "track-bridge", MinZoom: 12,
		Paint: map[string]interface{}{
			"fill-extrusion-color":   "rgba(92, 92, 92, 1)",
			"fill-extrusion-opacity": 1.0,
			"fill-extrusion-height":  []interface{}{"get", "height"},
		},
	}},
	"trail-bridge": {{
		ID: "trail-bridge", Type: "fill-extrusion", SourceLayer: "trail-bridge", MinZoom: 14,
		Paint: map[string]interface{}{
			"fill-extrusion-color":   "rgba(92, 92, 92, 1)",
			"fill-extrusion-opacity": 1.0,
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
				14.0, []interface{}{"/", []interface{}{"*", 4.0, 1.3}, 5.0},
				16.0, []interface{}{"/", []interface{}{"*", 4.0, 1.3}, 2.0},
				18.0, []interface{}{"*", []interface{}{"*", 4.0, 1.3}, 2.5},
				20.0, []interface{}{"*", []interface{}{"*", 4.0, 1.3}, 3.0},
			},
		},
	}, {
		ID: "railway", Type: "line", SourceLayer: "railway", MinZoom: 14,
		Paint: map[string]interface{}{
			"line-color": "#CC3300",
			"line-width": []interface{}{
				"interpolate", []interface{}{"linear"}, []interface{}{"zoom"},
				14.0, []interface{}{"/", 4.0, 5.0},
				16.0, []interface{}{"/", 4.0, 2.0},
				18.0, []interface{}{"*", 4.0, 2.5},
				20.0, []interface{}{"*", 4.0, 3.0},
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
			"line-opacity": 1.0,
			"line-width":   2.0,
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
			"line-width":   1.0,
		},
	}},

	// --- Contours (4-interval GDAL layers) ---
	"contours100": {{
		ID: "contours100", Type: "line", SourceLayer: "contours100", MinZoom: 8, MaxZoom: 12,
		Paint: map[string]interface{}{
			"line-color":   contourColorExpr("#A67345"),
			"line-opacity": 0.7,
			"line-width":   1.0,
		},
	}},
	"contours50": {{
		ID: "contours50", Type: "line", SourceLayer: "contours50", MinZoom: 12,
		Paint: map[string]interface{}{
			"line-color":   contourColorExpr("#A67345"),
			"line-opacity": 0.7,
			"line-width":   1.0,
		},
	}, {
		ID: "contours50-label", Type: "symbol", SourceLayer: "contours50", MinZoom: 14,
		Layout: map[string]interface{}{
			"symbol-placement": "line",
			"text-field":       []interface{}{"concat", []interface{}{"to-string", []interface{}{"get", "elevation"}}, "m"},
			"text-font":        []interface{}{"OpenSans-Regular"},
			"text-size":        10,
			"text-max-angle":   30,
		},
		Paint: map[string]interface{}{
			"text-color":      contourColorExpr("#A67345"),
			"text-halo-color": "rgba(255,255,255,0.7)",
			"text-halo-width": 1.0,
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
			"line-width":   0.25,
		},
	}},

	// --- Object symbols ---
	"rock":        {makeIconStyle("rock", "objects/rock", 16)},
	"tree":        makeTreeCircleStyle("#5CA05C"),
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

	// --- Mountain peaks ---
	"mount": {{
		ID: "mount", Type: "symbol", SourceLayer: "mount", MinZoom: 8,
		Layout: map[string]interface{}{
			"icon-allow-overlap":    true,
			"text-field":            []interface{}{"get", "text"},
			"text-font":             []interface{}{"OpenSans-Regular"},
			"text-anchor":           "left",
			"text-size":             12,
			"text-offset":           []interface{}{0.5, 0.0},
			"symbol-sort-key":       []interface{}{"*", []interface{}{"get", "elevation"}, -1.0},
		},
		Paint: map[string]interface{}{
			"text-color": "#482c18", "text-opacity": 0.5,
		},
	}},

	// --- Missing location labels & POIs (text-only, no icon PNGs yet) ---
	"fortress":         {makeLabelStyle("fortress", "#000000", 14)},
	"airport":          {makeLabelStyle("airport", "#406633", 12)},
	"bordercrossing":   {makeLabelStyle("bordercrossing", "#C7000D", 15)},
	"viewpoint":        {makeLabelStyle("viewpoint", "#C7000D", 11)},
	"flag":             {makeLabelStyle("flag", "#000000", 12)},
	"rockarea":         {makeLabelStyle("rockarea", "#000000", 12)},
	"handdrawncamp":    {makeLabelStyle("handdrawncamp", "#000000", 12)},
	"power":            {makeLabelStyle("power", "#000000", 15)},
	"name":             {makeLabelStyle("name", "#000000", 12)},
	"faketown":         {makeLabelStyle("faketown", "#000000", 12)},
	"strategic":        {makeLabelStyle("strategic", "#406633", 12)},
	"flatareacity":     {makeLabelStyle("flatareacity", "#406633", 12)},
	"flatareacitysmall": {makeLabelStyle("flatareacitysmall", "#406633", 12)},
	"strongpointarea":  {makeLabelStyle("strongpointarea", "#406633", 12)},
	"civildefense":     {makeLabelStyle("civildefense", "#406633", 12)},
	"culturalproperty": {makeLabelStyle("culturalproperty", "#FFFFFF", 12)},
	"dangerousforces":  {makeLabelStyle("dangerousforces", "#FFFFFF", 12)},
	"safetyzone":       {makeLabelStyle("safetyzone", "#FFFFFF", 12)},

	// --- Location labels ---
	"hill": {{
		ID: "hill", Type: "symbol", SourceLayer: "hill", MinZoom: 8,
		Layout: map[string]interface{}{
			"icon-image":              "locations/hill",
			"icon-size":               0.25,
			"icon-anchor":             "center",
			"text-field":              []interface{}{"get", "name"},
			"text-font":               []interface{}{"OpenSans-Regular"},
			"text-anchor":             "left",
			"text-size":               []interface{}{"interpolate", []interface{}{"exponential", 2.0}, []interface{}{"zoom"}, 12.0, 12.0, 16.0, 32.0},
			"text-offset":             []interface{}{1.0, 0.0},
			"icon-rotation-alignment": "map",
			"text-pitch-alignment":    "map",
			"text-rotation-alignment": "map",
		},
		Paint: map[string]interface{}{
			"text-color": "#000000", "text-opacity": 1.0,
			"text-halo-color": "rgba(255,255,255,0.7)", "text-halo-width": 1.0,
		},
	}},
	"namemarine": {{
		ID: "namemarine", Type: "symbol", SourceLayer: "namemarine", MinZoom: 8,
		Layout: textLayout("OpenSans-Regular",
			[]interface{}{"interpolate", []interface{}{"exponential", 2.0}, []interface{}{"zoom"}, 12.0, 14.0, 16.0, 40.0}),
		Paint: map[string]interface{}{
			"text-color": "#0D66CC", "text-opacity": 1.0,
			"text-halo-color": "rgba(255,255,255,0.7)", "text-halo-width": 1.0,
		},
	}},
	"namelocal": {{
		ID: "namelocal", Type: "symbol", SourceLayer: "namelocal", MinZoom: 8,
		Layout: textLayout("OpenSans-Bold",
			[]interface{}{"interpolate", []interface{}{"exponential", 2.0}, []interface{}{"zoom"}, 12.0, 14.0, 16.0, 40.0}),
		Paint: map[string]interface{}{
			"text-color": "#70614D", "text-opacity": 1.0,
			"text-halo-color": "rgba(255,255,255,0.7)", "text-halo-width": 1.0,
		},
	}},
	"namevillage": {{
		ID: "namevillage", Type: "symbol", SourceLayer: "namevillage", MinZoom: 8,
		Layout: textLayout("OpenSans-Regular",
			[]interface{}{"interpolate", []interface{}{"exponential", 2.0}, []interface{}{"zoom"}, 12.0, 14.0, 16.0, 40.0}),
		Paint: map[string]interface{}{
			"text-color": "#FFFFFF", "text-opacity": 1.0,
			"text-halo-color": "#000000", "text-halo-width": 1.0, "text-halo-blur": 0.0,
		},
	}},
	"namecity": {{
		ID: "namecity", Type: "symbol", SourceLayer: "namecity", MinZoom: 8,
		Layout: textLayout("OpenSans-Regular",
			[]interface{}{"interpolate", []interface{}{"exponential", 2.0}, []interface{}{"zoom"}, 12.0, 18.0, 16.0, 46.0}),
		Paint: map[string]interface{}{
			"text-color": "#FFFFFF", "text-opacity": 1.0,
			"text-halo-color": "#000000", "text-halo-width": 1.0, "text-halo-blur": 0.0,
		},
	}},
	"namecitycapital": {{
		ID: "namecitycapital", Type: "symbol", SourceLayer: "namecitycapital", MinZoom: 8,
		Layout: textLayout("OpenSans-Regular",
			[]interface{}{"interpolate", []interface{}{"exponential", 2.0}, []interface{}{"zoom"}, 12.0, 24.0, 16.0, 54.0}),
		Paint: map[string]interface{}{
			"text-color": "#FFFFFF", "text-opacity": 1.0,
			"text-halo-color": "#000000", "text-halo-width": 1.0, "text-halo-blur": 0.0,
		},
	}},
	"citycenter": {{
		ID: "citycenter", Type: "symbol", SourceLayer: "citycenter", MinZoom: 12,
		Layout: map[string]interface{}{
			"text-field":  []interface{}{"get", "name"},
			"text-font":   []interface{}{"OpenSans-Regular"},
			"text-anchor": "left",
			"text-size":   []interface{}{"interpolate", []interface{}{"linear"}, []interface{}{"zoom"}, 12.0, 5.0, 16.0, 20.0},
			"text-justify": "auto",
		},
		Paint: map[string]interface{}{
			"text-color":      "#406633",
			"text-opacity":    1.0,
			"text-halo-color": "rgba(255,255,255,0.7)",
			"text-halo-width": 1.0,
		},
	}},

}

func makeIconStyle(name, iconImage string, minZoom int) LayerStyle {
	return LayerStyle{
		ID: name, Type: "symbol", SourceLayer: name, MinZoom: minZoom,
		Layout: iconLayout(iconImage),
	}
}

// makeLabelStyle creates a text-only symbol layer for named features.
func makeLabelStyle(name, color string, minZoom int) LayerStyle {
	return LayerStyle{
		ID: name, Type: "symbol", SourceLayer: name, MinZoom: minZoom,
		Layout: map[string]interface{}{
			"text-field":  []interface{}{"get", "name"},
			"text-font":   []interface{}{"OpenSans-Regular"},
			"text-anchor": "left",
			"text-size":   []interface{}{"interpolate", []interface{}{"linear"}, []interface{}{"zoom"}, 12.0, 5.0, 16.0, 20.0},
			"text-justify": "auto",
		},
		Paint: map[string]interface{}{
			"text-color":      color,
			"text-opacity":    1.0,
			"text-halo-color": "rgba(255,255,255,0.7)",
			"text-halo-width": 1.0,
		},
	}
}

func makeTreeCircleStyle(strokeColor string) []LayerStyle {
	return []LayerStyle{{
		ID: "tree", Type: "circle", SourceLayer: "tree", MinZoom: 15,
		Paint: map[string]interface{}{
			"circle-radius":       []interface{}{"interpolate", []interface{}{"linear"}, []interface{}{"zoom"}, 15.0, 3.0, 18.0, 6.0, 20.0, 10.0},
			"circle-color":        "transparent",
			"circle-stroke-color": strokeColor,
			"circle-stroke-width": 1.5,
			"circle-opacity":      0.7,
		},
	}}
}

func makeTopoLabel(name, color string) LayerStyle {
	return LayerStyle{
		ID: name, Type: "symbol", SourceLayer: name,
		Layout: topoTextLayout(),
		Paint:  topoTextPaint(color),
	}
}

// knownTopoLayerStyles maps layer names to their topo-specific MapLibre styles.
var knownTopoLayerStyles = map[string][]LayerStyle{
	// NOTE: "sea" is handled explicitly in buildTopoLayers() as land/sea
	// with ELEV_MAX filters. It's kept in topoLayerOrder to suppress fallback.
	"contours05": {{
		ID: "contours/05", Type: "line", SourceLayer: "contours05", MinZoom: 16,
		Paint: map[string]interface{}{
			"line-color": topoContourColorExpr(), "line-opacity": 0.3, "line-width": 0.25,
		},
	}},
	"contours10": {{
		ID: "contours/10", Type: "line", SourceLayer: "contours10", MinZoom: 14,
		Paint: map[string]interface{}{
			"line-color": topoContourColorExpr(), "line-opacity": 0.5, "line-width": 0.5,
		},
	}},
	"contours50": {{
		ID: "contours/50", Type: "line", SourceLayer: "contours50", MinZoom: 12,
		Paint: map[string]interface{}{
			"line-color": topoContourColorExpr(), "line-opacity": seaContourOpacityExpr(0.7), "line-width": 1.0,
		},
	}, {
		ID: "contours/50-text", Type: "symbol", SourceLayer: "contours50", MinZoom: 14,
		Layout: map[string]interface{}{
			"symbol-placement": "line",
			"text-field":       []interface{}{"concat", []interface{}{"to-string", []interface{}{"get", "elevation"}}, "m"},
			"text-font":        []interface{}{"OpenSans-Regular"},
			"text-size":        14,
			"text-max-angle":   30,
		},
		Paint: map[string]interface{}{
			"text-color": topoContourTextColorExpr(),
		},
	}},
	"contours100": {{
		ID: "contours/100", Type: "line", SourceLayer: "contours100", MinZoom: 8, MaxZoom: 12,
		Paint: map[string]interface{}{
			"line-color": topoContourColorExpr(), "line-opacity": seaContourOpacityExpr(0.7), "line-width": 1.0,
		},
	}},
	"track": {{
		ID: "track", Type: "line", SourceLayer: "track",
		Paint: map[string]interface{}{
			"line-color": "#D6C2A6", "line-opacity": 1.0, "line-width": roadWidthInterp(),
		},
	}},
	"road": {{
		ID: "road", Type: "line", SourceLayer: "road",
		Paint: map[string]interface{}{
			"line-color": "#FFFFFF", "line-opacity": 1.0, "line-width": roadWidthInterp(),
		},
	}},
	"main_road-bridge": {{
		ID: "main_road-bridge", Type: "fill-extrusion", SourceLayer: "main_road-bridge",
		Paint: map[string]interface{}{
			"fill-extrusion-color":   "#BBB",
			"fill-extrusion-opacity": 1.0,
			"fill-extrusion-height":  []interface{}{"get", "height"},
		},
	}},
	"forest": {{
		ID: "forest", Type: "fill", SourceLayer: "forest",
		Paint: map[string]interface{}{
			"fill-color": "#9FC763", "fill-opacity": 0.3, "fill-antialias": true,
		},
	}},
	"rocks": {{
		ID: "rocks", Type: "fill", SourceLayer: "rocks",
		Paint: map[string]interface{}{
			"fill-color": "#000000", "fill-opacity": 0.3, "fill-antialias": true,
		},
	}},
	"house": {{
		ID: "house", Type: "fill-extrusion", SourceLayer: "house",
		Paint: map[string]interface{}{
			"fill-extrusion-color":   []interface{}{"concat", "#", []interface{}{"get", "color"}},
			"fill-extrusion-opacity": []interface{}{"interpolate", []interface{}{"linear"}, []interface{}{"zoom"}, 16.0, 1.0, 18.0, 0.85},
			"fill-extrusion-height":  []interface{}{"get", "height"},
		},
	}},
	"powerline": {{
		ID: "powerline", Type: "line", SourceLayer: "powerline",
		Paint: map[string]interface{}{
			"line-color": "#000000", "line-opacity": 1.0, "line-width": 1.0,
		},
	}},
	"runway": {{
		ID: "runway", Type: "line", SourceLayer: "runway",
		Paint: map[string]interface{}{
			"line-color": "#808080", "line-opacity": 1.0, "line-width": 1.0,
		},
	}},
	"rock":        {makeTopoSymbol("rock", "objects/rock", 0.125, true)},
	"tree":        makeTreeCircleStyle("#5CA05C"),
	"fuelstation": {makeTopoSymbol("fuelstation", "objects/fuelstation", 0.125, false)},
	"transmitter": {makeTopoSymbol("transmitter", "objects/transmitter", 0.125, false)},
	"stack":       {makeTopoSymbol("stack", "objects/stack", 0.125, false)},
	"strongpointarea":   {makeTopoLabel("strongpointarea", "#406633")},
	"flatarea":          {makeTopoLabel("flatarea", "#406633")},
	"flatareacitysmall": {makeTopoLabel("flatareacitysmall", "#406633")},
	"mount": {{
		ID: "mount", Type: "symbol", SourceLayer: "mount",
		Layout: map[string]interface{}{
			"text-field":  []interface{}{"get", "text"},
			"text-font":   []interface{}{"OpenSans-Regular"},
			"text-anchor": "left",
			"text-size":   []interface{}{"interpolate", []interface{}{"linear"}, []interface{}{"zoom"}, 12.0, 5.0, 16.0, 20.0},
			"text-offset": []interface{}{1.0, 0.0},
		},
		Paint: topoTextPaint("#482c18"),
	}},
	"airport":          {makeTopoLabel("airport", "#406633")},
	"fortress":         {makeTopoLabel("fortress", "#406633")},
	"viewpoint":        {makeTopoLabel("viewpoint", "#C7000D")},
	"bordercrossing":   {makeTopoLabel("bordercrossing", "#C7000D")},
	"flag":             {makeTopoLabel("flag", "#406633")},
	"rockarea":         {makeTopoLabel("rockarea", "#406633")},
	"handdrawncamp":    {makeTopoLabel("handdrawncamp", "#406633")},
	"name":             {makeTopoLabel("name", "#000000")},
	"faketown":         {makeTopoLabel("faketown", "#000000")},
	"strategic":        {makeTopoLabel("strategic", "#406633")},
	"flatareacity":     {makeTopoLabel("flatareacity", "#406633")},
	"civildefense":     {makeTopoLabel("civildefense", "#406633")},
	"culturalproperty": {makeTopoLabel("culturalproperty", "#FFFFFF")},
	"dangerousforces":  {makeTopoLabel("dangerousforces", "#FFFFFF")},
	"safetyzone":       {makeTopoLabel("safetyzone", "#FFFFFF")},
	"power":            {makeTopoLabel("power", "#000000")},
	"citycenter":        {makeTopoLabel("citycenter", "#406633")},
	"namemarine":        {makeTopoLabel("namemarine", "#0D66CC")},
	"namelocal":         {makeTopoLabel("namelocal", "#70614D")},
	"namevillage":       {makeTopoLabel("namevillage", "#CCCCCC")},
	"namecity":          {makeTopoLabel("namecity", "#FFFFFF")},
	"namecitycapital":   {makeTopoLabel("namecitycapital", "#FFFFFF")},
}

// topoLayerOrder defines the bottom-to-top rendering order for the topo style.
var topoLayerOrder = []string{
	"sea",
	"contours05", "contours10", "contours50", "contours100",
	"contours",
	"track", "road",
	"main_road-bridge",
	"forest", "rocks",
	"house",
	"powerline", "runway",
	"rock", "tree",
	"fuelstation", "transmitter", "stack",
	"strongpointarea", "flatarea", "flatareacitysmall",
	"mount", "airport", "fortress", "viewpoint", "bordercrossing",
	"flag", "rockarea", "handdrawncamp",
	"name", "faketown", "strategic", "flatareacity",
	"civildefense", "culturalproperty", "dangerousforces", "safetyzone", "power",
	"citycenter",
	"namemarine", "namelocal", "namevillage", "namecity", "namecitycapital",
}

// knownTopoDarkLayerStyles maps layer names to their topo-dark-specific MapLibre styles.
var knownTopoDarkLayerStyles = map[string][]LayerStyle{
	// NOTE: "sea" is handled explicitly in buildTopoDarkLayers() as land/sea.
	"contours05": {{
		ID: "contours/05", Type: "line", SourceLayer: "contours05", MinZoom: 16,
		Paint: map[string]interface{}{
			"line-color": topoDarkContourColorExpr(), "line-opacity": 0.3, "line-width": 0.25,
		},
	}},
	"contours10": {{
		ID: "contours/10", Type: "line", SourceLayer: "contours10", MinZoom: 14,
		Paint: map[string]interface{}{
			"line-color": topoDarkContourColorExpr(), "line-opacity": 0.5, "line-width": 0.5,
		},
	}},
	"contours50": {{
		ID: "contours/50", Type: "line", SourceLayer: "contours50", MinZoom: 12,
		Paint: map[string]interface{}{
			"line-color": topoDarkContourColorExpr(), "line-opacity": seaContourOpacityExpr(0.7), "line-width": 1.0,
		},
	}, {
		ID: "contours/50-text", Type: "symbol", SourceLayer: "contours50", MinZoom: 14,
		Layout: map[string]interface{}{
			"symbol-placement": "line",
			"text-field":       []interface{}{"concat", []interface{}{"to-string", []interface{}{"get", "elevation"}}, "m"},
			"text-font":        []interface{}{"OpenSans-Regular"},
			"text-size":        14,
			"text-max-angle":   30,
		},
		Paint: map[string]interface{}{
			"text-color": topoDarkContourTextColorExpr(),
		},
	}},
	"contours100": {{
		ID: "contours/100", Type: "line", SourceLayer: "contours100", MinZoom: 8, MaxZoom: 12,
		Paint: map[string]interface{}{
			"line-color": topoDarkContourColorExpr(), "line-opacity": seaContourOpacityExpr(0.7), "line-width": 1.0,
		},
	}},
	"track": {{
		ID: "track", Type: "line", SourceLayer: "track",
		Paint: map[string]interface{}{
			"line-color": "#6b5a48", "line-opacity": 1.0, "line-width": roadWidthInterp(),
		},
	}},
	"road": {{
		ID: "road", Type: "line", SourceLayer: "road",
		Paint: map[string]interface{}{
			"line-color": "#888888", "line-opacity": 1.0, "line-width": roadWidthInterp(),
		},
	}},
	"main_road-bridge": {{
		ID: "main_road-bridge", Type: "fill-extrusion", SourceLayer: "main_road-bridge",
		Paint: map[string]interface{}{
			"fill-extrusion-color":   "#555555",
			"fill-extrusion-opacity": 1.0,
			"fill-extrusion-height":  []interface{}{"get", "height"},
		},
	}},
	"forest": {{
		ID: "forest", Type: "fill", SourceLayer: "forest",
		Paint: map[string]interface{}{
			"fill-color": "#3a5a2a", "fill-opacity": 0.4, "fill-antialias": true,
		},
	}},
	"rocks": {{
		ID: "rocks", Type: "fill", SourceLayer: "rocks",
		Paint: map[string]interface{}{
			"fill-color": "#333333", "fill-opacity": 0.4, "fill-antialias": true,
		},
	}},
	"house": {{
		ID: "house", Type: "fill-extrusion", SourceLayer: "house",
		Paint: map[string]interface{}{
			"fill-extrusion-color":   []interface{}{"concat", "#", []interface{}{"get", "color"}},
			"fill-extrusion-opacity": []interface{}{"interpolate", []interface{}{"linear"}, []interface{}{"zoom"}, 16.0, 1.0, 18.0, 0.85},
			"fill-extrusion-height":  []interface{}{"get", "height"},
		},
	}},
	"powerline": {{
		ID: "powerline", Type: "line", SourceLayer: "powerline",
		Paint: map[string]interface{}{
			"line-color": "#666666", "line-opacity": 1.0, "line-width": 1.0,
		},
	}},
	"runway": {{
		ID: "runway", Type: "line", SourceLayer: "runway",
		Paint: map[string]interface{}{
			"line-color": "#555555", "line-opacity": 1.0, "line-width": 1.0,
		},
	}},
	"rock":        {makeTopoSymbol("rock", "objects/rock", 0.125, true)},
	"tree":        makeTreeCircleStyle("#6BBF6B"),
	"fuelstation": {makeTopoSymbol("fuelstation", "objects/fuelstation", 0.125, false)},
	"transmitter": {makeTopoSymbol("transmitter", "objects/transmitter", 0.125, false)},
	"stack":       {makeTopoSymbol("stack", "objects/stack", 0.125, false)},
	"strongpointarea":   {makeTopoDarkLabel("strongpointarea", "#8a9a7a")},
	"flatarea":          {makeTopoDarkLabel("flatarea", "#8a9a7a")},
	"flatareacitysmall": {makeTopoDarkLabel("flatareacitysmall", "#8a9a7a")},
	"mount": {{
		ID: "mount", Type: "symbol", SourceLayer: "mount",
		Layout: map[string]interface{}{
			"text-field":  []interface{}{"get", "text"},
			"text-font":   []interface{}{"OpenSans-Regular"},
			"text-anchor": "left",
			"text-size":   []interface{}{"interpolate", []interface{}{"linear"}, []interface{}{"zoom"}, 12.0, 5.0, 16.0, 20.0},
			"text-offset": []interface{}{1.0, 0.0},
		},
		Paint: topoDarkTextPaint("#9a8a6a"),
	}},
	"airport":          {makeTopoDarkLabel("airport", "#8a9a7a")},
	"fortress":         {makeTopoDarkLabel("fortress", "#8a9a7a")},
	"viewpoint":        {makeTopoDarkLabel("viewpoint", "#aa4444")},
	"bordercrossing":   {makeTopoDarkLabel("bordercrossing", "#aa4444")},
	"flag":             {makeTopoDarkLabel("flag", "#8a9a7a")},
	"rockarea":         {makeTopoDarkLabel("rockarea", "#8a9a7a")},
	"handdrawncamp":    {makeTopoDarkLabel("handdrawncamp", "#8a9a7a")},
	"name":             {makeTopoDarkLabel("name", "#CCCCCC")},
	"faketown":         {makeTopoDarkLabel("faketown", "#CCCCCC")},
	"strategic":        {makeTopoDarkLabel("strategic", "#8a9a7a")},
	"flatareacity":     {makeTopoDarkLabel("flatareacity", "#8a9a7a")},
	"civildefense":     {makeTopoDarkLabel("civildefense", "#8a9a7a")},
	"culturalproperty": {makeTopoDarkLabel("culturalproperty", "#CCCCCC")},
	"dangerousforces":  {makeTopoDarkLabel("dangerousforces", "#CCCCCC")},
	"safetyzone":       {makeTopoDarkLabel("safetyzone", "#CCCCCC")},
	"power":            {makeTopoDarkLabel("power", "#CCCCCC")},
	"citycenter":        {makeTopoDarkLabel("citycenter", "#8a9a7a")},
	"namemarine":        {makeTopoDarkLabel("namemarine", "#5599DD")},
	"namelocal":         {makeTopoDarkLabel("namelocal", "#B8A88A")},
	"namevillage":       {makeTopoDarkLabel("namevillage", "#CCCCCC")},
	"namecity":          {makeTopoDarkLabel("namecity", "#FFFFFF")},
	"namecitycapital":   {makeTopoDarkLabel("namecitycapital", "#FFFFFF")},
}

// StyleVariant identifies which style variant to generate.
type StyleVariant string

const (
	StyleColorRelief StyleVariant = "color-relief"
	StyleTopo        StyleVariant = "topo"
	StyleTopoDark    StyleVariant = "topo-dark"
	StyleTopoRelief  StyleVariant = "topo-relief"
	StyleSatellite   StyleVariant = "satellite"
	StyleHybrid      StyleVariant = "hybrid"
)

// StyleConfig holds the parameters for generating a style document.
type StyleConfig struct {
	WorldName      string
	URLPrefix      string // e.g. "images/maps/stratis"
	SpritePrefix   string // e.g. "images/maps/stratis/styles" — directory containing sprite files
	VectorLayers   []string
	HasSatellite   bool
	HasHeightmap   bool
	HasHillshade     bool
	HasHillshadeFull bool
	HasColorRelief   bool
	GlyphsURL      string // template for font glyphs, e.g. "../../fonts/{fontstack}/{range}.pbf"
}


// GenerateStyleDocument creates a full MapLibre style JSON document for the given variant.
func GenerateStyleDocument(cfg StyleConfig, variant StyleVariant) map[string]interface{} {
	sources := buildSources(cfg)

	bgColor := "#000000"
	switch variant {
	case StyleTopo:
		bgColor = landColor
	case StyleTopoDark:
		bgColor = "#1B1B1B"
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
	case StyleTopoDark:
		layers = append(layers, buildTopoDarkLayers(cfg)...)
	case StyleTopoRelief:
		layers = append(layers, buildTopoReliefLayers(cfg)...)
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
		"sprite":  assetPath(cfg.SpritePrefix, "sprite"),
		"glyphs":  cfg.GlyphsURL,
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

	if cfg.HasHillshadeFull {
		sources["hillshade-full"] = map[string]interface{}{
			"type":     "raster",
			"url":      "pmtiles://" + assetPath(prefix, "hillshade-full.pmtiles"),
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

	// Vector feature layers (no land fill — color-relief raster covers it)
	layers = append(layers, buildVectorFeatureLayers(cfg.VectorLayers, layerVisColorRelief)...)

	return layers
}

// --- Topo style layers (native hillshade, topo-specific vector styles) ---

// hasVectorLayer checks if a layer name is present in the list.
func hasVectorLayer(layers []string, name string) bool {
	for _, l := range layers {
		if l == name {
			return true
		}
	}
	return false
}

// buildLandSeaLayers returns fill layers for land and sea polygons from the
// "sea" vector source layer, filtered by ELEV_MAX. Used by topo and topo-dark.
func buildLandSeaLayers(landColor, seaColor string) []interface{} {
	return []interface{}{
		map[string]interface{}{
			"id": "land", "type": "fill", "source": "features", "source-layer": "sea",
			"filter": []interface{}{">", []interface{}{"get", "ELEV_MAX"}, 0.0},
			"paint":  map[string]interface{}{"fill-color": landColor, "fill-opacity": 0.8, "fill-antialias": true},
		},
		map[string]interface{}{
			"id": "sea", "type": "fill", "source": "features", "source-layer": "sea",
			"filter": []interface{}{"<=", []interface{}{"get", "ELEV_MAX"}, 0.0},
			"paint":  map[string]interface{}{"fill-color": seaColor, "fill-opacity": 0.8, "fill-antialias": true},
		},
	}
}

func buildTopoLayers(cfg StyleConfig) []interface{} {
	var layers []interface{}

	// Land/sea fills — rendered immediately after background so everything
	// else draws on top. Land provides the base terrain color; sea fills oceans.
	if hasVectorLayer(cfg.VectorLayers, "sea") {
		layers = append(layers, buildLandSeaLayers(landColor, arma3SeaColor)...)
	}

	// Satellite (hidden by default, allows layer toggle in UI)
	if cfg.HasSatellite {
		layers = append(layers, map[string]interface{}{
			"id": "satellite", "type": "raster", "source": "satellite",
			"layout": map[string]interface{}{"visibility": "none"},
			"paint":  map[string]interface{}{"raster-opacity": 1.0},
		})
	}

	// Native hillshade from heightmap DEM
	if cfg.HasHeightmap {
		layers = append(layers, map[string]interface{}{
			"id":     "hillshade",
			"type":   "hillshade",
			"source": "heightmap",
			"paint": map[string]interface{}{
				"hillshade-exaggeration":           0.4,
				"hillshade-highlight-color":        "rgba(255,255,255,0.4)",
				"hillshade-shadow-color":           "rgba(0,0,0,0.4)",
				"hillshade-accent-color":           "rgba(0,0,0.2,0.4)",
				"hillshade-illumination-anchor":    "map",
				"hillshade-illumination-direction": 270.0,
			},
		})
	}

	// Vector feature layers in topo render order
	layers = append(layers, buildTopoVectorFeatureLayers(cfg.VectorLayers)...)

	return layers
}

// buildTopoVectorFeatureLayers generates topo-styled MapLibre layers from available
// vector layer names, using topo-specific styles and render order.
func buildTopoVectorFeatureLayers(layerNames []string) []interface{} {
	return buildOrderedVectorLayers(layerNames, knownTopoLayerStyles)
}

// buildTopoDarkVectorFeatureLayers generates dark-themed topo MapLibre layers,
// reusing topoLayerOrder for render order.
func buildTopoDarkVectorFeatureLayers(layerNames []string) []interface{} {
	return buildOrderedVectorLayers(layerNames, knownTopoDarkLayerStyles)
}

// buildOrderedVectorLayers generates MapLibre layers from available vector layer
// names using the given style map and topoLayerOrder for render order. Layers not
// in the style map fall back to standard styles.
func buildOrderedVectorLayers(layerNames []string, styleMap map[string][]LayerStyle) []interface{} {
	available := make(map[string]bool, len(layerNames))
	for _, n := range layerNames {
		available[n] = true
	}

	emitted := make(map[string]bool)
	var result []interface{}

	// Emit layers in topo render order
	for _, name := range topoLayerOrder {
		if !available[name] {
			continue
		}
		emitted[name] = true
		styles, ok := styleMap[name]
		if !ok {
			continue
		}
		for _, style := range styles {
			result = append(result, layerStyleToMap(style))
		}
	}

	// Fallback: remaining layers not in topo order use standard styles
	for _, name := range layerNames {
		if emitted[name] {
			continue
		}
		for _, style := range GetLayerStyles(name) {
			result = append(result, layerStyleToMap(style))
		}
	}

	return result
}

// layerStyleToMap converts a LayerStyle to a MapLibre layer map.
func layerStyleToMap(style LayerStyle) map[string]interface{} {
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
	if style.Paint != nil {
		layer["paint"] = style.Paint
	}
	if style.Layout != nil {
		layer["layout"] = style.Layout
	}
	if style.Filter != nil {
		layer["filter"] = style.Filter
	}
	return layer
}

// --- Topo Dark style layers ---

func buildTopoDarkLayers(cfg StyleConfig) []interface{} {
	var layers []interface{}

	// Land/sea fills — dark variants
	if hasVectorLayer(cfg.VectorLayers, "sea") {
		layers = append(layers, buildLandSeaLayers(landColorDark, arma3SeaColorDark)...)
	}

	// Satellite (hidden by default, allows layer toggle in UI)
	if cfg.HasSatellite {
		layers = append(layers, map[string]interface{}{
			"id": "satellite", "type": "raster", "source": "satellite",
			"layout": map[string]interface{}{"visibility": "none"},
			"paint":  map[string]interface{}{"raster-opacity": 1.0},
		})
	}

	// Native hillshade from heightmap DEM — stronger for dark theme
	if cfg.HasHeightmap {
		layers = append(layers, map[string]interface{}{
			"id":     "hillshade",
			"type":   "hillshade",
			"source": "heightmap",
			"paint": map[string]interface{}{
				"hillshade-exaggeration":           0.5,
				"hillshade-highlight-color":        "rgba(255,255,255,0.3)",
				"hillshade-shadow-color":           "rgba(0,0,0,0.6)",
				"hillshade-accent-color":           "rgba(0,0,0.2,0.4)",
				"hillshade-illumination-anchor":    "map",
				"hillshade-illumination-direction": 270.0,
			},
		})
	}

	// Vector feature layers in topo render order with dark styles
	layers = append(layers, buildTopoDarkVectorFeatureLayers(cfg.VectorLayers)...)

	return layers
}

// --- Topo Relief style layers (color-relief base + topo vector overlays) ---

func buildTopoReliefLayers(cfg StyleConfig) []interface{} {
	var layers []interface{}

	// Land/sea fills — hillshade only covers land, so sea stays opaque
	if hasVectorLayer(cfg.VectorLayers, "sea") {
		layers = append(layers, buildLandSeaLayers(landColor, arma3SeaColor)...)
	}

	// Hillshade at 50% opacity for 3D depth — prefer full (land+underwater), fall back to land-only
	var hillshadeSource string
	if cfg.HasHillshadeFull {
		hillshadeSource = "hillshade-full"
	} else if cfg.HasHillshade {
		hillshadeSource = "hillshade"
	}
	if hillshadeSource != "" {
		layers = append(layers, map[string]interface{}{
			"id":     "hillshade-raster",
			"type":   "raster",
			"source": hillshadeSource,
			"paint":  map[string]interface{}{"raster-opacity": 0.5},
		})
	}

	// Vector feature layers in topo render order with topo styles
	layers = append(layers, buildTopoVectorFeatureLayers(cfg.VectorLayers)...)

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
	seaOpacity  float64 // override sea opacity (0 = use default)
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

var layerVisColorRelief = layerVisibility{
	seaLand: false, seaWater: true,
	forest: true, rocks: true, roads: true, buildings: true,
	contours: true, labels: true, icons: true,
	bridges: true, railway: true, powerline: true, vegetation: false,
}

var layerVisStandard = layerVisibility{
	seaLand: true, seaWater: true,
	forest: true, rocks: true, roads: true, buildings: true,
	contours: true, labels: true, icons: true,
	bridges: true, railway: true, powerline: true, vegetation: false,
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
	bridges: true, railway: true, powerline: true, vegetation: false,
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
	case "tree":
		return "vegetation"
	case "hill", "namemarine", "namelocal", "namevillage", "namecity",
		"namecitycapital", "citycenter",
		"mount", "airport", "name", "faketown", "strategic",
		"flatareacity", "flatareacitysmall", "strongpointarea",
		"civildefense", "culturalproperty", "dangerousforces", "safetyzone",
		"fortress", "viewpoint", "bordercrossing", "flag", "rockarea",
		"handdrawncamp", "power":
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
				if style.ID == "land" && !vis.seaLand {
					continue
				}
				if style.ID == "sea" {
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
