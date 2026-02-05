package maptool

import (
	"encoding/binary"
	"fmt"
	"io"
	"math"
	"os"
)

// WRPHeader holds the parsed OPRW terrain file header.
type WRPHeader struct {
	Version       uint32
	AppID         uint32
	LayerSizeX    uint32
	LayerSizeY    uint32
	MapSizeX      uint32
	MapSizeY      uint32
	LayerCellSize float32
}

// WorldSize returns the terrain extent in meters.
func (h WRPHeader) WorldSize() int {
	return int(float64(h.LayerSizeX) * float64(h.LayerCellSize))
}

// ReadWRPHeader parses the OPRW header from a reader.
func ReadWRPHeader(r io.Reader) (WRPHeader, error) {
	var magic [4]byte
	if _, err := io.ReadFull(r, magic[:]); err != nil {
		return WRPHeader{}, fmt.Errorf("read magic: %w", err)
	}
	if string(magic[:]) != "OPRW" {
		return WRPHeader{}, fmt.Errorf("invalid WRP magic: %q (expected \"OPRW\")", string(magic[:]))
	}

	var hdr WRPHeader
	if err := binary.Read(r, binary.LittleEndian, &hdr); err != nil {
		return WRPHeader{}, fmt.Errorf("read header fields: %w", err)
	}

	if hdr.LayerCellSize <= 0 || math.IsNaN(float64(hdr.LayerCellSize)) || math.IsInf(float64(hdr.LayerCellSize), 0) {
		return WRPHeader{}, fmt.Errorf("invalid layer cell size: %f", hdr.LayerCellSize)
	}

	return hdr, nil
}

// ReadWRPMeta reads a WRP file and returns the parsed header.
func ReadWRPMeta(path string) (WRPHeader, error) {
	f, err := os.Open(path)
	if err != nil {
		return WRPHeader{}, fmt.Errorf("open WRP: %w", err)
	}
	defer f.Close()
	return ReadWRPHeader(f)
}
