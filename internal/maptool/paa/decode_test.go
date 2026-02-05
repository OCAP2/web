package paa

import (
	"bytes"
	"encoding/binary"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// buildMinimalPAA constructs a minimal valid PAA file in memory.
// If compressed is true, the DXT1 data is LZSS-compressed.
func buildMinimalPAA(width, height int, dxt1Data []byte, compressed bool) []byte {
	var buf bytes.Buffer

	// Type tag: DXT1
	binary.Write(&buf, binary.LittleEndian, uint16(TypeDXT1))

	// Tags: just the end-of-tags marker (8 zero bytes)
	buf.Write(make([]byte, 8))

	// Mipmap: width, height, 24-bit size, data
	w := uint16(width)
	if compressed {
		w |= 0x8000
	}
	binary.Write(&buf, binary.LittleEndian, w)
	binary.Write(&buf, binary.LittleEndian, uint16(height))

	// 24-bit data size
	size := len(dxt1Data)
	buf.WriteByte(byte(size))
	buf.WriteByte(byte(size >> 8))
	buf.WriteByte(byte(size >> 16))

	buf.Write(dxt1Data)
	return buf.Bytes()
}

func TestDecode_MinimalUncompressed(t *testing.T) {
	// 4x4 DXT1 = 1 block = 8 bytes
	dxt1 := make([]byte, 8)
	// Set c0 > c1 for opaque mode, all index 0
	dxt1[0] = 0xFF // c0 low
	dxt1[1] = 0xFF // c0 high (white)
	dxt1[2] = 0x00 // c1 low
	dxt1[3] = 0x00 // c1 high (black)
	// lookup: all index 0 = c0

	paaData := buildMinimalPAA(4, 4, dxt1, false)
	r := bytes.NewReader(paaData)

	img, err := Decode(r)
	require.NoError(t, err)
	assert.Equal(t, 4, img.Bounds().Dx())
	assert.Equal(t, 4, img.Bounds().Dy())
}

func TestDecodeConfig_MinimalPAA(t *testing.T) {
	dxt1 := make([]byte, 8)
	paaData := buildMinimalPAA(4, 4, dxt1, false)
	r := bytes.NewReader(paaData)

	hdr, err := DecodeConfig(r)
	require.NoError(t, err)
	assert.Equal(t, uint16(TypeDXT1), hdr.Type)
	assert.Equal(t, 4, hdr.Width)
	assert.Equal(t, 4, hdr.Height)
}

func TestDecode_WithTags(t *testing.T) {
	var buf bytes.Buffer

	// Type tag
	binary.Write(&buf, binary.LittleEndian, uint16(TypeDXT1))

	// AVGC tag (GGATCGVA)
	buf.WriteString("GGATCGVA")
	binary.Write(&buf, binary.LittleEndian, uint32(4))
	binary.Write(&buf, binary.LittleEndian, uint32(0x00FF00FF))

	// MAXC tag (GGATCXAM)
	buf.WriteString("GGATCXAM")
	binary.Write(&buf, binary.LittleEndian, uint32(4))
	binary.Write(&buf, binary.LittleEndian, uint32(0xFFFFFFFF))

	// End of tags
	buf.Write(make([]byte, 8))

	// Mipmap: 4x4, uncompressed
	binary.Write(&buf, binary.LittleEndian, uint16(4))
	binary.Write(&buf, binary.LittleEndian, uint16(4))
	dxt1 := make([]byte, 8)
	buf.WriteByte(byte(len(dxt1)))
	buf.WriteByte(0)
	buf.WriteByte(0)
	buf.Write(dxt1)

	r := bytes.NewReader(buf.Bytes())
	img, err := Decode(r)
	require.NoError(t, err)
	assert.Equal(t, 4, img.Bounds().Dx())
}

func TestDecode_NonDXT1Format(t *testing.T) {
	var buf bytes.Buffer
	binary.Write(&buf, binary.LittleEndian, uint16(TypeDXT5))
	buf.Write(make([]byte, 8)) // end of tags

	// Mipmap header
	binary.Write(&buf, binary.LittleEndian, uint16(4))
	binary.Write(&buf, binary.LittleEndian, uint16(4))
	buf.Write([]byte{0, 0, 0}) // size = 0

	r := bytes.NewReader(buf.Bytes())
	_, err := Decode(r)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "unsupported PAA type")
}

func TestDecode_TruncatedFile(t *testing.T) {
	// Just a type tag, nothing else
	data := []byte{0x01, 0xFF}
	r := bytes.NewReader(data)
	_, err := Decode(r)
	assert.Error(t, err)
}

func TestDecompressLZSS_Literal(t *testing.T) {
	// Flag byte 0xFF = all 8 bits set = 8 literal bytes
	src := []byte{0xFF, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48}
	out := decompressLZSS(src, 8)
	assert.Equal(t, []byte("ABCDEFGH"), out)
}

func TestDecompressLZSS_BackRef(t *testing.T) {
	// First: 8 literal bytes "ABCDABCD"
	// Then: back-reference to copy from buffer
	src := make([]byte, 0, 32)
	// Flag 1: all literals
	src = append(src, 0xFF)
	src = append(src, 'A', 'B', 'C', 'D', 'A', 'B', 'C', 'D')

	out := decompressLZSS(src, 8)
	assert.Equal(t, []byte("ABCDABCD"), out)
}
