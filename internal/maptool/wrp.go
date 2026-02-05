package maptool

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"io"
	"math"
	"os"
	"strings"

	lzo "github.com/rasky/go-lzo"
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

// WRPData holds extracted features from a fully-parsed WRP file.
type WRPData struct {
	Header    WRPHeader
	Elevation []float32   // MapSizeX × MapSizeY grid
	Models    []string    // model paths (p3d references)
	Objects   []WRPObject // placed objects with transforms
	RoadParts []RoadPart  // road polylines
}

// WRPObject is a placed object in the terrain.
type WRPObject struct {
	ModelIndex uint32
	Transform  [12]float32 // 4×3 row-major: rows 0-2 = rotation, row 3 = position
}

// Position returns the object's world position (x=east, y=height, z=north).
func (o WRPObject) Position() [3]float32 {
	return [3]float32{o.Transform[9], o.Transform[10], o.Transform[11]}
}

// RoadPart is a road polyline segment.
type RoadPart struct {
	Positions [][3]float32 // polyline vertices
	P3DPath   string       // road model path
}

// ReadWRPData parses the full OPRW file and extracts elevation, models, objects, and roads.
func ReadWRPData(path string) (*WRPData, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read WRP file: %w", err)
	}

	if len(data) < 32 {
		return nil, fmt.Errorf("WRP file too small: %d bytes", len(data))
	}
	if string(data[:4]) != "OPRW" {
		return nil, fmt.Errorf("invalid WRP magic: %q (expected \"OPRW\")", string(data[:4]))
	}

	hdr := WRPHeader{
		Version:       binary.LittleEndian.Uint32(data[4:]),
		AppID:         binary.LittleEndian.Uint32(data[8:]),
		LayerSizeX:    binary.LittleEndian.Uint32(data[12:]),
		LayerSizeY:    binary.LittleEndian.Uint32(data[16:]),
		MapSizeX:      binary.LittleEndian.Uint32(data[20:]),
		MapSizeY:      binary.LittleEndian.Uint32(data[24:]),
		LayerCellSize: math.Float32frombits(binary.LittleEndian.Uint32(data[28:])),
	}

	if hdr.Version < 24 {
		return nil, fmt.Errorf("unsupported WRP version %d (need v24+)", hdr.Version)
	}

	result := &WRPData{Header: hdr}
	mapSize := int(hdr.MapSizeX) * int(hdr.MapSizeY)
	off := 32

	// 1. Skip QuadTree Geography
	off, err = skipQuadTree(data, off)
	if err != nil {
		return nil, fmt.Errorf("skip geography quadtree: %w", err)
	}

	// 2. Skip QuadTree SoundMap
	off, err = skipQuadTree(data, off)
	if err != nil {
		return nil, fmt.Errorf("skip soundmap quadtree: %w", err)
	}

	// 3. Skip Mountains (u32 count + count * 12 bytes XYZ triplets)
	if off+4 > len(data) {
		return nil, fmt.Errorf("truncated at mountain count (offset %d)", off)
	}
	mtCount := int(binary.LittleEndian.Uint32(data[off:]))
	off += 4
	if mtCount > 100000 {
		return nil, fmt.Errorf("invalid mountain count %d at offset %d", mtCount, off-4)
	}
	off += mtCount * 12

	// 4. Skip QuadTree RvmatLayerIndex
	off, err = skipQuadTree(data, off)
	if err != nil {
		return nil, fmt.Errorf("skip rvmat quadtree: %w", err)
	}

	// 5. Decompress Grass (mapSize bytes expected)
	// First LZO section: offset is exact from QuadTree parsing
	off, _, err = decompressLZO(data, off, mapSize)
	if err != nil {
		return nil, fmt.Errorf("decompress grass: %w", err)
	}

	// 6. Decompress TexIndex (mapSize bytes expected, v22+)
	// Follows grass LZO: offset is approximate, search backward
	if hdr.Version >= 22 {
		off, _, err = decompressLZOAfterLZO(data, off, mapSize)
		if err != nil {
			return nil, fmt.Errorf("decompress texindex: %w", err)
		}
	}

	// 7. Decompress Elevation (mapSize * 4 bytes expected)
	// Follows another LZO section: offset is approximate
	elevExpected := mapSize * 4
	var elevBytes []byte
	off, elevBytes, err = decompressLZOAfterLZO(data, off, elevExpected)
	if err != nil {
		return nil, fmt.Errorf("decompress elevation: %w", err)
	}
	result.Elevation = make([]float32, mapSize)
	for i := range result.Elevation {
		result.Elevation[i] = math.Float32frombits(binary.LittleEndian.Uint32(elevBytes[i*4:]))
	}

	// 8. Skip Textures (u32 count + per entry: ASCIIZ filename + ASCIIZ flag)
	// After elevation LZO, offset is approximate — search for texture section
	off, err = findAndSkipTextures(data, off)
	if err != nil {
		return nil, fmt.Errorf("skip textures: %w", err)
	}

	// 9. Read Models (u32 count + ASCIIZ strings)
	var models []string
	off, models, err = readStringArrayAt(data, off)
	if err != nil {
		return nil, fmt.Errorf("read models: %w", err)
	}
	result.Models = models

	// 10. Skip ClassedModels (v15+: u32 count + per entry: ASCIIZ + ASCIIZ + [3]float32 + u32)
	if hdr.Version >= 15 {
		off, err = skipClassedModelsAt(data, off)
		if err != nil {
			return nil, fmt.Errorf("skip classed models: %w", err)
		}
	}

	// 11. Skip QuadTree ObjectOffsets
	off, err = skipQuadTree(data, off)
	if err != nil {
		return nil, fmt.Errorf("skip object offsets quadtree: %w", err)
	}

	// 12. Read u32 sizeOfObjects
	if off+4 > len(data) {
		return nil, fmt.Errorf("truncated at sizeOfObjects (offset %d)", off)
	}
	sizeOfObjects := int(binary.LittleEndian.Uint32(data[off:]))
	off += 4

	// 13. Skip QuadTree MapObjectOffsets
	off, err = skipQuadTree(data, off)
	if err != nil {
		return nil, fmt.Errorf("skip map object offsets quadtree: %w", err)
	}

	// 14. Read u32 sizeOfMapInfo
	if off+4 > len(data) {
		return nil, fmt.Errorf("truncated at sizeOfMapInfo (offset %d)", off)
	}
	off += 4 // skip sizeOfMapInfo value

	// 15-16. Decompress unknown_bytes_0 (Persistent) and unknown_bytes_1 (SubDivHints) (v22+)
	// Both are mapSize bytes. unknown_bytes_0 follows QuadTree+u32, so offset is exact.
	// unknown_bytes_1 follows unknown_bytes_0 (LZO→LZO), so search via EOS marker.
	if hdr.Version >= 22 {
		off, _, err = decompressLZO(data, off, mapSize)
		if err != nil {
			return nil, fmt.Errorf("decompress unknown_bytes_0: %w", err)
		}
		off, _, err = decompressLZOAfterLZO(data, off, mapSize)
		if err != nil {
			return nil, fmt.Errorf("decompress unknown_bytes_1: %w", err)
		}
		// After LZO, offset is approximate — find exact end via EOS marker
		off, err = findLZOEndMarker(data, off)
		if err != nil {
			return nil, fmt.Errorf("find end of unknown_bytes_1: %w", err)
		}
	}

	// 17. Read MaxObjectId
	if off+4 > len(data) {
		return nil, fmt.Errorf("truncated at maxObjectId (offset %d)", off)
	}
	off += 4 // skip maxObjectId

	// 18. Read RoadnetSize
	if off+4 > len(data) {
		return nil, fmt.Errorf("truncated at roadnetSize (offset %d)", off)
	}
	roadnetSize := int(binary.LittleEndian.Uint32(data[off:]))
	off += 4

	// 19. Read RoadNet
	roadEnd := off + roadnetSize
	if roadEnd > len(data) {
		roadEnd = len(data)
	}
	result.RoadParts, err = readRoadNetAt(data, off, hdr.LayerSizeX, hdr.LayerSizeY, hdr.Version)
	if err != nil {
		// Road parsing can be fragile; skip and continue
		result.RoadParts = nil
	}
	off = roadEnd

	// 20. Read Objects
	if sizeOfObjects > 0 {
		objectSize := 60 // v14+: objectId(4) + modelIndex(4) + transform(48) + shapeParams(4)
		if hdr.Version < 14 {
			objectSize = 56 // no shapeParams
		}
		objectCount := sizeOfObjects / objectSize
		result.Objects = readObjectsAt(data, off, objectCount, hdr.Version)
	}

	return result, nil
}

