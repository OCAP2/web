package maptool

import (
	"bytes"
	"embed"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"sort"

	xdraw "golang.org/x/image/draw"
)

//go:embed icons/*.png
var iconFS embed.FS

// spriteIcon defines a single icon in the sprite sheet.
type spriteIcon struct {
	Name    string // MapLibre icon name, e.g. "objects/tree"
	File    string // embedded filename, e.g. "tree.png"
	Blacken bool   // true for simple white icons that should be inverted for light themes
}

// spriteIcons lists all icons referenced by knownLayerStyles, sorted by name.
// Blacken=true for pure-white single-shape icons; false for detailed grayscale icons
// that have shading/structure which would be lost if blackened.
var spriteIcons = func() []spriteIcon {
	icons := []spriteIcon{
		// Objects (MapControl) — simple white shapes
		{"objects/bunker", "bunker.png", true},
		{"objects/bush", "bush.png", true},
		{"objects/chapel", "chapel.png", true},
		{"objects/cross", "cross.png", true},
		{"objects/fountain", "fountain.png", true},
		{"objects/rock", "rock.png", true},
		{"objects/ruin", "ruin.png", true},
		{"objects/shipwreck", "shipwreck.png", true},
		{"objects/stack", "stack.png", true},
		{"objects/tourism", "tourism.png", true},
		{"objects/tree", "tree.png", true},
		{"objects/viewtower", "viewtower.png", true},

		// Objects (MapControl) — detailed grayscale icons
		{"objects/church", "church.png", false},
		{"objects/fuelstation", "fuelstation.png", false},
		{"objects/hospital", "hospital.png", false},
		{"objects/lighthouse", "lighthouse.png", false},
		{"objects/powersolar", "powersolar.png", false},
		{"objects/powerwave", "powerwave.png", false},
		{"objects/powerwind", "powerwind.png", false},
		{"objects/quay", "quay.png", false},
		{"objects/transmitter", "transmitter.png", false},
		{"objects/watertower", "watertower.png", false},

		// Locations (LocationTypes) — simple white shapes
		{"locations/hill", "hill.png", true},
		{"locations/vegetationbroadleaf", "vegetationbroadleaf.png", true},
		{"locations/vegetationfir", "vegetationfir.png", true},
		{"locations/vegetationpalm", "vegetationpalm.png", true},
		{"locations/vegetationvineyard", "vegetationvineyard.png", true},
	}
	sort.Slice(icons, func(i, j int) bool { return icons[i].Name < icons[j].Name })
	return icons
}()

const spriteColumns = 6

// spriteEntry is a single entry in the sprite JSON manifest.
type spriteEntry struct {
	X          int `json:"x"`
	Y          int `json:"y"`
	Width      int `json:"width"`
	Height     int `json:"height"`
	PixelRatio int `json:"pixelRatio"`
}

// loadIcon loads and decodes an embedded PNG icon.
func loadIcon(filename string) (image.Image, error) {
	data, err := iconFS.ReadFile("icons/" + filename)
	if err != nil {
		return nil, fmt.Errorf("read embedded icon %s: %w", filename, err)
	}
	img, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("decode icon %s: %w", filename, err)
	}
	return img, nil
}

// GenerateSprite packs all icons at their native 64px size into a sprite sheet.
// When blacken is true, icons flagged with Blacken=true have their pixels
// converted to black (R=G=B=0, alpha preserved) for light themes. Detailed
// grayscale icons are left unchanged.
func GenerateSprite(blacken bool) (*image.NRGBA, map[string]spriteEntry) {
	const size = 64

	cols := spriteColumns
	rows := (len(spriteIcons) + cols - 1) / cols

	sheet := image.NewNRGBA(image.Rect(0, 0, cols*size, rows*size))
	manifest := make(map[string]spriteEntry, len(spriteIcons))

	for i, icon := range spriteIcons {
		col := i % cols
		row := i / cols
		x := col * size
		y := row * size

		src, err := loadIcon(icon.File)
		if err != nil {
			continue
		}

		dst := image.Rect(x, y, x+size, y+size)
		xdraw.BiLinear.Scale(sheet, dst, src, src.Bounds(), xdraw.Over, nil)

		if blacken && icon.Blacken {
			pix := sheet.Pix
			stride := sheet.Stride
			for py := y; py < y+size; py++ {
				off := py*stride + x*4
				for px := 0; px < size; px++ {
					pix[off+0] = 0
					pix[off+1] = 0
					pix[off+2] = 0
					off += 4
				}
			}
		}

		manifest[icon.Name] = spriteEntry{
			X:          x,
			Y:          y,
			Width:      size,
			Height:     size,
			PixelRatio: 1,
		}
	}

	return sheet, manifest
}

// WriteSpriteFiles generates sprite sheets at native 64px and writes to dir:
//   - sprite.json, sprite.png (blackened — for light themes)
//   - sprite-dark.json, sprite-dark.png (original — for dark themes)
func WriteSpriteFiles(dir string) error {
	for _, v := range []struct {
		prefix  string
		blacken bool
	}{
		{"sprite", true},
		{"sprite-dark", false},
	} {
		img, manifest := GenerateSprite(v.blacken)

		jsonPath := filepath.Join(dir, v.prefix+".json")
		data, err := json.MarshalIndent(manifest, "", "  ")
		if err != nil {
			return fmt.Errorf("marshal %s.json: %w", v.prefix, err)
		}
		if err := os.WriteFile(jsonPath, data, 0644); err != nil {
			return fmt.Errorf("write %s.json: %w", v.prefix, err)
		}

		pngPath := filepath.Join(dir, v.prefix+".png")
		f, err := os.Create(pngPath)
		if err != nil {
			return fmt.Errorf("create %s.png: %w", v.prefix, err)
		}
		if err := png.Encode(f, img); err != nil {
			f.Close()
			return fmt.Errorf("encode %s.png: %w", v.prefix, err)
		}
		if err := f.Close(); err != nil {
			return fmt.Errorf("close %s.png: %w", v.prefix, err)
		}
	}
	return nil
}
