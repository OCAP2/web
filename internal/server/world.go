package server

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// WorldInfo holds public metadata about an installed map world.
type WorldInfo struct {
	Name        string `json:"name"`
	DisplayName string `json:"displayName"`
}

// ScanWorlds reads installed map directories and resolves display names.
// Resolution order: meta.json displayName -> map.json displayName -> directory name.
func ScanWorlds(mapsDir string) ([]WorldInfo, error) {
	entries, err := os.ReadDir(mapsDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []WorldInfo{}, nil
		}
		return nil, err
	}

	var worlds []WorldInfo
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		name := entry.Name()
		displayName := resolveDisplayName(filepath.Join(mapsDir, name), name)
		worlds = append(worlds, WorldInfo{Name: name, DisplayName: displayName})
	}
	return worlds, nil
}

// resolveDisplayName tries meta.json, then map.json, then falls back to dirName.
func resolveDisplayName(worldDir, dirName string) string {
	type nameHolder struct {
		DisplayName string `json:"displayName"`
	}

	// Try meta.json first
	if data, err := os.ReadFile(filepath.Join(worldDir, "meta.json")); err == nil {
		var h nameHolder
		if json.Unmarshal(data, &h) == nil && h.DisplayName != "" {
			return h.DisplayName
		}
	}

	// Try map.json
	if data, err := os.ReadFile(filepath.Join(worldDir, "map.json")); err == nil {
		var h nameHolder
		if json.Unmarshal(data, &h) == nil && h.DisplayName != "" {
			return h.DisplayName
		}
	}

	return dirName
}
