package maptool

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestDetectTools(t *testing.T) {
	tools := DetectTools()

	// Should always return a result for each known tool
	assert.Len(t, tools, 4)

	expectedNames := []string{"depbo", "gdal2tiles.py", "pmtiles", "tippecanoe"}
	for i, tool := range tools {
		assert.NotEmpty(t, tool.Name)
		assert.Equal(t, expectedNames[i], tool.Name)
		// If a tool is found, it must have a path
		if tool.Found {
			assert.NotEmpty(t, tool.Path, "found tool %q should have a path", tool.Name)
		}
	}
}

func TestToolStatus_MissingRequired(t *testing.T) {
	tools := ToolSet{
		{Name: "depbo", Required: true, Found: false},
		{Name: "pmtiles", Required: true, Found: true, Path: "/usr/bin/pmtiles"},
	}

	missing := tools.MissingRequired()
	assert.Len(t, missing, 1)
	assert.Equal(t, "depbo", missing[0].Name)
}
