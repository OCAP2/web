package maptool

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFindHillshadeTools_Empty(t *testing.T) {
	_, err := findHillshadeTools(ToolSet{})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "gdaldem not found")
}

func TestFindHillshadeTools_MissingGdalTranslate(t *testing.T) {
	tools := ToolSet{
		{Name: "gdaldem", Found: true, Path: "/usr/bin/gdaldem"},
	}
	_, err := findHillshadeTools(tools)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "gdal_translate not found")
}

func TestFindHillshadeTools_MissingPmtiles(t *testing.T) {
	tools := ToolSet{
		{Name: "gdaldem", Found: true, Path: "/usr/bin/gdaldem"},
		{Name: "gdal_translate", Found: true, Path: "/usr/bin/gdal_translate"},
	}
	_, err := findHillshadeTools(tools)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "pmtiles not found")
}

func TestFindHillshadeTools_AllPresent(t *testing.T) {
	tools := ToolSet{
		{Name: "gdaldem", Found: true, Path: "/usr/bin/gdaldem"},
		{Name: "gdal_translate", Found: true, Path: "/usr/bin/gdal_translate"},
		{Name: "pmtiles", Found: true, Path: "/usr/bin/pmtiles"},
	}
	ht, err := findHillshadeTools(tools)
	require.NoError(t, err)
	assert.Equal(t, "/usr/bin/gdaldem", ht.gdalDem)
	assert.Equal(t, "/usr/bin/gdal_translate", ht.gdalTranslate)
	assert.Equal(t, "/usr/bin/pmtiles", ht.pmtiles)
	assert.False(t, ht.hasAddo)
}

func TestFindHillshadeTools_WithAddo(t *testing.T) {
	tools := ToolSet{
		{Name: "gdaldem", Found: true, Path: "/usr/bin/gdaldem"},
		{Name: "gdal_translate", Found: true, Path: "/usr/bin/gdal_translate"},
		{Name: "pmtiles", Found: true, Path: "/usr/bin/pmtiles"},
		{Name: "gdaladdo", Found: true, Path: "/usr/bin/gdaladdo"},
	}
	ht, err := findHillshadeTools(tools)
	require.NoError(t, err)
	assert.True(t, ht.hasAddo)
	assert.Equal(t, "/usr/bin/gdaladdo", ht.gdalAddo)
}

func TestNewGenerateHillshadeStage_NoDEM(t *testing.T) {
	stage := NewGenerateHillshadeStage(ToolSet{})
	job := &Job{DEMPath: ""}
	err := stage.Run(context.Background(), job)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "DEM not available")
}

func TestNewGenerateBathymetryStage_NoDEM(t *testing.T) {
	stage := NewGenerateBathymetryStage(ToolSet{})
	job := &Job{DEMPath: ""}
	err := stage.Run(context.Background(), job)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "DEM not available")
}

func TestNewGenerateHeightmapStage_NoDEM(t *testing.T) {
	stage := NewGenerateHeightmapStage(ToolSet{})
	job := &Job{DEMGrid: nil, DEMPath: ""}
	err := stage.Run(context.Background(), job)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "DEM not available")
}

func TestNewGenerateColorReliefStage_NoDEM(t *testing.T) {
	stage := NewGenerateColorReliefStage(ToolSet{})
	job := &Job{DEMPath: ""}
	err := stage.Run(context.Background(), job)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "DEM not available")
}

func TestNewGenerateContoursStage_NoDEM(t *testing.T) {
	stage := NewGenerateContoursStage(ToolSet{})
	job := &Job{DEMPath: ""}
	err := stage.Run(context.Background(), job)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "DEM not available")
}

func TestNewGenerateContoursStage_NoTool(t *testing.T) {
	stage := NewGenerateContoursStage(ToolSet{})
	job := &Job{DEMPath: "/tmp/dem.tif"}
	err := stage.Run(context.Background(), job)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "gdal_contour not found")
}

func TestNewGenerateBathymetryStage_NoTools(t *testing.T) {
	stage := NewGenerateBathymetryStage(ToolSet{})
	job := &Job{DEMPath: "/tmp/dem.tif"}
	err := stage.Run(context.Background(), job)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "gdaldem not found")
}

func TestNewGenerateHillshadeStage_NoTools(t *testing.T) {
	stage := NewGenerateHillshadeStage(ToolSet{})
	job := &Job{DEMPath: "/tmp/dem.tif"}
	err := stage.Run(context.Background(), job)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "gdaldem not found")
}

func TestNewGenerateHeightmapStage_NoTools(t *testing.T) {
	stage := NewGenerateHeightmapStage(ToolSet{})
	job := &Job{DEMGrid: &DEMGrid{}, DEMPath: "/tmp/dem.tif"}
	err := stage.Run(context.Background(), job)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "gdal_translate not found")
}

