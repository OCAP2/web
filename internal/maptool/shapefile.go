package maptool

import (
	"encoding/binary"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// ShapePolyLine represents a single PolyLine record from a shapefile.
type ShapePolyLine struct {
	Parts  [][]([2]float64) // each part is a slice of (x,y) points
	Fields map[string]string
}

// ReadRoadsShapefile reads a roads shapefile (.shp + .dbf) and returns polylines with attributes.
// Only reads ShapeType 3 (PolyLine).
func ReadRoadsShapefile(shpPath string) ([]ShapePolyLine, error) {
	// Read .shp
	shpData, err := os.ReadFile(shpPath)
	if err != nil {
		return nil, fmt.Errorf("read shp: %w", err)
	}
	if len(shpData) < 100 {
		return nil, fmt.Errorf("shp too short: %d bytes", len(shpData))
	}

	// Read .dbf
	dbfPath := strings.TrimSuffix(shpPath, filepath.Ext(shpPath)) + ".dbf"
	dbfData, err := os.ReadFile(dbfPath)
	if err != nil {
		return nil, fmt.Errorf("read dbf: %w", err)
	}

	dbfRecords, err := parseDBF(dbfData)
	if err != nil {
		return nil, fmt.Errorf("parse dbf: %w", err)
	}

	// Parse .shp records
	shapeType := binary.LittleEndian.Uint32(shpData[32:])
	if shapeType != 3 {
		return nil, fmt.Errorf("expected PolyLine (3), got shape type %d", shapeType)
	}

	var result []ShapePolyLine
	off := 100 // past file header
	recIdx := 0
	for off+8 <= len(shpData) {
		// Record header (big-endian)
		contentLen := int(binary.BigEndian.Uint32(shpData[off+4:])) * 2
		off += 8
		if off+contentLen > len(shpData) {
			break
		}
		recEnd := off + contentLen

		recType := binary.LittleEndian.Uint32(shpData[off:])
		if recType != 3 {
			off = recEnd
			recIdx++
			continue
		}

		// PolyLine: skip bounding box (32 bytes)
		off += 4 + 32
		numParts := int(binary.LittleEndian.Uint32(shpData[off:]))
		numPoints := int(binary.LittleEndian.Uint32(shpData[off+4:]))
		off += 8

		// Part indices
		partStarts := make([]int, numParts)
		for i := range partStarts {
			partStarts[i] = int(binary.LittleEndian.Uint32(shpData[off:]))
			off += 4
		}

		// Points
		points := make([][2]float64, numPoints)
		for i := range points {
			points[i][0] = math.Float64frombits(binary.LittleEndian.Uint64(shpData[off:]))
			points[i][1] = math.Float64frombits(binary.LittleEndian.Uint64(shpData[off+8:]))
			off += 16
		}

		// Split into parts
		parts := make([][]([2]float64), numParts)
		for i := range partStarts {
			start := partStarts[i]
			end := numPoints
			if i+1 < numParts {
				end = partStarts[i+1]
			}
			parts[i] = points[start:end]
		}

		var fields map[string]string
		if recIdx < len(dbfRecords) {
			fields = dbfRecords[recIdx]
		}

		result = append(result, ShapePolyLine{Parts: parts, Fields: fields})
		off = recEnd
		recIdx++
	}

	return result, nil
}

// parseDBF reads a dBASE III/IV file and returns records as string maps.
func parseDBF(data []byte) ([]map[string]string, error) {
	if len(data) < 32 {
		return nil, fmt.Errorf("dbf too short")
	}

	nRecords := int(binary.LittleEndian.Uint32(data[4:]))
	headerSize := int(binary.LittleEndian.Uint16(data[8:]))
	recordSize := int(binary.LittleEndian.Uint16(data[10:]))

	// Parse field descriptors (32 bytes each, starting at offset 32, terminated by 0x0D)
	type field struct {
		name string
		size int
	}
	var fields []field
	off := 32
	for off+32 <= headerSize && data[off] != 0x0D {
		name := strings.TrimRight(string(data[off:off+11]), "\x00")
		size := int(data[off+16])
		fields = append(fields, field{name, size})
		off += 32
	}

	records := make([]map[string]string, 0, nRecords)
	off = headerSize
	for i := 0; i < nRecords; i++ {
		if off+recordSize > len(data) {
			break
		}
		rec := make(map[string]string)
		pos := 1 // skip deletion flag
		for _, f := range fields {
			val := strings.TrimSpace(string(data[off+pos : off+pos+f.size]))
			rec[f.name] = val
			pos += f.size
		}
		records = append(records, rec)
		off += recordSize
	}

	return records, nil
}

// RoadDef defines a road type from RoadsLib.cfg.
type RoadDef struct {
	ID    int
	Width float64
	Map   string // "main road", "road", "track"
}

// ParseRoadsLib parses a RoadsLib.cfg file and returns road definitions keyed by ID.
func ParseRoadsLib(path string) (map[int]RoadDef, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	defs := make(map[int]RoadDef)
	lines := strings.Split(string(data), "\n")
	var currentID int
	var current RoadDef
	inClass := false

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "class Road") {
			// Extract road number from class name
			name := strings.TrimPrefix(line, "class Road")
			name = strings.TrimSpace(strings.TrimSuffix(name, "{"))
			name = strings.TrimPrefix(name, "0") // strip leading zeros
			name = strings.TrimPrefix(name, "0")
			name = strings.TrimPrefix(name, "0")
			if id, err := strconv.Atoi(name); err == nil {
				currentID = id
				current = RoadDef{ID: id}
				inClass = true
			}
			continue
		}
		if inClass && strings.Contains(line, "};") {
			defs[currentID] = current
			inClass = false
			continue
		}
		if !inClass {
			continue
		}
		// Parse key = value;
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		val := strings.TrimSpace(parts[1])
		val = strings.TrimSuffix(val, ";")
		val = strings.TrimSpace(val)

		switch key {
		case "width":
			if w, err := strconv.ParseFloat(val, 64); err == nil {
				current.Width = w
			}
		case "map":
			current.Map = strings.Trim(val, "\"")
		}
	}

	return defs, nil
}

