package paa

import (
	"image/color"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func nrgbaToRGB565(c color.NRGBA) uint16 {
	r5 := uint16(c.R) >> 3
	g6 := uint16(c.G) >> 2
	b5 := uint16(c.B) >> 3
	return (r5 << 11) | (g6 << 5) | b5
}

func makeBlock(c0, c1 uint16, lookupRows [4]byte) [8]byte {
	return [8]byte{
		byte(c0), byte(c0 >> 8),
		byte(c1), byte(c1 >> 8),
		lookupRows[0], lookupRows[1], lookupRows[2], lookupRows[3],
	}
}

func TestDecodeDXT1_SolidColor(t *testing.T) {
	// All pixels use index 0 (c0), lookup = 0x00 per row
	red := nrgbaToRGB565(color.NRGBA{255, 0, 0, 255})
	block := makeBlock(red, 0, [4]byte{0, 0, 0, 0})

	img, err := DecodeDXT1(block[:], 4, 4)
	require.NoError(t, err)

	expected := rgb565ToNRGBA(red)
	for y := 0; y < 4; y++ {
		for x := 0; x < 4; x++ {
			assert.Equal(t, expected, img.NRGBAAt(x, y), "pixel (%d,%d)", x, y)
		}
	}
}

func TestDecodeDXT1_TwoColors(t *testing.T) {
	// Alternating c0 and c1 per row (index 0 and 1)
	c0 := nrgbaToRGB565(color.NRGBA{255, 0, 0, 255}) // red-ish
	c1 := nrgbaToRGB565(color.NRGBA{0, 0, 255, 255}) // blue-ish

	// Ensure c0 > c1 for opaque mode
	if c0 < c1 {
		c0, c1 = c1, c0
	}

	// Each row: col0=idx0, col1=idx1, col2=idx0, col3=idx1 = 0b01000100 = 0x44
	block := makeBlock(c0, c1, [4]byte{0x44, 0x44, 0x44, 0x44})

	img, err := DecodeDXT1(block[:], 4, 4)
	require.NoError(t, err)

	exp0 := rgb565ToNRGBA(c0)
	exp1 := rgb565ToNRGBA(c1)

	for y := 0; y < 4; y++ {
		assert.Equal(t, exp0, img.NRGBAAt(0, y))
		assert.Equal(t, exp1, img.NRGBAAt(1, y))
		assert.Equal(t, exp0, img.NRGBAAt(2, y))
		assert.Equal(t, exp1, img.NRGBAAt(3, y))
	}
}

func TestDecodeDXT1_512x512(t *testing.T) {
	const w, h = 512, 512
	blocksX, blocksY := w/4, h/4
	data := make([]byte, blocksX*blocksY*8)

	// Fill with valid blocks (solid green)
	green := nrgbaToRGB565(color.NRGBA{0, 255, 0, 255})
	block := makeBlock(green, 0, [4]byte{0, 0, 0, 0})
	for i := 0; i < blocksX*blocksY; i++ {
		copy(data[i*8:], block[:])
	}

	img, err := DecodeDXT1(data, w, h)
	require.NoError(t, err)
	assert.Equal(t, w, img.Bounds().Dx())
	assert.Equal(t, h, img.Bounds().Dy())

	// Spot-check corners
	expected := rgb565ToNRGBA(green)
	assert.Equal(t, expected, img.NRGBAAt(0, 0))
	assert.Equal(t, expected, img.NRGBAAt(w-1, h-1))
}

func TestDecodeDXT1_InvalidDimensions(t *testing.T) {
	_, err := DecodeDXT1(nil, 0, 0)
	assert.Error(t, err)

	_, err = DecodeDXT1(nil, 5, 4)
	assert.Error(t, err)

	_, err = DecodeDXT1(nil, 4, 5)
	assert.Error(t, err)
}

func TestDecodeDXT1_DataTooShort(t *testing.T) {
	_, err := DecodeDXT1([]byte{0, 0, 0, 0}, 4, 4)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "data too short")
}

func TestDecodeDXT1_TransparentMode(t *testing.T) {
	// c0 <= c1 → transparent mode, index 3 = transparent black
	c0 := uint16(0x0001)
	c1 := uint16(0x0002)
	// All pixels index 3 = 0xFF per row
	block := makeBlock(c0, c1, [4]byte{0xFF, 0xFF, 0xFF, 0xFF})

	img, err := DecodeDXT1(block[:], 4, 4)
	require.NoError(t, err)

	for y := 0; y < 4; y++ {
		for x := 0; x < 4; x++ {
			c := img.NRGBAAt(x, y)
			assert.Equal(t, uint8(0), c.A, "pixel (%d,%d) should be transparent", x, y)
		}
	}
}