// skipQuadTree skips a BIS QuadTree structure.
// Root format: u8 flag. If 0 → leaf (4 bytes). If non-zero → QuadTreeNode.
func skipQuadTree(data []byte, offset int) (int, error) {
	if offset >= len(data) {
		return 0, fmt.Errorf("quadtree: offset %d beyond data (%d bytes)", offset, len(data))
	}
	flag := data[offset]
	offset++
	if flag == 0 {
		// Root is a leaf: 4 bytes
		if offset+4 > len(data) {
			return 0, fmt.Errorf("quadtree: truncated root leaf at offset %d", offset)
		}
		return offset + 4, nil
	}
	// Root is a node
	return skipQuadTreeNode(data, offset, 0)
}

// skipQuadTreeNode reads a u16 bitmask and 16 children.
// Child nodes do NOT have a flag byte — they start directly with a u16 bitmask.
// Leaves are always 4 bytes.
func skipQuadTreeNode(data []byte, offset int, depth int) (int, error) {
	if depth > 15 {
		return 0, fmt.Errorf("quadtree: depth %d exceeded at offset %d", depth, offset)
	}
	if offset+2 > len(data) {
		return 0, fmt.Errorf("quadtree: truncated bitmask at offset %d", offset)
	}
	bitmask := binary.LittleEndian.Uint16(data[offset:])
	offset += 2
	for i := 0; i < 16; i++ {
		if bitmask&(1<<uint(i)) != 0 {
			// Child is a node — recurse (NO flag byte)
			var err error
			offset, err = skipQuadTreeNode(data, offset, depth+1)
			if err != nil {
				return 0, err
			}
		} else {
			// Child is a leaf: 4 bytes
			if offset+4 > len(data) {
				return 0, fmt.Errorf("quadtree: truncated leaf at offset %d depth %d", offset, depth)
			}
			offset += 4
		}
	}
	return offset, nil
}