func TestNewGenerateColorReliefStage_NoTools(t *testing.T) {
	stage := NewGenerateColorReliefStage(ToolSet{})
	job := &Job{DEMPath: "/tmp/dem.tif"}
	err := stage.Run(context.Background(), job)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "gdaldem not found")
}

func TestNewGenerateSatellitePMTilesStage_NoTools(t *testing.T) {
	stage := NewGenerateSatellitePMTilesStage(ToolSet{})
	job := &Job{}
	err := stage.Run(context.Background(), job)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "gdal_translate not found")
}

func TestNewGradMehVectorTilesStage_NoLayerFiles(t *testing.T) {
	stage := NewGradMehVectorTilesStage(ToolSet{})
	job := &Job{}
	err := stage.Run(context.Background(), job)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no layer files")
}

func TestNewGradMehVectorTilesStage_NoTools(t *testing.T) {
	stage := NewGradMehVectorTilesStage(ToolSet{})
	job := &Job{LayerFiles: []LayerFile{{Name: "test", Path: "/tmp/test.geojson"}}}
	err := stage.Run(context.Background(), job)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "tippecanoe not found")
}

func TestNewGradMehVectorTilesStage_MissingPmtiles(t *testing.T) {
	tools := ToolSet{
		{Name: "tippecanoe", Found: true, Path: "/usr/bin/tippecanoe"},
	}
	stage := NewGradMehVectorTilesStage(tools)
	job := &Job{LayerFiles: []LayerFile{{Name: "test", Path: "/tmp/test.geojson"}}}
	err := stage.Run(context.Background(), job)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "pmtiles not found")
}

func TestNewGradMehVectorTilesStage_MissingTileJoin(t *testing.T) {
	tools := ToolSet{
		{Name: "tippecanoe", Found: true, Path: "/usr/bin/tippecanoe"},
		{Name: "pmtiles", Found: true, Path: "/usr/bin/pmtiles"},
	}
	stage := NewGradMehVectorTilesStage(tools)
	job := &Job{LayerFiles: []LayerFile{{Name: "test", Path: "/tmp/test.geojson"}}}
	err := stage.Run(context.Background(), job)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "tile-join not found")
}

func TestNewGenerateColorReliefStage_MissingGdalTranslate(t *testing.T) {
	tools := ToolSet{
		{Name: "gdaldem", Found: true, Path: "/usr/bin/gdaldem"},
	}
	stage := NewGenerateColorReliefStage(tools)
	job := &Job{DEMPath: "/tmp/dem.tif"}
	err := stage.Run(context.Background(), job)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "gdal_translate not found")
}

func TestNewGenerateColorReliefStage_MissingPmtiles(t *testing.T) {
	tools := ToolSet{
		{Name: "gdaldem", Found: true, Path: "/usr/bin/gdaldem"},
		{Name: "gdal_translate", Found: true, Path: "/usr/bin/gdal_translate"},
	}
	stage := NewGenerateColorReliefStage(tools)
	job := &Job{DEMPath: "/tmp/dem.tif"}
	err := stage.Run(context.Background(), job)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "pmtiles not found")
}

func TestNewGenerateHeightmapStage_MissingPmtiles(t *testing.T) {
	tools := ToolSet{
		{Name: "gdal_translate", Found: true, Path: "/usr/bin/gdal_translate"},
	}
	stage := NewGenerateHeightmapStage(tools)
	job := &Job{DEMGrid: &DEMGrid{}, DEMPath: "/tmp/dem.tif"}
	err := stage.Run(context.Background(), job)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "pmtiles not found")
}

func TestNewGenerateSatellitePMTilesStage_MissingPmtiles(t *testing.T) {
	tools := ToolSet{
		{Name: "gdal_translate", Found: true, Path: "/usr/bin/gdal_translate"},
	}
	stage := NewGenerateSatellitePMTilesStage(tools)
	job := &Job{}
	err := stage.Run(context.Background(), job)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "pmtiles not found")
}

func TestNewPrepareDEMStage_NoDemFile(t *testing.T) {
	stage := NewPrepareDEMStage(ToolSet{})
	job := &Job{InputPath: t.TempDir(), TempDir: t.TempDir()}
	err := stage.Run(context.Background(), job)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "dem.asc.gz not found")
}

func TestNewGenerateHillshadeStage_MissingGdalbuildvrt(t *testing.T) {
	tools := ToolSet{
		{Name: "gdaldem", Found: true, Path: "/usr/bin/gdaldem"},
		{Name: "gdal_translate", Found: true, Path: "/usr/bin/gdal_translate"},
		{Name: "pmtiles", Found: true, Path: "/usr/bin/pmtiles"},
	}
	stage := NewGenerateHillshadeStage(tools)
	job := &Job{DEMPath: "/tmp/dem.tif"}
	err := stage.Run(context.Background(), job)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "gdalbuildvrt not found")
}
