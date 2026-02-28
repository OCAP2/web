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

func TestChainSegments_BackwardExtension(t *testing.T) {
	// Segments provided in reverse order to exercise backward extension
	// Chain: (30,30)→(20,20) then (10,10)→(20,20) — second segment connects at start
	segs := [][2][2]float64{
		{{20, 20}, {30, 30}},
		{{10, 10}, {20, 20}},
	}
	result := chainSegments(segs)
	require.Len(t, result, 1)
	assert.Len(t, result[0], 3)
}

func TestChainSegments_DisjointSegments(t *testing.T) {
	// Two segments that don't share endpoints → two polylines
	segs := [][2][2]float64{
		{{0, 0}, {10, 10}},
		{{100, 100}, {200, 200}},
	}
	result := chainSegments(segs)
	assert.Len(t, result, 2)
}

func TestMarchingSquares_SaddleCase5_AvgAbove(t *testing.T) {
	// Case 5: bl and tr above level (bits 0+2). Average >= level → specific segment pair.
	// Cell corners: bl=20, br=0, tr=20, tl=0. avg=(20+0+20+0)/4=10 >= 10
	grid := []float32{
		20, 0, // row 0 (south): bl=20, br=0
		0, 20, // row 1 (north): tl=0, tr=20
	}
	lines := marchingSquares(grid, 2, 2, 10.0, 0, 0, 10)
	assert.NotEmpty(t, lines, "saddle case 5 avg>=level should produce segments")
}

func TestMarchingSquares_SaddleCase5_AvgBelow(t *testing.T) {
	// Case 5: bl and tr above level, but avg < level → else branch.
	// Cell corners: bl=11, br=0, tr=11, tl=0. avg=(11+0+11+0)/4=5.5 < 10
	grid := []float32{
		11, 0, // row 0 (south): bl=11, br=0
		0, 11, // row 1 (north): tl=0, tr=11
	}
	lines := marchingSquares(grid, 2, 2, 10.0, 0, 0, 10)
	assert.NotEmpty(t, lines, "saddle case 5 avg<level should produce segments")
}

func TestMarchingSquares_SaddleCase10_AvgAbove(t *testing.T) {
	// Case 10: br and tl above level (bits 1+3). Average >= level.
	// Cell corners: bl=0, br=20, tr=0, tl=20. avg=(0+20+0+20)/4=10 >= 10
	grid := []float32{
		0, 20, // row 0 (south): bl=0, br=20
		20, 0, // row 1 (north): tl=20, tr=0
	}
	lines := marchingSquares(grid, 2, 2, 10.0, 0, 0, 10)
	assert.NotEmpty(t, lines, "saddle case 10 avg>=level should produce segments")
}

func TestMarchingSquares_SaddleCase10_AvgBelow(t *testing.T) {
	// Case 10: br and tl above level, but avg < level → else branch.
	// Cell corners: bl=0, br=11, tr=0, tl=11. avg=(0+11+0+11)/4=5.5 < 10
	grid := []float32{
		0, 11, // row 0 (south): bl=0, br=11
		11, 0, // row 1 (north): tl=11, tr=0
	}
	lines := marchingSquares(grid, 2, 2, 10.0, 0, 0, 10)
	assert.NotEmpty(t, lines, "saddle case 10 avg<level should produce segments")
}

func TestMarchingSquares_AllCases(t *testing.T) {
	// Large grid with enough variation to hit all 14 non-trivial cases
	grid := []float32{
		0, 20, 20, 0, 20, // row 0 (south)
		20, 0, 20, 20, 0, // row 1
		20, 20, 0, 0, 20, // row 2
		0, 20, 0, 20, 0,  // row 3
		20, 0, 20, 0, 20, // row 4 (north)
	}
	lines := marchingSquares(grid, 5, 5, 10.0, 0, 0, 10)
	assert.NotEmpty(t, lines, "diverse grid should produce contour segments")
	// Should produce multiple polylines
	totalPoints := 0
	for _, line := range lines {
		totalPoints += len(line)
	}
	assert.Greater(t, totalPoints, 4, "should have many contour points")
}

func TestGenerateContours_ShortLines(t *testing.T) {
	// Test that very small grids can produce single-point "lines" that get filtered
	// GenerateContours skips lines with len < 2
	grid := []float32{
		0, 0, 0,
		0, 100, 0,
		0, 0, 0,
	}
	features := GenerateContours(grid, 3, 3, 10.0, 0, 0, 50, 10)
	// All features should have at least 2 coordinates
	for _, f := range features {
		coords := f.Geometry.Coordinates.([][2]float64)
		assert.GreaterOrEqual(t, len(coords), 2)
	}
}

func TestGenerateContours_WithOriginOffset(t *testing.T) {
	grid := []float32{
		0, 0, 0,
		0, 100, 0,
		0, 0, 0,
	}
	features := GenerateContours(grid, 3, 3, 10.0, 100, 200, 50, 10)
	require.NotEmpty(t, features)
	// Coordinates should be offset by origin / metersPerDegree
	for _, f := range features {
		coords := f.Geometry.Coordinates.([][2]float64)
		for _, c := range coords {
			assert.Greater(t, c[0], 0.0, "x should be positive with origin offset")
			assert.Greater(t, c[1], 0.0, "y should be positive with origin offset")
		}
	}
}
