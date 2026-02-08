package maptool

import (
	"encoding/json"
	"fmt"
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

type MapInfo struct {
	Name       string    `json:"name"`
	WorldSize  int       `json:"worldSize,omitempty"`
	Status     MapStatus `json:"status"`
	HasPreview bool      `json:"hasPreview,omitempty"`
}

// fileExistsIn checks for a file in subdirectory first, then root.
func fileExistsIn(worldDir, subdir, filename string) bool {
	if _, err := os.Stat(filepath.Join(worldDir, subdir, filename)); err == nil {
		return true
	}
	if _, err := os.Stat(filepath.Join(worldDir, filename)); err == nil {
		return true
	}
	return false
}

func ScanMaps(mapsDir string) ([]MapInfo, error) {
	entries, err := os.ReadDir(mapsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read maps dir: %w", err)
	}

	var maps []MapInfo
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		worldDir := filepath.Join(mapsDir, entry.Name())
		info := MapInfo{Name: entry.Name()}

		hasSatellite := fileExistsIn(worldDir, "tiles", "satellite.pmtiles")
		hasFeatures := fileExistsIn(worldDir, "tiles", "features.pmtiles")
		hasStyle := fileExistsIn(worldDir, "styles", "color-relief.json")
		hasMapJSON := false

		mapJSONPath := filepath.Join(worldDir, "map.json")
		if data, err := os.ReadFile(mapJSONPath); err == nil {
			hasMapJSON = true
			var meta struct {
				WorldSize int `json:"worldSize"`
			}
			if json.Unmarshal(data, &meta) == nil {
				info.WorldSize = meta.WorldSize
			}
		}

		// Check for any preview thumbnail
		if _, err := os.Stat(filepath.Join(worldDir, "preview_256.png")); err == nil {
			info.HasPreview = true
		}

		found := 0
		for _, ok := range []bool{hasSatellite, hasFeatures, hasStyle, hasMapJSON} {
			if ok {
				found++
			}
		}

		switch {
		case found == 0:
			info.Status = MapStatusNone
		case found == 4:
			info.Status = MapStatusComplete
		default:
			info.Status = MapStatusIncomplete
		}

		maps = append(maps, info)
	}
	return maps, nil
}
