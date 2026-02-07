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
	img, manifest := GenerateSprite(false)

	assert.Len(t, manifest, len(spriteIcons), "manifest should have one entry per icon")

	cols := spriteColumns
	rows := (len(spriteIcons) + cols - 1) / cols
	assert.Equal(t, cols*64, img.Bounds().Dx(), "width")
	assert.Equal(t, rows*64, img.Bounds().Dy(), "height")

	for _, entry := range manifest {
		assert.Equal(t, 64, entry.Width)
		assert.Equal(t, 64, entry.Height)
		assert.Equal(t, 1, entry.PixelRatio)
	}
}

func TestGenerateSprite_Blacken(t *testing.T) {
	img, manifest := GenerateSprite(true)
	pix := img.Pix
	stride := img.Stride

	for _, icon := range spriteIcons {
		if !icon.Blacken {
			continue
		}
		entry := manifest[icon.Name]
		// Check every pixel in this icon's region is black (RGB=0)
		for py := entry.Y; py < entry.Y+entry.Height; py++ {
			off := py*stride + entry.X*4
			for px := 0; px < entry.Width; px++ {
				assert.Equal(t, uint8(0), pix[off+0], "R should be 0 for %s at (%d,%d)", icon.Name, px, py)
				assert.Equal(t, uint8(0), pix[off+1], "G should be 0 for %s at (%d,%d)", icon.Name, px, py)
				assert.Equal(t, uint8(0), pix[off+2], "B should be 0 for %s at (%d,%d)", icon.Name, px, py)
				off += 4
			}
		}
	}
}

func TestWriteSpriteFiles(t *testing.T) {
	dir := t.TempDir()
	err := WriteSpriteFiles(dir)
	require.NoError(t, err)

	expectedFiles := []string{
		"sprite.json", "sprite.png",
		"sprite-dark.json", "sprite-dark.png",
	}
	for _, name := range expectedFiles {
		path := filepath.Join(dir, name)
		info, err := os.Stat(path)
		require.NoError(t, err, "file %s should exist", name)
		assert.Greater(t, info.Size(), int64(0), "file %s should not be empty", name)
	}

	// Verify JSON parses correctly
	for _, name := range []string{"sprite.json", "sprite-dark.json"} {
		data, err := os.ReadFile(filepath.Join(dir, name))
		require.NoError(t, err)
		var manifest map[string]spriteEntry
		require.NoError(t, json.Unmarshal(data, &manifest), "%s should be valid JSON", name)
		assert.Len(t, manifest, len(spriteIcons))
	}

	// Verify PNG decodes correctly
	for _, name := range []string{"sprite.png", "sprite-dark.png"} {
		f, err := os.Open(filepath.Join(dir, name))
		require.NoError(t, err)
		defer f.Close()
		_, err = png.Decode(f)
		require.NoError(t, err, "%s should be valid PNG", name)
	}
}

func TestSpriteIconNamesMatchStyles(t *testing.T) {
	// Collect all icon-image values referenced across all style maps
	styleIcons := make(map[string]bool)
	for _, styleMap := range []map[string][]LayerStyle{knownLayerStyles, knownTopoLayerStyles, knownTopoDarkLayerStyles} {
		for _, styles := range styleMap {
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
	}

	// Sprite icons that exist but are intentionally not styled
	unusedSpriteIcons := map[string]bool{
		"objects/bush":                 true,
		"objects/tree":                 true,
		"locations/vegetationbroadleaf": true,
		"locations/vegetationfir":       true,
		"locations/vegetationpalm":      true,
		"locations/vegetationvineyard":  true,
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

	// Every sprite icon should be referenced by at least one style (unless intentionally unused)
	for name := range spriteNames {
		if unusedSpriteIcons[name] {
			continue
		}
		assert.True(t, styleIcons[name], "sprite icon %q not referenced by any style", name)
	}
}
