package maptool

import "math"

// GenerateContours generates contour line features from an elevation grid using marching squares.
// gridW, gridH are the grid dimensions; cellSize is meters per grid cell.
// majorInterval and minorInterval specify contour spacing in meters.
func GenerateContours(elevation []float32, gridW, gridH int, cellSize float64, majorInterval, minorInterval float64) []Feature {
	if len(elevation) != gridW*gridH {
		return nil
	}

	// Find elevation range
	minElev, maxElev := float64(math.MaxFloat32), float64(-math.MaxFloat32)
	for _, e := range elevation {
		v := float64(e)
		if v < minElev {
			minElev = v
		}
		if v > maxElev {
			maxElev = v
		}
	}

	// Generate contour levels at minorInterval spacing
	startLevel := math.Ceil(minElev/minorInterval) * minorInterval
	var features []Feature

	for level := startLevel; level <= maxElev; level += minorInterval {
		if level <= 0 {
			continue // skip sea level and below
		}
		lines := marchingSquares(elevation, gridW, gridH, cellSize, level)
		if len(lines) == 0 {
			continue
		}

		contourType := "minor"
		if math.Mod(level, majorInterval) < 0.01 || math.Mod(level, majorInterval) > majorInterval-0.01 {
			contourType = "major"
		}

		for _, line := range lines {
			if len(line) < 2 {
				continue
			}
			coords := make([][2]float64, len(line))
			for i, pt := range line {
				coords[i] = armaToGeoJSON(pt[0], pt[1])
			}
			features = append(features, Feature{
				Type: "Feature",
				Geometry: Geometry{
					Type:        "LineString",
					Coordinates: coords,
				},
				Properties: map[string]interface{}{
					"elevation": level,
					"type":      contourType,
				},
			})
		}
	}
	return features
}

// marchingSquares traces contour lines at the given level through the elevation grid.
// Returns a slice of polylines, each being a sequence of (x, z) world coordinates.
func marchingSquares(grid []float32, w, h int, cellSize, level float64) [][][2]float64 {
	var segments [][2][2]float64

	for row := 0; row < h-1; row++ {
		for col := 0; col < w-1; col++ {
			// Cell corners (grid Y=0 is south in Arma elevation grids)
			bl := float64(grid[row*w+col])
			br := float64(grid[row*w+col+1])
			tr := float64(grid[(row+1)*w+col+1])
			tl := float64(grid[(row+1)*w+col])

			// World coordinates: X=east (col), Z=north (row)
			x0 := float64(col) * cellSize
			x1 := float64(col+1) * cellSize
			z0 := float64(row) * cellSize
			z1 := float64(row+1) * cellSize

			caseIndex := 0
			if bl >= level {
				caseIndex |= 1
			}
			if br >= level {
				caseIndex |= 2
			}
			if tr >= level {
				caseIndex |= 4
			}
			if tl >= level {
				caseIndex |= 8
			}

			if caseIndex == 0 || caseIndex == 15 {
				continue
			}

			lerp := func(v1, v2, a, b float64) float64 {
				if v2 == v1 {
					return (a + b) / 2
				}
				t := (level - v1) / (v2 - v1)
				return a + t*(b-a)
			}

			bottom := [2]float64{lerp(bl, br, x0, x1), z0}
			right := [2]float64{x1, lerp(br, tr, z0, z1)}
			top := [2]float64{lerp(tl, tr, x0, x1), z1}
			left := [2]float64{x0, lerp(bl, tl, z0, z1)}

			switch caseIndex {
			case 1:
				segments = append(segments, [2][2]float64{bottom, left})
			case 2:
				segments = append(segments, [2][2]float64{right, bottom})
			case 3:
				segments = append(segments, [2][2]float64{right, left})
			case 4:
				segments = append(segments, [2][2]float64{top, right})
			case 5:
				avg := (bl + br + tr + tl) / 4
				if avg >= level {
					segments = append(segments, [2][2]float64{top, left})
					segments = append(segments, [2][2]float64{bottom, right})
				} else {
					segments = append(segments, [2][2]float64{bottom, left})
					segments = append(segments, [2][2]float64{top, right})
				}
			case 6:
				segments = append(segments, [2][2]float64{top, bottom})
			case 7:
				segments = append(segments, [2][2]float64{top, left})
			case 8:
				segments = append(segments, [2][2]float64{left, top})
			case 9:
				segments = append(segments, [2][2]float64{bottom, top})
			case 10:
				avg := (bl + br + tr + tl) / 4
				if avg >= level {
					segments = append(segments, [2][2]float64{bottom, right})
					segments = append(segments, [2][2]float64{top, left})
				} else {
					segments = append(segments, [2][2]float64{right, bottom})
					segments = append(segments, [2][2]float64{left, top})
				}
			case 11:
				segments = append(segments, [2][2]float64{right, top})
			case 12:
				segments = append(segments, [2][2]float64{left, right})
			case 13:
				segments = append(segments, [2][2]float64{bottom, right})
			case 14:
				segments = append(segments, [2][2]float64{left, bottom})
			}
		}
	}

	return chainSegments(segments)
}

// chainSegments joins line segments that share endpoints into polylines.
func chainSegments(segments [][2][2]float64) [][][2]float64 {
	if len(segments) == 0 {
		return nil
	}

	const precision = 0.001 // meters
	type key struct{ x, y int64 }
	pointKey := func(p [2]float64) key {
		return key{int64(p[0] / precision), int64(p[1] / precision)}
	}

	adj := make(map[key][]int)
	used := make([]bool, len(segments))

	for i, seg := range segments {
		ka := pointKey(seg[0])
		kb := pointKey(seg[1])
		adj[ka] = append(adj[ka], i)
		adj[kb] = append(adj[kb], i)
	}

	var polylines [][][2]float64

	for i := range segments {
		if used[i] {
			continue
		}
		used[i] = true

		line := [][2]float64{segments[i][0], segments[i][1]}

		// Extend forward
		for {
			k := pointKey(line[len(line)-1])
			found := false
			for _, idx := range adj[k] {
				if used[idx] {
					continue
				}
				used[idx] = true
				seg := segments[idx]
				if pointKey(seg[0]) == k {
					line = append(line, seg[1])
				} else {
					line = append(line, seg[0])
				}
				found = true
				break
			}
			if !found {
				break
			}
		}

		// Extend backward
		for {
			k := pointKey(line[0])
			found := false
			for _, idx := range adj[k] {
				if used[idx] {
					continue
				}
				used[idx] = true
				seg := segments[idx]
				var newPt [2]float64
				if pointKey(seg[0]) == k {
					newPt = seg[1]
				} else {
					newPt = seg[0]
				}
				line = append([][2]float64{newPt}, line...)
				found = true
				break
			}
			if !found {
				break
			}
		}

		polylines = append(polylines, line)
	}

	return polylines
}
