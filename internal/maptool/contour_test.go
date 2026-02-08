package maptool

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGenerateContours_Simple(t *testing.T) {
	// 3×3 grid with a hill in the center
	// Row 0 (south), Row 2 (north)
	grid := []float32{
		0, 0, 0,
		0, 100, 0,
		0, 0, 0,
	}
	features := GenerateContours(grid, 3, 3, 10.0, 0, 0, 50, 10)
	require.NotEmpty(t, features)

	// Should have contours at 10, 20, ..., 90 (minor) and 50 (major)
	var majorCount, minorCount int
	for _, f := range features {
		switch f.Properties["type"] {
		case "major":
			majorCount++
		case "minor":
			minorCount++
		}
	}
	assert.Greater(t, majorCount, 0, "should have major contours")
	assert.Greater(t, minorCount, 0, "should have minor contours")
}

func TestGenerateContours_Flat(t *testing.T) {
	// Flat terrain at 50m — no contour lines expected (single elevation)
	grid := make([]float32, 16)
	for i := range grid {
		grid[i] = 50
	}
	features := GenerateContours(grid, 4, 4, 10.0, 0, 0, 50, 10)
	assert.Empty(t, features)
}

func TestGenerateContours_WrongSize(t *testing.T) {
	grid := []float32{1, 2, 3}
	features := GenerateContours(grid, 2, 2, 10.0, 0, 0, 50, 10)
	assert.Nil(t, features)
}

func TestGenerateContours_BelowSeaLevel(t *testing.T) {
	// All below sea level — no contours
	grid := []float32{
		-10, -5,
		-8, -3,
	}
	features := GenerateContours(grid, 2, 2, 10.0, 0, 0, 50, 10)
	assert.Empty(t, features)
}

func TestMarchingSquares_SingleContour(t *testing.T) {
	// 2×2 grid: bottom-left at 0, others at 20
	// Should produce one contour at level 10
	grid := []float32{
		0, 20,
		20, 20,
	}
	lines := marchingSquares(grid, 2, 2, 10.0, 0, 0, 10)
	require.NotEmpty(t, lines)
	// Should have at least one polyline
	assert.GreaterOrEqual(t, len(lines), 1)
	// Each polyline should have at least 2 points
	for _, line := range lines {
		assert.GreaterOrEqual(t, len(line), 2)
	}
}

func TestChainSegments_Empty(t *testing.T) {
	result := chainSegments(nil)
	assert.Nil(t, result)
}

func TestChainSegments_SingleSegment(t *testing.T) {
	segs := [][2][2]float64{
		{{0, 0}, {10, 10}},
	}
	result := chainSegments(segs)
	require.Len(t, result, 1)
	assert.Len(t, result[0], 2)
}

func TestChainSegments_ConnectedSegments(t *testing.T) {
	// Three segments forming a chain: (0,0)→(10,10)→(20,20)→(30,30)
	segs := [][2][2]float64{
		{{0, 0}, {10, 10}},
		{{10, 10}, {20, 20}},
		{{20, 20}, {30, 30}},
	}
	result := chainSegments(segs)
	require.Len(t, result, 1)
	assert.Len(t, result[0], 4)
}