// lzoMaxOverread is the maximum bytes go-lzo's internal bufio may read past
// the end of the compressed stream. go-lzo uses bufio.NewReaderSize(r, 4096)
// internally, which can buffer up to 4096 bytes beyond what it consumed.
const lzoMaxOverread = 4096

// decompressLZO decompresses an LZO-compressed section or reads raw data.
// BIS format: if expectedSize < 1024, data is raw; otherwise LZO compressed.
// LZO streams are self-terminating with no size prefix.
//
// Due to go-lzo's internal buffering, the returned newOffset is approximate
// (up to lzoMaxOverread bytes past the real end). Use decompressLZOAfterLZO
// when the next section is also LZO-compressed.
func decompressLZO(data []byte, offset int, expectedSize int) (newOffset int, decompressed []byte, err error) {
	if expectedSize < 1024 {
		// Raw data, not compressed
		end := offset + expectedSize
		if end > len(data) {
			return 0, nil, fmt.Errorf("truncated raw data at offset %d (need %d bytes)", offset, expectedSize)
		}
		raw := make([]byte, expectedSize)
		copy(raw, data[offset:end])
		return end, raw, nil
	}

	r := bytes.NewReader(data[offset:])
	decompressed, err = lzo.Decompress1X(r, 0, expectedSize)
	if err != nil {
		return 0, nil, fmt.Errorf("LZO decompress at offset %d: %w", offset, err)
	}
	consumed := len(data[offset:]) - r.Len()
	return offset + consumed, decompressed, nil
}

