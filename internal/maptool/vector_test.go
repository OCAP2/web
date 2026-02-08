package maptool

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestColorArrayToHex(t *testing.T) {
	tests := []struct {
		name     string
		input    []interface{}
		expected string
	}{
		{"white", []interface{}{1.0, 1.0, 1.0}, "ffffff"},
		{"black", []interface{}{0.0, 0.0, 0.0}, "000000"},
		{"red", []interface{}{1.0, 0.0, 0.0}, "ff0000"},
		{"green", []interface{}{0.0, 1.0, 0.0}, "00ff00"},
		{"blue", []interface{}{0.0, 0.0, 1.0}, "0000ff"},
		{"mid gray", []interface{}{0.5, 0.5, 0.5}, "7f7f7f"},
		// 0-255 integer range (grad_meh exports)
		{"grad_meh gray", []interface{}{128.0, 121.0, 118.0}, "807976"},
		{"grad_meh white", []interface{}{255.0, 255.0, 255.0}, "ffffff"},
		{"grad_meh dark", []interface{}{110.0, 111.0, 111.0}, "6e6f6f"},
		{"too few elements", []interface{}{1.0, 0.5}, "888888"},
		{"empty", []interface{}{}, "888888"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, colorArrayToHex(tt.input))
		})
	}
}

func TestClampInt(t *testing.T) {
	tests := []struct {
		name     string
		input    float64
		expected int
	}{
		{"zero", 0.0, 0},
		{"255", 255.0, 255},
		{"mid", 127.0, 127},
		{"negative", -1.0, 0},
		{"overflow", 300.0, 255},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, clampInt(tt.input))
		})
	}
}

func TestToFloat64(t *testing.T) {
	f, ok := toFloat64(3.14)
	assert.True(t, ok)
	assert.InDelta(t, 3.14, f, 0.001)

	f, ok = toFloat64(42)
	assert.True(t, ok)
	assert.Equal(t, 42.0, f)

	f, ok = toFloat64(json.Number("7.5"))
	assert.True(t, ok)
	assert.Equal(t, 7.5, f)

	_, ok = toFloat64("not a number")
	assert.False(t, ok)

	_, ok = toFloat64(nil)
	assert.False(t, ok)
}

func TestTransformCoords_SinglePoint(t *testing.T) {
	// [x, y] coordinate pair
	coords := []interface{}{111320.0, 222640.0}
	result := transformCoords(coords).([]interface{})

	x, _ := toFloat64(result[0])
	y, _ := toFloat64(result[1])
	assert.InDelta(t, 1.0, x, 0.001)
	assert.InDelta(t, 2.0, y, 0.001)
}

func TestTransformCoords_PointWithAltitude(t *testing.T) {
	// [x, y, alt] — altitude should NOT be divided
	coords := []interface{}{111320.0, 111320.0, 100.0}
	result := transformCoords(coords).([]interface{})

	x, _ := toFloat64(result[0])
	y, _ := toFloat64(result[1])
	alt, _ := toFloat64(result[2])
	assert.InDelta(t, 1.0, x, 0.001)
	assert.InDelta(t, 1.0, y, 0.001)
	assert.Equal(t, 100.0, alt, "altitude should be preserved")
}

func TestTransformCoords_LineString(t *testing.T) {
	// Array of coordinate pairs
	coords := []interface{}{
		[]interface{}{111320.0, 0.0},
		[]interface{}{0.0, 111320.0},
	}
	result := transformCoords(coords).([]interface{})

	p0 := result[0].([]interface{})
	p1 := result[1].([]interface{})

	x0, _ := toFloat64(p0[0])
	y0, _ := toFloat64(p0[1])
	x1, _ := toFloat64(p1[0])
	y1, _ := toFloat64(p1[1])

	assert.InDelta(t, 1.0, x0, 0.001)
	assert.InDelta(t, 0.0, y0, 0.001)
	assert.InDelta(t, 0.0, x1, 0.001)
	assert.InDelta(t, 1.0, y1, 0.001)
}

func TestTransformCoords_Polygon(t *testing.T) {
	// Polygon: array of rings, each ring is array of coordinate pairs
	coords := []interface{}{
		[]interface{}{
			[]interface{}{0.0, 0.0},
			[]interface{}{111320.0, 0.0},
			[]interface{}{111320.0, 111320.0},
			[]interface{}{0.0, 0.0},
		},
	}
	result := transformCoords(coords).([]interface{})
	ring := result[0].([]interface{})

	assert.Len(t, ring, 4)
	p1 := ring[1].([]interface{})
	x, _ := toFloat64(p1[0])
	assert.InDelta(t, 1.0, x, 0.001)
}

func TestTransformCoords_Empty(t *testing.T) {
	coords := []interface{}{}
	result := transformCoords(coords).([]interface{})
	assert.Empty(t, result)
}

func TestTransformCoords_NonSlice(t *testing.T) {
	// Non-slice input returned as-is
	assert.Equal(t, "foo", transformCoords("foo"))
	assert.Equal(t, 42, transformCoords(42))
	assert.Nil(t, transformCoords(nil))
}
