package maptool

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

// NewGenerateVectorTilesStage creates an optional pipeline stage that extracts vector features
// from the WRP terrain file and produces vector.pmtiles via tippecanoe.
func NewGenerateVectorTilesStage(tools ToolSet) Stage {
	return Stage{
		Name:     "generate_vector_tiles",
		Optional: true,
		Run: func(ctx context.Context, job *Job) error {
			// Check tippecanoe availability
			var tippeTool Tool
			for _, t := range tools {
				if t.Name == "tippecanoe" && t.Found {
					tippeTool = t
					break
				}
			}
			if !tippeTool.Found {
				return fmt.Errorf("tippecanoe not found")
			}

			// Parse WRP for vector features
			log.Printf("Parsing WRP for vector features: %s", job.WRPPath)
			wrpData, err := ReadWRPData(job.WRPPath)
			if err != nil {
				return fmt.Errorf("parse WRP: %w", err)
			}

			tmpDir := filepath.Join(job.TempDir, "vector")
			if err := os.MkdirAll(tmpDir, 0755); err != nil {
				return fmt.Errorf("create vector temp dir: %w", err)
			}

			hdr := wrpData.Header
			cellSize := float64(hdr.WorldSize()) / float64(hdr.MapSizeX-1)
			var geojsonFiles []string

			// Generate contour lines
			if len(wrpData.Elevation) > 0 {
				log.Printf("Generating contour lines (grid %dx%d, cellSize=%.1fm)",
					hdr.MapSizeX, hdr.MapSizeY, cellSize)
				contours := GenerateContours(
					wrpData.Elevation,
					int(hdr.MapSizeX), int(hdr.MapSizeY),
					cellSize,
					50, 10, // major every 50m, minor every 10m
				)
				if len(contours) > 0 {
					path := filepath.Join(tmpDir, "contours.geojson")
					if err := WriteGeoJSON(path, FeatureCollection{Type: "FeatureCollection", Features: contours}); err != nil {
						return fmt.Errorf("write contours: %w", err)
					}
					log.Printf("Generated %d contour features", len(contours))
					geojsonFiles = append(geojsonFiles, path)
				}
			}

			// Extract buildings from objects
			if len(wrpData.Objects) > 0 && len(wrpData.Models) > 0 {
				var buildings []Feature
				for _, obj := range wrpData.Objects {
					if int(obj.ModelIndex) >= len(wrpData.Models) {
						continue
					}
					modelPath := wrpData.Models[obj.ModelIndex]
					if ClassifyModel(modelPath) != "building" {
						continue
					}
					pos := obj.Position()
					coord := armaToGeoJSON(float64(pos[0]), float64(pos[2]))
					buildings = append(buildings, Feature{
						Type: "Feature",
						Geometry: Geometry{
							Type:        "Point",
							Coordinates: coord,
						},
						Properties: map[string]interface{}{
							"type":  "building",
							"model": filepath.Base(modelPath),
						},
					})
				}
				if len(buildings) > 0 {
					path := filepath.Join(tmpDir, "buildings.geojson")
					if err := WriteGeoJSON(path, FeatureCollection{Type: "FeatureCollection", Features: buildings}); err != nil {
						return fmt.Errorf("write buildings: %w", err)
					}
					log.Printf("Generated %d building features", len(buildings))
					geojsonFiles = append(geojsonFiles, path)
				}
			}

			// Extract roads from shapefile (data PBO) + bridges from RoadNet
			roads := extractRoadsFromShapefile(ctx, tools, job, hdr.WorldSize())
			roads = append(roads, extractRoadsFromRoadNet(wrpData)...)
			if len(roads) > 0 {
				path := filepath.Join(tmpDir, "roads.geojson")
				if err := WriteGeoJSON(path, FeatureCollection{Type: "FeatureCollection", Features: roads}); err != nil {
					return fmt.Errorf("write roads: %w", err)
				}
				log.Printf("Generated %d road features", len(roads))
				geojsonFiles = append(geojsonFiles, path)
			}

			if len(geojsonFiles) == 0 {
				return fmt.Errorf("no vector features extracted")
			}

			// Run tippecanoe
			outputPath := filepath.Join(job.OutputDir, "vector.pmtiles")
			args := []string{
				"-o", outputPath,
				"--force",
				"--minimum-zoom=10",
				"--maximum-zoom=16",
			}
			for _, f := range geojsonFiles {
				name := strings.TrimSuffix(filepath.Base(f), ".geojson")
				args = append(args, fmt.Sprintf("--named-layer=%s:%s", name, f))
			}

			log.Printf("Running tippecanoe with %d layers", len(geojsonFiles))
			cmd := exec.CommandContext(ctx, tippeTool.Path, args...)
			cmd.Stdout = os.Stdout
			cmd.Stderr = os.Stderr
			if err := cmd.Run(); err != nil {
				return fmt.Errorf("tippecanoe: %w", err)
			}

			job.HasVector = true
			log.Printf("Generated vector.pmtiles at %s", outputPath)
			return nil
		},
	}
}

