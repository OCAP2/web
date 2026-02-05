package maptool

import (
	"encoding/json"
	"fmt"
	"os"
)

// GeoJSON types for writing feature collections.

type FeatureCollection struct {
	Type     string    `json:"type"`
	Features []Feature `json:"features"`
}

type Feature struct {
	Type       string                 `json:"type"`
	Geometry   Geometry               `json:"geometry"`
	Properties map[string]interface{} `json:"properties"`
}

type Geometry struct {
	Type        string      `json:"type"`
	Coordinates interface{} `json:"coordinates"`
}

// armaToGeoJSON converts Arma world coordinates (x=east, z=north) to GeoJSON [lon, lat].
func armaToGeoJSON(x, z float64) [2]float64 {
	return [2]float64{
		x / float64(metersPerDegree), // longitude
		z / float64(metersPerDegree), // latitude
	}
}

// WriteGeoJSON writes a FeatureCollection to a file.
func WriteGeoJSON(path string, fc FeatureCollection) error {
	data, err := json.Marshal(fc)
	if err != nil {
		return fmt.Errorf("marshal geojson: %w", err)
	}
	if err := os.WriteFile(path, data, 0644); err != nil {
		return fmt.Errorf("write geojson: %w", err)
	}
	return nil
}