// FindDataPBO finds the data PBO for a map PBO.
// Given "map_altis.pbo", looks for "map_altis_data.pbo" in the same directory.
func FindDataPBO(mapPBOPath string) (string, error) {
	dir := filepath.Dir(mapPBOPath)
	base := filepath.Base(mapPBOPath)
	name := strings.TrimSuffix(base, filepath.Ext(base))
	dataPBO := filepath.Join(dir, name+"_data.pbo")
	if _, err := os.Stat(dataPBO); err != nil {
		return "", fmt.Errorf("data PBO not found: %s", dataPBO)
	}
	return dataPBO, nil
}

// FindRoadsShapefile searches a directory tree for roads/roads.shp.
func FindRoadsShapefile(dir string) (string, error) {
	var found string
	err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() && strings.EqualFold(info.Name(), "roads.shp") {
			found = path
			return filepath.SkipAll
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	if found == "" {
		return "", fmt.Errorf("no roads.shp found in %s", dir)
	}
	return found, nil
}

// DetectShapefileOffset computes the X offset to convert shapefile coords to Arma world coords.
// Returns offsetX such that arma_x = shp_x - offsetX, arma_z = shp_y (no Y offset).
func DetectShapefileOffset(shapes []ShapePolyLine, worldSize int) float64 {
	if len(shapes) == 0 {
		return 0
	}

	// Find bounding box
	minX := math.Inf(1)
	maxX := math.Inf(-1)
	for _, s := range shapes {
		for _, part := range s.Parts {
			for _, pt := range part {
				if pt[0] < minX {
					minX = pt[0]
				}
				if pt[0] > maxX {
					maxX = pt[0]
				}
			}
		}
	}

	ws := float64(worldSize)
	// Valid offset range: maxX - ws <= offset <= minX
	// Pick the nearest multiple of 1000 within this range
	low := maxX - ws
	high := minX

	// Try multiples of 10000 first, then 1000, then 100
	for _, step := range []float64{10000, 1000, 100} {
		candidate := math.Floor(high/step) * step
		if candidate >= low && candidate <= high {
			return candidate
		}
	}

	// Fallback: midpoint
	return math.Floor((low + high) / 2)
}
