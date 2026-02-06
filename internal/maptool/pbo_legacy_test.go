package maptool

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestWorldNameFromPBO(t *testing.T) {
	tests := []struct {
		path     string
		expected string
	}{
		{"/path/to/altis.pbo", "altis"},
		{"/path/to/map_altis.pbo", "altis"},
		{"stratis.pbo", "stratis"},
		{"/path/to/A3_map_tanoa.pbo", "tanoa"},
		{"/path/to/a3_map_livonia.pbo", "livonia"},
		{"MyCustomIsland.pbo", "mycustomisland"},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			result := WorldNameFromPBO(tt.path)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestFindWRP_Found(t *testing.T) {
	dir := t.TempDir()
	// Create a nested directory with a .wrp file
	subdir := filepath.Join(dir, "addons", "data")
	require.NoError(t, os.MkdirAll(subdir, 0755))
	wrpFile := filepath.Join(subdir, "altis.wrp")
	require.NoError(t, os.WriteFile(wrpFile, []byte("fake wrp"), 0644))

	found, err := FindWRP(dir)
	require.NoError(t, err)
	assert.Equal(t, wrpFile, found)
}

func TestFindWRP_NotFound(t *testing.T) {
	dir := t.TempDir()
	_, err := FindWRP(dir)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "no .wrp file found")
}
