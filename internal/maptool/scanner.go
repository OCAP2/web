package maptool

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
)

// MapStatus represents the completeness of a map's generated files.
type MapStatus string

const (
	MapStatusNone       MapStatus = "none"
	MapStatusIncomplete MapStatus = "incomplete"
	MapStatusComplete   MapStatus = "complete"
)

type MapElevation struct {
	Min    float64 `json:"min"`
	Max    float64 `json:"max"`
	Avg    float64 `json:"avg"`
	StdDev float64 `json:"stddev"`
}

type MapInfo struct {
	Name          string             `json:"name"`
	WorldSize     int                `json:"worldSize,omitempty"`
	Status        MapStatus          `json:"status"`
	HasPreview    bool               `json:"hasPreview,omitempty"`
	Elevation     *MapElevation      `json:"elevation,omitempty"`
	FeatureLayers []string           `json:"featureLayers,omitempty"`
	Files         map[string]float64 `json:"files,omitempty"`
}

// fileSizeIn checks for a file in subdirectory first, then root.
// Returns the size in MB and true if found, or 0 and false if not.
func fileSizeIn(worldDir, subdir, filename string) (float64, bool) {
	for _, dir := range []string{filepath.Join(worldDir, subdir), worldDir} {
		if fi, err := os.Stat(filepath.Join(dir, filename)); err == nil {
			return float64(fi.Size()) / (1024 * 1024), true
		}
	}
	return 0, false
}

func ScanMaps(mapsDir string) ([]MapInfo, error) {
	entries, err := os.ReadDir(mapsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read maps dir: %w", err)
	}

	type fileCheck struct {
		name   string
		subdir string
	}
	// Critical files determine map status (complete/incomplete/none).
	criticalFiles := []fileCheck{
		{"satellite.pmtiles", "tiles"},
		{"features.pmtiles", "tiles"},
		{"color-relief.json", "styles"},
		{"map.json", ""},
	}
	// Additional files to report sizes for.
	extraFiles := []fileCheck{
		{"heightmap.pmtiles", "tiles"},
		{"hillshade.pmtiles", "tiles"},
		{"color-relief.pmtiles", "tiles"},
	}

	var maps []MapInfo
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		worldDir := filepath.Join(mapsDir, entry.Name())
		info := MapInfo{Name: entry.Name(), Files: make(map[string]float64)}

		found := 0
		for _, fc := range criticalFiles {
			if sizeMB, ok := fileSizeIn(worldDir, fc.subdir, fc.name); ok {
				found++
				info.Files[fc.name] = math.Round(sizeMB*100) / 100
			}
		}
		for _, fc := range extraFiles {
			if sizeMB, ok := fileSizeIn(worldDir, fc.subdir, fc.name); ok {
				info.Files[fc.name] = math.Round(sizeMB*100) / 100
			}
		}

		// meta.json (pipeline output) is the primary source — has worldSize,
		// featureLayers, and elevation stats.
		metaJSONPath := filepath.Join(worldDir, "meta.json")
		if data, err := os.ReadFile(metaJSONPath); err == nil {
			var meta struct {
				WorldSize     int             `json:"worldSize"`
				FeatureLayers []string        `json:"featureLayers"`
				Elevation     *MapElevation   `json:"elevation"`
			}
			if json.Unmarshal(data, &meta) == nil {
				info.WorldSize = meta.WorldSize
				info.FeatureLayers = meta.FeatureLayers
				info.Elevation = meta.Elevation
			}
		}
		// Fallback to map.json for worldSize if meta.json didn't provide it.
		if info.WorldSize == 0 {
			mapJSONPath := filepath.Join(worldDir, "map.json")
			if data, err := os.ReadFile(mapJSONPath); err == nil {
				var mj struct {
					WorldSize int `json:"worldSize"`
				}
				if json.Unmarshal(data, &mj) == nil {
					info.WorldSize = mj.WorldSize
				}
			}
		}

		// Check for any preview thumbnail.
		if _, err := os.Stat(filepath.Join(worldDir, "preview_256.png")); err == nil {
			info.HasPreview = true
		}

		switch {
		case found == 0:
			info.Status = MapStatusNone
		case found == len(criticalFiles):
			info.Status = MapStatusComplete
		default:
			info.Status = MapStatusIncomplete
		}

		if len(info.Files) == 0 {
			info.Files = nil
		}

		maps = append(maps, info)
	}
	return maps, nil
}
