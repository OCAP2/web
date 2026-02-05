package maptool

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestBuildGdal2tilesArgs(t *testing.T) {
	args := buildGdal2tilesArgs("/tmp/sat.tiff", "/tmp/tiles", 6)
	assert.Contains(t, args, "--profile=raster")
	assert.Contains(t, args, "-z")
	assert.Contains(t, args, "0-6")
	assert.Contains(t, args, "/tmp/sat.tiff")
	assert.Contains(t, args, "/tmp/tiles")
}

func TestBuildPmtilesConvertArgs(t *testing.T) {
	args := buildPmtilesConvertArgs("/tmp/tiles", "/output/topo.pmtiles")
	assert.Equal(t, []string{"convert", "/tmp/tiles", "/output/topo.pmtiles"}, args)
}
