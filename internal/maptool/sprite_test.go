package maptool

import (
	"encoding/json"
	"image/png"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGenerateSprite(t *testing.T) {
	img, manifest := GenerateSprite(1)

	assert.Len(t, manifest, len(spriteIcons), "manifest should have one entry per icon")

	cols := spriteColumns
	rows := (len(spriteIcons) + cols - 1) / cols
	assert.Equal(t, cols*32, img.Bounds().Dx(), "1x width")
	assert.Equal(t, rows*32, img.Bounds().Dy(), "1x height")

	for _, entry := range manifest {
		assert.Equal(t, 32, entry.Width)
		assert.Equal(t, 32, entry.Height)
		assert.Equal(t, 1, entry.PixelRatio)
	}
}

func TestGenerateSprite_2x(t *testing.T) {
	img, manifest := GenerateSprite(2)

	cols := spriteColumns
	rows := (len(spriteIcons) + cols - 1) / cols
	assert.Equal(t, cols*64, img.Bounds().Dx(), "2x width")
	assert.Equal(t, rows*64, img.Bounds().Dy(), "2x height")

	for _, entry := range manifest {
		assert.Equal(t, 64, entry.Width)
		assert.Equal(t, 64, entry.Height)
		assert.Equal(t, 2, entry.PixelRatio)
	}
}

func TestWriteSpriteFiles(t *testing.T) {
	dir := t.TempDir()
	err := WriteSpriteFiles(dir)
	require.NoError(t, err)

	expectedFiles := []string{"sprite.json", "sprite.png", "sprite@2x.json", "sprite@2x.png"}
	for _, name := range expectedFiles {
		path := filepath.Join(dir, name)
		info, err := os.Stat(path)
		require.NoError(t, err, "file %s should exist", name)
		assert.Greater(t, info.Size(), int64(0), "file %s should not be empty", name)
	}

	// Verify JSON parses correctly
	for _, name := range []string{"sprite.json", "sprite@2x.json"} {
		data, err := os.ReadFile(filepath.Join(dir, name))
		require.NoError(t, err)
		var manifest map[string]spriteEntry
		require.NoError(t, json.Unmarshal(data, &manifest), "%s should be valid JSON", name)
		assert.Len(t, manifest, len(spriteIcons))
	}

	// Verify PNG decodes correctly
	for _, name := range []string{"sprite.png", "sprite@2x.png"} {
		f, err := os.Open(filepath.Join(dir, name))
		require.NoError(t, err)
		defer f.Close()
		_, err = png.Decode(f)
		require.NoError(t, err, "%s should be valid PNG", name)
	}
}

func TestSpriteIconNamesMatchStyles(t *testing.T) {
	// Collect all icon-image values referenced in knownLayerStyles
	styleIcons := make(map[string]bool)
	for _, styles := range knownLayerStyles {
		for _, s := range styles {
			if s.Layout == nil {
				continue
			}
			if iconImage, ok := s.Layout["icon-image"]; ok {
				if name, ok := iconImage.(string); ok {
					styleIcons[name] = true
				}
			}
		}
	}

	// Collect all sprite icon names
	spriteNames := make(map[string]bool, len(spriteIcons))
	for _, icon := range spriteIcons {
		spriteNames[icon.Name] = true
	}

	// Every icon referenced in styles must exist in the sprite
	for name := range styleIcons {
		assert.True(t, spriteNames[name], "icon %q referenced in styles but missing from sprite", name)
	}

	// Every sprite icon should be referenced by at least one style
	for name := range spriteNames {
		assert.True(t, styleIcons[name], "sprite icon %q not referenced by any style", name)
	}
}
