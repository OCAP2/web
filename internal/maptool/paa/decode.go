package paa

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"image"
	"io"

	lzo "github.com/rasky/go-lzo"
)

// Type tags for PAA texture formats.
const (
	TypeDXT1 = 0xFF01
	TypeDXT2 = 0xFF02
	TypeDXT3 = 0xFF03
	TypeDXT4 = 0xFF04
	TypeDXT5 = 0xFF05
)

// Header holds PAA metadata parsed from the file header.
type Header struct {
	Type   uint16
	Width  int
	Height int
}

// Decode reads a PAA file and returns the first (largest) mipmap as an image.
// Only DXT1 format (0xFF01) is supported.
func Decode(r io.ReadSeeker) (image.Image, error) {
	hdr, mipmapOffset, err := parseHeader(r)
	if err != nil {
		return nil, err
	}
	if hdr.Type != TypeDXT1 {
		return nil, fmt.Errorf("unsupported PAA type: 0x%04X (only DXT1 0xFF01 supported)", hdr.Type)
	}

	if _, err := r.Seek(int64(mipmapOffset), io.SeekStart); err != nil {
		return nil, fmt.Errorf("seek to mipmap: %w", err)
	}

	raw, w, h, err := readMipmap(r)
	if err != nil {
		return nil, fmt.Errorf("read mipmap: %w", err)
	}
	if w != hdr.Width || h != hdr.Height {
		return nil, fmt.Errorf("mipmap dimensions %dx%d don't match header %dx%d", w, h, hdr.Width, hdr.Height)
	}

	return DecodeDXT1(raw, w, h)
}

// DecodeConfig reads PAA metadata without decoding pixel data.
func DecodeConfig(r io.ReadSeeker) (Header, error) {
	hdr, _, err := parseHeader(r)
	return hdr, err
}

// parseHeader reads the PAA type tag and tag section, returning the header
// and the file offset of the first mipmap.
func parseHeader(r io.ReadSeeker) (Header, uint32, error) {
	var hdr Header

	if err := binary.Read(r, binary.LittleEndian, &hdr.Type); err != nil {
		return hdr, 0, fmt.Errorf("read type tag: %w", err)
	}

	var mipmapOffsets [16]uint32

	// Read tagged data section
	for {
		var tagName [8]byte
		if _, err := io.ReadFull(r, tagName[:]); err != nil {
			return hdr, 0, fmt.Errorf("read tag name: %w", err)
		}

		// Check for end-of-tags: first byte is 0x00
		if tagName[0] == 0 {
			break
		}

		var dataLen uint32
		if err := binary.Read(r, binary.LittleEndian, &dataLen); err != nil {
			return hdr, 0, fmt.Errorf("read tag length: %w", err)
		}

		tagStr := string(tagName[:])
		if tagStr == "GGATSFFO" {
			// OFFSTAGG: mipmap offsets (16 × uint32)
			if dataLen >= 64 {
				if err := binary.Read(r, binary.LittleEndian, &mipmapOffsets); err != nil {
					return hdr, 0, fmt.Errorf("read offsets: %w", err)
				}
				// Skip any excess data
				if dataLen > 64 {
					if _, err := r.Seek(int64(dataLen-64), io.SeekCurrent); err != nil {
						return hdr, 0, fmt.Errorf("skip excess offset data: %w", err)
					}
				}
			} else {
				if _, err := r.Seek(int64(dataLen), io.SeekCurrent); err != nil {
					return hdr, 0, fmt.Errorf("skip tag data: %w", err)
				}
			}
		} else {
			// Skip unknown tag data
			if _, err := r.Seek(int64(dataLen), io.SeekCurrent); err != nil {
				return hdr, 0, fmt.Errorf("skip tag data: %w", err)
			}
		}
	}

	// Determine first mipmap offset
	mip0Offset := mipmapOffsets[0]
	if mip0Offset == 0 {
		// No OFFSTAGG tag — mipmap follows immediately after tags.
		// The end-of-tags marker consumed 8 bytes for tag name; we're already past it.
		pos, err := r.Seek(0, io.SeekCurrent)
		if err != nil {
			return hdr, 0, fmt.Errorf("get position: %w", err)
		}
		mip0Offset = uint32(pos)
	}

	// Read dimensions from mipmap header to populate Header
	saved, _ := r.Seek(0, io.SeekCurrent)
	if _, err := r.Seek(int64(mip0Offset), io.SeekStart); err != nil {
		return hdr, 0, fmt.Errorf("seek to mipmap for config: %w", err)
	}

	var rawW, rawH uint16
	if err := binary.Read(r, binary.LittleEndian, &rawW); err != nil {
		return hdr, 0, fmt.Errorf("read mipmap width: %w", err)
	}
	if err := binary.Read(r, binary.LittleEndian, &rawH); err != nil {
		return hdr, 0, fmt.Errorf("read mipmap height: %w", err)
	}

	hdr.Width = int(rawW & 0x7FFF)
	hdr.Height = int(rawH)

	// Restore position
	r.Seek(saved, io.SeekStart)

	return hdr, mip0Offset, nil
}

// readMipmap reads a single mipmap entry: width, height, 3-byte size, data.
// Returns decompressed DXT1 data and dimensions.
func readMipmap(r io.ReadSeeker) ([]byte, int, int, error) {
	var rawW, rawH uint16
	if err := binary.Read(r, binary.LittleEndian, &rawW); err != nil {
		return nil, 0, 0, fmt.Errorf("read width: %w", err)
	}
	if err := binary.Read(r, binary.LittleEndian, &rawH); err != nil {
		return nil, 0, 0, fmt.Errorf("read height: %w", err)
	}

	compressed := rawW&0x8000 != 0
	width := int(rawW & 0x7FFF)
	height := int(rawH)

	// Read 3-byte (24-bit) data size
	var sizeBuf [3]byte
	if _, err := io.ReadFull(r, sizeBuf[:]); err != nil {
		return nil, 0, 0, fmt.Errorf("read data size: %w", err)
	}
	dataSize := int(sizeBuf[0]) | int(sizeBuf[1])<<8 | int(sizeBuf[2])<<16

	data := make([]byte, dataSize)
	if _, err := io.ReadFull(r, data); err != nil {
		return nil, 0, 0, fmt.Errorf("read data (%d bytes): %w", dataSize, err)
	}

	if compressed {
		expectedSize := (width / 4) * (height / 4) * 8 // DXT1: 8 bytes per 4x4 block
		decompressed, err := lzo.Decompress1X(bytes.NewReader(data), len(data), expectedSize)
		if err != nil {
			return nil, 0, 0, fmt.Errorf("LZO decompress: %w", err)
		}
		data = decompressed
	}

	return data, width, height, nil
}
