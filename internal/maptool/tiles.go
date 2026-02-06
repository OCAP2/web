package maptool

import "math"

// MercatorZoomForWorld calculates appropriate min and max web-mercator zoom levels
// for a georeferenced world placed at the equator in EPSG:4326.
//
// At zoom z, one 256px tile covers 360/2^z degrees.
// The world covers worldSize/metersPerDegree degrees.
//
// minZoom: smallest z where the world fills at least one tile.
// maxZoom: smallest z where tile resolution is at least as fine as the source image.
func MercatorZoomForWorld(worldSize, imageSize int) (minZoom, maxZoom int) {
	worldDeg := float64(worldSize) / metersPerDegree
	// minZoom: 360/2^z ≤ worldDeg → z = floor(log2(360/worldDeg))
	minZoom = int(math.Floor(math.Log2(360.0 / worldDeg)))
	// maxZoom: tile pixel size ≤ source pixel size
	// 360/(2^z * 256) ≤ worldDeg/imageSize → z = ceil(log2(360*imageSize/(256*worldDeg)))
	maxZoom = int(math.Ceil(math.Log2(360.0 * float64(imageSize) / (256.0 * worldDeg))))
	return minZoom, maxZoom
}