// extractRoadsFromShapefile extracts road features from the data PBO's roads.shp.
// Returns nil if the data PBO or shapefile is not available.
func extractRoadsFromShapefile(ctx context.Context, tools ToolSet, job *Job, worldSize int) []Feature {
	dataPBO, err := FindDataPBO(job.InputPath)
	if err != nil {
		log.Printf("Data PBO not found, skipping shapefile roads: %v", err)
		return nil
	}

	dataDir := filepath.Join(job.TempDir, "data_pbo")
	if err := ExtractPBO(ctx, tools, dataPBO, dataDir); err != nil {
		log.Printf("Failed to extract data PBO: %v", err)
		return nil
	}

	shpPath, err := FindRoadsShapefile(dataDir)
	if err != nil {
		log.Printf("No roads.shp in data PBO: %v", err)
		return nil
	}

	shapes, err := ReadRoadsShapefile(shpPath)
	if err != nil {
		log.Printf("Failed to read roads shapefile: %v", err)
		return nil
	}
	if len(shapes) == 0 {
		return nil
	}

	// Parse RoadsLib.cfg for road type definitions
	roadsLibPath := filepath.Join(filepath.Dir(shpPath), "RoadsLib.cfg")
	roadDefs, _ := ParseRoadsLib(roadsLibPath) // ok if missing

	// Detect coordinate offset
	offsetX := DetectShapefileOffset(shapes, worldSize)
	log.Printf("Roads shapefile: %d polylines, X offset=%.0f", len(shapes), offsetX)

	var features []Feature
	for _, shape := range shapes {
		// Get road type from ID field + RoadsLib.cfg
		roadType := "road"
		width := 8.0
		if idStr, ok := shape.Fields["ID"]; ok {
			if id, err := strconv.Atoi(idStr); err == nil {
				if def, ok := roadDefs[id]; ok {
					roadType = def.Map
					width = def.Width
				}
			}
		}

		for _, part := range shape.Parts {
			if len(part) < 2 {
				continue
			}
			coords := make([][2]float64, len(part))
			for i, pt := range part {
				armaX := pt[0] - offsetX
				armaZ := pt[1]
				coords[i] = armaToGeoJSON(armaX, armaZ)
			}
			features = append(features, Feature{
				Type: "Feature",
				Geometry: Geometry{
					Type:        "LineString",
					Coordinates: coords,
				},
				Properties: map[string]interface{}{
					"type":  roadType,
					"width": width,
				},
			})
		}
	}

	return features
}

// extractRoadsFromRoadNet extracts road features from WRP RoadNet (bridges, piers).
func extractRoadsFromRoadNet(wrpData *WRPData) []Feature {
	if len(wrpData.RoadParts) == 0 {
		return nil
	}

	var roads []Feature
	for _, part := range wrpData.RoadParts {
		roadType, width := classifyRoad(part.P3DPath)
		if roadType == "" {
			continue
		}
		if len(part.Positions) < 2 {
			continue
		}
		coords := make([][2]float64, len(part.Positions))
		for i, pos := range part.Positions {
			coords[i] = armaToGeoJSON(float64(pos[0]), float64(pos[2]))
		}
		roads = append(roads, Feature{
			Type: "Feature",
			Geometry: Geometry{
				Type:        "LineString",
				Coordinates: coords,
			},
			Properties: map[string]interface{}{
				"type":  roadType,
				"width": width,
			},
		})
	}
	return roads
}

