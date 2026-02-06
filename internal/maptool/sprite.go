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
	Name string // MapLibre icon name, e.g. "objects/tree"
	File string // embedded filename, e.g. "tree.png"
}

// spriteIcons lists all icons referenced by knownLayerStyles, sorted by name.
var spriteIcons = func() []spriteIcon {
	icons := []spriteIcon{
		// Objects (MapControl)
		{"objects/bunker", "bunker.png"},
		{"objects/bush", "bush.png"},
		{"objects/chapel", "chapel.png"},
		{"objects/church", "church.png"},
		{"objects/cross", "cross.png"},
		{"objects/fountain", "fountain.png"},
		{"objects/fuelstation", "fuelstation.png"},
		{"objects/hospital", "hospital.png"},
		{"objects/lighthouse", "lighthouse.png"},
		{"objects/powersolar", "powersolar.png"},
		{"objects/powerwave", "powerwave.png"},
		{"objects/powerwind", "powerwind.png"},
		{"objects/quay", "quay.png"},
		{"objects/rock", "rock.png"},
		{"objects/ruin", "ruin.png"},
		{"objects/shipwreck", "shipwreck.png"},
		{"objects/stack", "stack.png"},
		{"objects/tourism", "tourism.png"},
		{"objects/transmitter", "transmitter.png"},
		{"objects/tree", "tree.png"},
		{"objects/viewtower", "viewtower.png"},
		{"objects/watertower", "watertower.png"},

		// Locations (LocationTypes)
		{"locations/hill", "hill.png"},
		{"locations/vegetationbroadleaf", "vegetationbroadleaf.png"},
		{"locations/vegetationfir", "vegetationfir.png"},
		{"locations/vegetationpalm", "vegetationpalm.png"},
		{"locations/vegetationvineyard", "vegetationvineyard.png"},
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

// GenerateSprite renders all icons at baseSize*scale pixels and returns the
// packed PNG image and JSON manifest.
func GenerateSprite(scale int) (*image.NRGBA, map[string]spriteEntry) {
	const baseSize = 32
	size := baseSize * scale

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

		// Scale the 64x64 source icon to the target size
		dst := image.Rect(x, y, x+size, y+size)
		xdraw.BiLinear.Scale(sheet, dst, src, src.Bounds(), xdraw.Over, nil)

		manifest[icon.Name] = spriteEntry{
			X:          x,
			Y:          y,
			Width:      size,
			Height:     size,
			PixelRatio: scale,
		}
	}

	return sheet, manifest
}

// WriteSpriteFiles generates 1x and 2x sprite sheets and writes four files
// to dir: sprite.json, sprite.png, sprite@2x.json, sprite@2x.png.
func WriteSpriteFiles(dir string) error {
	for _, s := range []struct {
		scale  int
		suffix string
	}{
		{1, ""},
		{2, "@2x"},
	} {
		img, manifest := GenerateSprite(s.scale)

		jsonPath := filepath.Join(dir, "sprite"+s.suffix+".json")
		data, err := json.MarshalIndent(manifest, "", "  ")
		if err != nil {
			return fmt.Errorf("marshal sprite%s.json: %w", s.suffix, err)
		}
		if err := os.WriteFile(jsonPath, data, 0644); err != nil {
			return fmt.Errorf("write sprite%s.json: %w", s.suffix, err)
		}

		pngPath := filepath.Join(dir, "sprite"+s.suffix+".png")
		f, err := os.Create(pngPath)
		if err != nil {
			return fmt.Errorf("create sprite%s.png: %w", s.suffix, err)
		}
		if err := png.Encode(f, img); err != nil {
			f.Close()
			return fmt.Errorf("encode sprite%s.png: %w", s.suffix, err)
		}
		if err := f.Close(); err != nil {
			return fmt.Errorf("close sprite%s.png: %w", s.suffix, err)
		}
	}
	return nil
}