// decompressLZOAfterLZO decompresses an LZO section that follows another LZO section.
// Because go-lzo overreads by up to lzoMaxOverread bytes, the actual start of this
// section is somewhere in [approxOffset-lzoMaxOverread, approxOffset]. This function
// searches backward for the LZO end-of-stream marker (0x11 0x00 0x00) of the
// preceding section and decompresses from right after it.
func decompressLZOAfterLZO(data []byte, approxOffset int, expectedSize int) (newOffset int, decompressed []byte, err error) {
	if expectedSize < 1024 {
		// Raw sections: search for start via EOS marker, then read raw bytes
		tryOff, findErr := findLZOEndMarker(data, approxOffset)
		if findErr != nil {
			return 0, nil, fmt.Errorf("find raw section near offset %d: %w", approxOffset, findErr)
		}
		end := tryOff + expectedSize
		if end > len(data) {
			return 0, nil, fmt.Errorf("truncated raw data at offset %d", tryOff)
		}
		raw := make([]byte, expectedSize)
		copy(raw, data[tryOff:end])
		return end, raw, nil
	}

	// Search backward for LZO EOS marker, then decompress from after it
	searchStart := approxOffset - lzoMaxOverread
	if searchStart < 0 {
		searchStart = 0
	}
	for off := approxOffset - 1; off >= searchStart; off-- {
		if off+3 > len(data) {
			continue
		}
		if data[off] == 0x11 && data[off+1] == 0x00 && data[off+2] == 0x00 {
			tryOff := off + 3
			r := bytes.NewReader(data[tryOff:])
			out, tryErr := lzo.Decompress1X(r, 0, expectedSize)
			if tryErr == nil && len(out) == expectedSize {
				consumed := len(data[tryOff:]) - r.Len()
				return tryOff + consumed, out, nil
			}
		}
	}
	return 0, nil, fmt.Errorf("could not find LZO section near offset %d (expected %d bytes)", approxOffset, expectedSize)
}

// findLZOEndMarker searches backward from approxOffset for the LZO end-of-stream
// marker (0x11 0x00 0x00) and returns the offset right after it.
func findLZOEndMarker(data []byte, approxOffset int) (int, error) {
	searchStart := approxOffset - lzoMaxOverread
	if searchStart < 0 {
		searchStart = 0
	}
	for off := approxOffset - 1; off >= searchStart; off-- {
		if off+3 <= len(data) && data[off] == 0x11 && data[off+1] == 0x00 && data[off+2] == 0x00 {
			return off + 3, nil
		}
	}
	return 0, fmt.Errorf("LZO EOS marker not found near offset %d", approxOffset)
}

// readASCIIZAt reads a null-terminated string from a byte slice at the given offset.
func readASCIIZAt(data []byte, offset int) (string, int, error) {
	end := offset
	for end < len(data) && data[end] != 0 {
		end++
	}
	if end >= len(data) {
		return "", 0, fmt.Errorf("unterminated string at offset %d", offset)
	}
	return string(data[offset:end]), end + 1, nil // +1 to skip null terminator
}

// readStringArrayAt reads a u32 count followed by count null-terminated strings.
func readStringArrayAt(data []byte, offset int) (int, []string, error) {
	if offset+4 > len(data) {
		return 0, nil, fmt.Errorf("truncated string array count at offset %d", offset)
	}
	count := int(binary.LittleEndian.Uint32(data[offset:]))
	offset += 4
	strs := make([]string, count)
	for i := range strs {
		s, newOff, err := readASCIIZAt(data, offset)
		if err != nil {
			return 0, nil, fmt.Errorf("string %d: %w", i, err)
		}
		strs[i] = s
		offset = newOff
	}
	return offset, strs, nil
}