// classifyRoad categorizes a road P3D path into a type and approximate width.
// Returns empty type for invisible/clutter models that should be filtered out.
func classifyRoad(p3dPath string) (string, int) {
	lower := strings.ToLower(p3dPath)

	// Filter out invisible AI pathfinding surfaces
	if strings.Contains(lower, "invisible") || strings.Contains(lower, "clutter") {
		return "", 0
	}

	switch {
	case strings.Contains(lower, "bridge"):
		return "bridge", 8
	case strings.Contains(lower, "pier"):
		return "pier", 4
	case strings.Contains(lower, "asphalt"):
		w := 8
		if strings.Contains(lower, "4m") {
			w = 4
		} else if strings.Contains(lower, "6m") {
			w = 6
		} else if strings.Contains(lower, "8m") {
			w = 8
		}
		return "paved", w
	case strings.Contains(lower, "gravel"):
		return "gravel", 4
	case strings.Contains(lower, "dirt") || strings.Contains(lower, "track"):
		return "track", 3
	default:
		return "road", 4
	}
}

// roadCenter is a road piece center position with classification.
type roadCenter struct {
	x, z     float64
	roadType string
	width    int
}

// roadChain is a polyline built from chained road centers.
type roadChain struct {
	points   [][2]float64 // (x, z) world coordinates
	roadType string
	width    int
}

// chainRoadCenters chains nearby road piece centers into polylines.
// maxDist is the maximum distance (meters) between consecutive centers.
func chainRoadCenters(centers []roadCenter, maxDist float64) []roadChain {
	if len(centers) == 0 {
		return nil
	}

	// Spatial grid for fast neighbor lookup
	cellSize := maxDist
	type gridKey struct{ cx, cy int }
	grid := make(map[gridKey][]int)
	for i, c := range centers {
		gx := int(c.x / cellSize)
		gz := int(c.z / cellSize)
		grid[gridKey{gx, gz}] = append(grid[gridKey{gx, gz}], i)
	}

	findNearest := func(x, z float64, used []bool, roadType string) int {
		gx := int(x / cellSize)
		gz := int(z / cellSize)
		bestIdx := -1
		bestDist := maxDist * maxDist
		for dx := -1; dx <= 1; dx++ {
			for dz := -1; dz <= 1; dz++ {
				for _, idx := range grid[gridKey{gx + dx, gz + dz}] {
					if used[idx] || centers[idx].roadType != roadType {
						continue
					}
					ddx := centers[idx].x - x
					ddz := centers[idx].z - z
					d2 := ddx*ddx + ddz*ddz
					if d2 < bestDist {
						bestDist = d2
						bestIdx = idx
					}
				}
			}
		}
		return bestIdx
	}

	used := make([]bool, len(centers))
	var chains []roadChain

	for i, c := range centers {
		if used[i] {
			continue
		}
		used[i] = true

		chain := roadChain{
			points:   [][2]float64{{c.x, c.z}},
			roadType: c.roadType,
			width:    c.width,
		}

		// Extend forward
		for {
			last := chain.points[len(chain.points)-1]
			next := findNearest(last[0], last[1], used, c.roadType)
			if next < 0 {
				break
			}
			used[next] = true
			chain.points = append(chain.points, [2]float64{centers[next].x, centers[next].z})
		}

		// Extend backward
		for {
			first := chain.points[0]
			prev := findNearest(first[0], first[1], used, c.roadType)
			if prev < 0 {
				break
			}
			used[prev] = true
			chain.points = append([][2]float64{{centers[prev].x, centers[prev].z}}, chain.points...)
		}

		chains = append(chains, chain)
	}

	return chains
}
