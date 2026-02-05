package maptool

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
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

			// Extract road network
			if len(wrpData.RoadParts) > 0 {
				var roads []Feature
				for _, part := range wrpData.RoadParts {
					if len(part.Positions) < 2 {
						continue
					}
					coords := make([][2]float64, len(part.Positions))
					for i, pos := range part.Positions {
						coords[i] = armaToGeoJSON(float64(pos[0]), float64(pos[2]))
					}
					roadType, width := classifyRoad(part.P3DPath)
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
				if len(roads) > 0 {
					path := filepath.Join(tmpDir, "roads.geojson")
					if err := WriteGeoJSON(path, FeatureCollection{Type: "FeatureCollection", Features: roads}); err != nil {
						return fmt.Errorf("write roads: %w", err)
					}
					log.Printf("Generated %d road features", len(roads))
					geojsonFiles = append(geojsonFiles, path)
				}
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

// classifyRoad categorizes a road P3D path into a type and approximate width.
func classifyRoad(p3dPath string) (string, int) {
	lower := strings.ToLower(p3dPath)
	switch {
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
