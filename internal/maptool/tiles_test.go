package maptool

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestMercatorZoomForWorld(t *testing.T) {
	tests := []struct {
		worldSize int
		imageSize int
		wantMin   int
		wantMax   int
	}{
		{30720, 30720, 10, 18},  // Altis: 0.276° → min z10, native z18
		{8192, 4096, 12, 17},    // Stratis: 0.074° → min z12, native z17
	}
	for _, tt := range tests {
		minZ, maxZ := MercatorZoomForWorld(tt.worldSize, tt.imageSize)
		assert.Equal(t, tt.wantMin, minZ, "MercatorZoomForWorld(%d, %d) minZoom", tt.worldSize, tt.imageSize)
		assert.Equal(t, tt.wantMax, maxZ, "MercatorZoomForWorld(%d, %d) maxZoom", tt.worldSize, tt.imageSize)
	}
}