// findAndSkipTextures locates and skips the texture section after an LZO section.
// After LZO decompression, the offset may be up to lzoMaxOverread bytes too far.
// Searches backward for the LZO end-of-stream marker (0x11 0x00 0x00) and tries
// to parse the texture section from right after it.
func findAndSkipTextures(data []byte, approxOffset int) (int, error) {
	searchStart := approxOffset - lzoMaxOverread
	if searchStart < 0 {
		searchStart = 0
	}

	// Search for LZO1X end-of-stream marker: 0x11 0x00 0x00
	// The texture section starts immediately after it.
	for off := approxOffset - 1; off >= searchStart; off-- {
		if off+3 > len(data) {
			continue
		}
		if data[off] == 0x11 && data[off+1] == 0x00 && data[off+2] == 0x00 {
			texOff := off + 3
			endOff, err := skipTextures(data, texOff)
			if err != nil {
				continue
			}
			// Validate: after textures, model count should be reasonable
			// and first model path should contain ".p3d"
			if endOff+4 < len(data) {
				mc := int(binary.LittleEndian.Uint32(data[endOff:]))
				if mc >= 1 && mc <= 100000 {
					mName, _, mErr := readASCIIZAt(data, endOff+4)
					if mErr == nil && len(mName) > 4 && strings.Contains(strings.ToLower(mName), ".p3d") {
						return endOff, nil
					}
				}
			}
		}
	}
	// Fallback: try at the approximate offset
	return skipTextures(data, approxOffset)
}

// skipTextures skips the texture section: u32 count + per entry: ASCIIZ filename + ASCIIZ flag.
func skipTextures(data []byte, offset int) (int, error) {
	if offset+4 > len(data) {
		return 0, fmt.Errorf("truncated texture count at offset %d", offset)
	}
	count := int(binary.LittleEndian.Uint32(data[offset:]))
	offset += 4
	for i := 0; i < count; i++ {
		// ASCIIZ texture filename
		_, newOff, err := readASCIIZAt(data, offset)
		if err != nil {
			return 0, fmt.Errorf("texture %d filename: %w", i, err)
		}
		offset = newOff
		// ASCIIZ flag (usually empty string)
		_, newOff, err = readASCIIZAt(data, offset)
		if err != nil {
			return 0, fmt.Errorf("texture %d flag: %w", i, err)
		}
		offset = newOff
	}
	return offset, nil
}

// skipClassedModelsAt skips the ClassedModels section.
// Each entry: ASCIIZ className + ASCIIZ modelPath + [3]float32 position + u32 objId = 16 bytes fixed.
func skipClassedModelsAt(data []byte, offset int) (int, error) {
	if offset+4 > len(data) {
		return 0, fmt.Errorf("truncated classed model count at offset %d", offset)
	}
	count := int(binary.LittleEndian.Uint32(data[offset:]))
	offset += 4
	for i := 0; i < count; i++ {
		// ASCIIZ class_name
		_, newOff, err := readASCIIZAt(data, offset)
		if err != nil {
			return 0, fmt.Errorf("classed model %d class_name: %w", i, err)
		}
		offset = newOff
		// ASCIIZ model_path
		_, newOff, err = readASCIIZAt(data, offset)
		if err != nil {
			return 0, fmt.Errorf("classed model %d model_path: %w", i, err)
		}
		offset = newOff
		// [3]float32 position + u32 obj_id = 16 bytes
		if offset+16 > len(data) {
			return 0, fmt.Errorf("classed model %d: truncated at offset %d", i, offset)
		}
		offset += 16
	}
	return offset, nil
}

