package maptool

import (
	"testing"

	"github.com/stretchr/testify/assert"
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
