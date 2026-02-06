package maptool

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAssetPath(t *testing.T) {
	assert.Equal(t, "images/maps/altis/satellite.pmtiles", assetPath("images/maps/altis", "satellite.pmtiles"))
	assert.Equal(t, "satellite.pmtiles", assetPath("", "satellite.pmtiles"))
}

func TestComputeElevationStats_Normal(t *testing.T) {
	grid := &DEMGrid{
		Data: []float32{10, 20, 30, 40, 50},
	}
	stats := computeElevationStats(grid)
	require.NotNil(t, stats)
	assert.Equal(t, 10.0, stats.Min)
	assert.Equal(t, 50.0, stats.Max)
	assert.Equal(t, 30.0, stats.Avg)
	assert.Greater(t, stats.StdDev, 0.0)
}

func TestComputeElevationStats_SingleValue(t *testing.T) {
	grid := &DEMGrid{
		Data: []float32{42},
	}
	stats := computeElevationStats(grid)
	require.NotNil(t, stats)
	assert.Equal(t, 42.0, stats.Min)
	assert.Equal(t, 42.0, stats.Max)
	assert.Equal(t, 42.0, stats.Avg)
	assert.Equal(t, 0.0, stats.StdDev)
}

func TestComputeElevationStats_AllSame(t *testing.T) {
	grid := &DEMGrid{
		Data: []float32{5, 5, 5, 5},
	}
	stats := computeElevationStats(grid)
	require.NotNil(t, stats)
	assert.Equal(t, 5.0, stats.Min)
	assert.Equal(t, 5.0, stats.Max)
	assert.Equal(t, 5.0, stats.Avg)
	assert.Equal(t, 0.0, stats.StdDev)
}

func TestComputeElevationStats_NegativeElevation(t *testing.T) {
	grid := &DEMGrid{
		Data: []float32{-10, -5, 0, 5, 10},
	}
	stats := computeElevationStats(grid)
	require.NotNil(t, stats)
	assert.Equal(t, -10.0, stats.Min)
	assert.Equal(t, 10.0, stats.Max)
	assert.Equal(t, 0.0, stats.Avg)
}

func TestComputeElevationStats_Nil(t *testing.T) {
	assert.Nil(t, computeElevationStats(nil))
}

func TestComputeElevationStats_EmptyData(t *testing.T) {
	grid := &DEMGrid{Data: []float32{}}
	assert.Nil(t, computeElevationStats(grid))
}

func TestComputeElevationStats_RoundsToTwoDecimals(t *testing.T) {
	grid := &DEMGrid{
		Data: []float32{1.111, 2.222, 3.333},
	}
	stats := computeElevationStats(grid)
	require.NotNil(t, stats)
	assert.Equal(t, 1.11, stats.Min)
	assert.Equal(t, 3.33, stats.Max)
	assert.Equal(t, 2.22, stats.Avg)
}
