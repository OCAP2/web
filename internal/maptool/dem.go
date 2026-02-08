package maptool

import (
	"bufio"
	"compress/gzip"
	"fmt"
	"io"
	"math"
	"os"
	"strconv"
	"strings"
)

// DEMGrid holds a parsed ESRI ASCII Grid elevation dataset.
type DEMGrid struct {
	Cols      int
	Rows      int
	XllCorner float64 // X of lower-left pixel outer edge (always corner, converted from center if needed)
	YllCorner float64 // Y of lower-left pixel outer edge (always corner, converted from center if needed)
	CellSize  float64
	NoData    float64
	Data      []float32 // row-major, row 0 = south (flipped from ASC convention)
}

// ParseASCGrid parses an ESRI ASCII Grid from a reader.
// The ASC format has row 0 = north; this function flips rows so Data[0] = south edge,
// matching GenerateContours() which expects grid position (0,0) at the southwest corner.
func ParseASCGrid(r io.Reader) (*DEMGrid, error) {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024)

	grid := &DEMGrid{NoData: -9999}

	// Parse header
	headerKeys := map[string]bool{
		"ncols": true, "nrows": true, "xllcenter": true, "yllcenter": true,
		"xllcorner": true, "yllcorner": true, "cellsize": true, "nodata_value": true,
	}
	var xIsCenter, yIsCenter bool
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) < 2 {
			break
		}
		key := strings.ToLower(parts[0])
		if !headerKeys[key] {
			// First non-header line — put it back by processing below
			break
		}
		val, err := strconv.ParseFloat(parts[1], 64)
		if err != nil {
			return nil, fmt.Errorf("parse header %s: %w", key, err)
		}
		switch key {
		case "ncols":
			grid.Cols = int(val)
		case "nrows":
			grid.Rows = int(val)
		case "xllcenter":
			xIsCenter = true
			fallthrough
		case "xllcorner":
			grid.XllCorner = val
		case "yllcenter":
			yIsCenter = true
			fallthrough
		case "yllcorner":
			grid.YllCorner = val
		case "cellsize":
			grid.CellSize = val
		case "nodata_value":
			grid.NoData = val
		}
	}

	if grid.Cols <= 0 || grid.Rows <= 0 {
		return nil, fmt.Errorf("invalid grid dimensions: %dx%d", grid.Cols, grid.Rows)
	}
	if grid.CellSize <= 0 {
		return nil, fmt.Errorf("invalid cellsize: %v", grid.CellSize)
	}

	// Convert center coordinates to corner (outer edge) for consistent handling.
	// xllcenter refers to the center of the lower-left pixel; corner is half a cell left/below.
	if xIsCenter {
		grid.XllCorner -= grid.CellSize / 2
	}
	if yIsCenter {
		grid.YllCorner -= grid.CellSize / 2
	}

	// Parse data rows (ASC row 0 = north, last row = south)
	grid.Data = make([]float32, grid.Cols*grid.Rows)
	noData := float32(grid.NoData)

	// We read rows from north to south (ASC order) and store them flipped
	row := grid.Rows - 1 // first ASC row → last in our array
	col := 0

	// Process the line that broke the header loop
	processLine := func(line string) error {
		fields := strings.Fields(line)
		for _, f := range fields {
			if row < 0 {
				return nil // extra data, ignore
			}
			v, err := strconv.ParseFloat(f, 32)
			if err != nil {
				return fmt.Errorf("parse value at row %d col %d: %w", grid.Rows-1-row, col, err)
			}
			fv := float32(v)
			if math.IsNaN(float64(fv)) || fv == noData {
				fv = 0
			}
			grid.Data[row*grid.Cols+col] = fv
			col++
			if col >= grid.Cols {
				col = 0
				row--
			}
		}
		return nil
	}

	// Process the current scanner line (already scanned above)
	line := strings.TrimSpace(scanner.Text())
	if line != "" {
		// Check if this line looks like data (starts with a number)
		parts := strings.Fields(line)
		if len(parts) > 0 {
			if _, err := strconv.ParseFloat(parts[0], 64); err == nil {
				if err := processLine(line); err != nil {
					return nil, err
				}
			}
		}
	}

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		if err := processLine(line); err != nil {
			return nil, err
		}
	}

	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("scan: %w", err)
	}

	return grid, nil
}

// ParseASCGridGz reads and parses a gzipped ESRI ASCII Grid file.
func ParseASCGridGz(path string) (*DEMGrid, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	defer f.Close()

	gz, err := gzip.NewReader(f)
	if err != nil {
		return nil, fmt.Errorf("gzip reader: %w", err)
	}
	defer gz.Close()

	return ParseASCGrid(gz)
}
