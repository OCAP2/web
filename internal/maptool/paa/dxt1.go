package paa

import (
	"fmt"
	"image"
	"image/color"
)

// DecodeDXT1 decodes DXT1 (BC1) compressed texture data into an NRGBA image.
// Width and height must be multiples of 4 and data must contain exactly
// (width/4)*(height/4)*8 bytes.
func DecodeDXT1(data []byte, width, height int) (*image.NRGBA, error) {
	if width <= 0 || height <= 0 {
		return nil, fmt.Errorf("invalid dimensions: %dx%d", width, height)
	}
	if width%4 != 0 || height%4 != 0 {
		return nil, fmt.Errorf("dimensions must be multiples of 4: %dx%d", width, height)
	}

	blocksX := width / 4
	blocksY := height / 4
	expected := blocksX * blocksY * 8
	if len(data) < expected {
		return nil, fmt.Errorf("data too short: need %d bytes, got %d", expected, len(data))
	}

	img := image.NewNRGBA(image.Rect(0, 0, width, height))

	for by := 0; by < blocksY; by++ {
		for bx := 0; bx < blocksX; bx++ {
			off := (by*blocksX + bx) * 8
			decodeBlock(data[off:off+8], img, bx*4, by*4)
		}
	}
	return img, nil
}

// decodeBlock decodes a single 8-byte DXT1 block and writes 4x4 pixels to img at (px, py).
func decodeBlock(block []byte, img *image.NRGBA, px, py int) {
	c0val := uint16(block[0]) | uint16(block[1])<<8
	c1val := uint16(block[2]) | uint16(block[3])<<8

	var palette [4]color.NRGBA
	palette[0] = rgb565ToNRGBA(c0val)
	palette[1] = rgb565ToNRGBA(c1val)

	if c0val > c1val {
		// Opaque mode: 4 colors
		palette[2] = lerpColor(palette[0], palette[1], 1, 3)
		palette[3] = lerpColor(palette[0], palette[1], 2, 3)
	} else {
		// Transparent mode: 3 colors + transparent black
		palette[2] = lerpColor(palette[0], palette[1], 1, 2)
		palette[3] = color.NRGBA{0, 0, 0, 0}
	}

	for row := 0; row < 4; row++ {
		bits := block[4+row]
		for col := 0; col < 4; col++ {
			idx := (bits >> (col * 2)) & 0x03
			img.SetNRGBA(px+col, py+row, palette[idx])
		}
	}
}

// rgb565ToNRGBA converts a 16-bit RGB565 value to NRGBA.
func rgb565ToNRGBA(v uint16) color.NRGBA {
	r5 := (v >> 11) & 0x1F
	g6 := (v >> 5) & 0x3F
	b5 := v & 0x1F
	return color.NRGBA{
		R: uint8((r5*255 + 15) / 31),
		G: uint8((g6*255 + 31) / 63),
		B: uint8((b5*255 + 15) / 31),
		A: 255,
	}
}

// lerpColor interpolates between two colors: result = (a*(denom-num) + b*num) / denom.
func lerpColor(a, b color.NRGBA, num, denom int) color.NRGBA {
	return color.NRGBA{
		R: uint8((int(a.R)*(denom-num) + int(b.R)*num) / denom),
		G: uint8((int(a.G)*(denom-num) + int(b.G)*num) / denom),
		B: uint8((int(a.B)*(denom-num) + int(b.B)*num) / denom),
		A: 255,
	}
}
