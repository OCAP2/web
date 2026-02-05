package maptool

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

type MapInfo struct {
	Name       string `json:"name"`
	WorldSize  int    `json:"worldSize,omitempty"`
	HasPMTiles bool   `json:"hasPmtiles"`
	HasVector  bool   `json:"hasVector"`
	HasStyle   bool   `json:"hasStyle"`
	HasMapJSON bool   `json:"hasMapJson"`
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

		if _, err := os.Stat(filepath.Join(worldDir, "topo.pmtiles")); err == nil {
			info.HasPMTiles = true
		}
		if _, err := os.Stat(filepath.Join(worldDir, "vector.pmtiles")); err == nil {
			info.HasVector = true
		}
		if _, err := os.Stat(filepath.Join(worldDir, "style.json")); err == nil {
			info.HasStyle = true
		}

		mapJSONPath := filepath.Join(worldDir, "map.json")
		if data, err := os.ReadFile(mapJSONPath); err == nil {
			info.HasMapJSON = true
			var meta struct {
				WorldSize int `json:"worldSize"`
			}
			if json.Unmarshal(data, &meta) == nil {
				info.WorldSize = meta.WorldSize
			}
		}

		maps = append(maps, info)
	}
	return maps, nil
}
