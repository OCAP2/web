package maptool

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
)

// GradMehMeta holds metadata from a grad_meh meta.json export.
type GradMehMeta struct {
	Author      string  `json:"author"`
	DisplayName string  `json:"displayName"`
	WorldName   string  `json:"worldName"`
	WorldSize   float64 `json:"worldSize"`
	Latitude    float64 `json:"latitude"`
	Longitude   float64 `json:"longitude"`
	Version     string  `json:"version"`
}

// ReadGradMehMeta reads and parses a grad_meh meta.json file.
func ReadGradMehMeta(dir string) (GradMehMeta, error) {
	data, err := os.ReadFile(filepath.Join(dir, "meta.json"))
	if err != nil {
		return GradMehMeta{}, fmt.Errorf("read meta.json: %w", err)
	}
	var meta GradMehMeta
	if err := json.Unmarshal(data, &meta); err != nil {
		return GradMehMeta{}, fmt.Errorf("parse meta.json: %w", err)
	}
	if meta.WorldName == "" {
		return GradMehMeta{}, fmt.Errorf("meta.json: worldName is empty")
	}
	if meta.WorldSize <= 0 {
		return GradMehMeta{}, fmt.Errorf("meta.json: worldSize must be positive, got %v", meta.WorldSize)
	}
	meta.WorldName = strings.ToLower(meta.WorldName)
	if !isSafeWorldName(meta.WorldName) {
		return GradMehMeta{}, fmt.Errorf("meta.json: worldName %q is not a safe directory name", meta.WorldName)
	}
	return meta, nil
}

// isSafeWorldName reports whether name is safe to use as a single-segment
// directory name. It rejects path separators, traversal segments, and any
// characters outside [a-z0-9_-].
func isSafeWorldName(name string) bool {
	if name == "" || name == "." || name == ".." {
		return false
	}
	if filepath.Base(name) != name {
		return false
	}
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z':
		case r >= '0' && r <= '9':
		case r == '_' || r == '-':
		default:
			return false
		}
	}
	return true
}

// ValidateGradMehDir checks that a directory contains a valid grad_meh export.
func ValidateGradMehDir(dir string) error {
	info, err := os.Stat(dir)
	if err != nil {
		return fmt.Errorf("stat dir: %w", err)
	}
	if !info.IsDir() {
		return fmt.Errorf("%s is not a directory", dir)
	}
	if _, err := os.Stat(filepath.Join(dir, "meta.json")); err != nil {
		return fmt.Errorf("meta.json not found: %w", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "sat")); err != nil {
		return fmt.Errorf("sat/ directory not found: %w", err)
	}
	return nil
}

// WorldNameFromDir returns the lowercased basename of a directory.
func WorldNameFromDir(dir string) string {
	return strings.ToLower(filepath.Base(dir))
}

// NewParseGradMehStage creates a pipeline stage that reads grad_meh metadata
// and populates job fields.
func NewParseGradMehStage() Stage {
	return Stage{
		Name: "parse_gradmeh",
		Run: func(ctx context.Context, job *Job) error {
			if err := ValidateGradMehDir(job.InputPath); err != nil {
				return fmt.Errorf("validate grad_meh dir: %w", err)
			}
			meta, err := ReadGradMehMeta(job.InputPath)
			if err != nil {
				return err
			}
			job.WorldName = meta.WorldName
			job.WorldSize = int(meta.WorldSize)
			job.GradMehMeta = &meta
			log.Printf("grad_meh world: %s (%s), size: %d meters",
				meta.DisplayName, meta.WorldName, job.WorldSize)
			return nil
		},
	}
}