// readRoadNetAt reads the road network section from a byte slice.
func readRoadNetAt(data []byte, offset int, layerSizeX, layerSizeY, version uint32) ([]RoadPart, error) {
	var parts []RoadPart
	cellCount := int(layerSizeX) * int(layerSizeY)
	for c := 0; c < cellCount; c++ {
		if offset+4 > len(data) {
			return parts, fmt.Errorf("truncated road cell %d at offset %d", c, offset)
		}
		nParts := int(binary.LittleEndian.Uint32(data[offset:]))
		offset += 4
		for p := 0; p < nParts; p++ {
			if offset+2 > len(data) {
				return parts, fmt.Errorf("truncated road part count at offset %d", offset)
			}
			nPositions := int(binary.LittleEndian.Uint16(data[offset:]))
			offset += 2

			posSize := nPositions * 12
			if offset+posSize > len(data) {
				return parts, fmt.Errorf("truncated road positions at offset %d", offset)
			}
			positions := make([][3]float32, nPositions)
			for i := range positions {
				for j := 0; j < 3; j++ {
					positions[i][j] = math.Float32frombits(binary.LittleEndian.Uint32(data[offset+j*4:]))
				}
				offset += 12
			}

			// v24+: type byte per position
			if version >= 24 {
				if offset+nPositions > len(data) {
					return parts, fmt.Errorf("truncated road types at offset %d", offset)
				}
				offset += nPositions
			}

			// u32 object_id
			if offset+4 > len(data) {
				return parts, fmt.Errorf("truncated road object_id at offset %d", offset)
			}
			offset += 4

			// v16+: ASCIIZ p3d_path + [12]float32 transform
			var p3dPath string
			if version >= 16 {
				var err error
				p3dPath, offset, err = readASCIIZAt(data, offset)
				if err != nil {
					return parts, fmt.Errorf("road p3d path: %w", err)
				}
				// transform matrix: 12 floats = 48 bytes
				if offset+48 > len(data) {
					return parts, fmt.Errorf("truncated road transform at offset %d", offset)
				}
				// For parts with no position vertices, extract center from transform row 3
				if len(positions) == 0 {
					cx := math.Float32frombits(binary.LittleEndian.Uint32(data[offset+9*4:]))
					cy := math.Float32frombits(binary.LittleEndian.Uint32(data[offset+10*4:]))
					cz := math.Float32frombits(binary.LittleEndian.Uint32(data[offset+11*4:]))
					positions = [][3]float32{{cx, cy, cz}}
				}
				offset += 48
			}

			if len(positions) > 0 {
				parts = append(parts, RoadPart{Positions: positions, P3DPath: p3dPath})
			}
		}
	}
	return parts, nil
}

// readObjectsAt reads placed objects from a byte slice.
// v14+ format: objectId(4) + modelIndex(4) + transform(48) + shapeParams(4) = 60 bytes.
func readObjectsAt(data []byte, offset int, count int, version uint32) []WRPObject {
	objectSize := 60 // v14+
	if version < 14 {
		objectSize = 56
	}

	objects := make([]WRPObject, 0, count)
	for i := 0; i < count; i++ {
		if offset+objectSize > len(data) {
			break
		}
		// Skip objectId (4 bytes), read modelIndex (4 bytes)
		modelIndex := binary.LittleEndian.Uint32(data[offset+4:])
		var transform [12]float32
		for j := range transform {
			transform[j] = math.Float32frombits(binary.LittleEndian.Uint32(data[offset+8+j*4:]))
		}
		objects = append(objects, WRPObject{
			ModelIndex: modelIndex,
			Transform:  transform,
		})
		offset += objectSize
	}
	return objects
}

// ClassifyModel categorizes a model path into a feature type.
// Returns "building", "vegetation", "rock", "road", or "" for unclassified.
func ClassifyModel(path string) string {
	lower := strings.ToLower(path)
	switch {
	case strings.Contains(lower, "road"):
		return "road"
	case strings.Contains(lower, "vegetation") || strings.Contains(lower, "tree") ||
		strings.Contains(lower, "bush") || strings.Contains(lower, "plant"):
		return "vegetation"
	case strings.Contains(lower, "rock"):
		return "rock"
	case strings.Contains(lower, "structures") || strings.Contains(lower, "house") ||
		strings.Contains(lower, "land_") || strings.Contains(lower, "building") ||
		strings.Contains(lower, "mil_") || strings.Contains(lower, "ind_") ||
		strings.Contains(lower, "church") || strings.Contains(lower, "castle") ||
		strings.Contains(lower, "cargo") || strings.Contains(lower, "tower") ||
		strings.Contains(lower, "hangar") || strings.Contains(lower, "hospital") ||
		strings.Contains(lower, "warehouse") || strings.Contains(lower, "barn") ||
		strings.Contains(lower, "shed") || strings.Contains(lower, "bunker"):
		return "building"
	default:
		return ""
	}
}
