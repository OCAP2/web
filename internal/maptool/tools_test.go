package maptool

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestDetectTools(t *testing.T) {
	tools := DetectTools()

	// Should always return a result for each known tool
	assert.Len(t, tools, 10)

	expectedNames := []string{
		"pmtiles", "tippecanoe",
		"gdal_translate", "gdaldem", "gdal_contour", "gdal_calc.py",
		"gdaladdo", "gdalbuildvrt", "tile-join", "gdal_fillnodata.py",
	}
	for i, tool := range tools {
		assert.NotEmpty(t, tool.Name)
		assert.Equal(t, expectedNames[i], tool.Name)
		// If a tool is found, it must have a path
		if tool.Found {
			assert.NotEmpty(t, tool.Path, "found tool %q should have a path", tool.Name)
		}
	}
}

func TestToolSet_FindTool(t *testing.T) {
	tools := ToolSet{
		{Name: "pmtiles", Required: true, Found: true, Path: "/usr/bin/pmtiles"},
		{Name: "gdal_translate", Required: false, Found: false},
	}

	tool, found := tools.FindTool("pmtiles")
	assert.True(t, found)
	assert.Equal(t, "/usr/bin/pmtiles", tool.Path)

	_, found = tools.FindTool("gdal_translate")
	assert.False(t, found)

	_, found = tools.FindTool("nonexistent")
	assert.False(t, found)
}

func TestToolStatus_MissingRequired(t *testing.T) {
	tools := ToolSet{
		{Name: "tippecanoe", Required: true, Found: false},
		{Name: "pmtiles", Required: true, Found: true, Path: "/usr/bin/pmtiles"},
	}

	missing := tools.MissingRequired()
	assert.Len(t, missing, 1)
	assert.Equal(t, "tippecanoe", missing[0].Name)
}
