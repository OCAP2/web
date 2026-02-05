package maptool

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// WorldNameFromPBO extracts the world name from a PBO filename.
// Strips common prefixes like "map_", "A3_map_", etc.
func WorldNameFromPBO(pboPath string) string {
	name := filepath.Base(pboPath)
	name = strings.TrimSuffix(name, filepath.Ext(name))
	for _, prefix := range []string{"A3_map_", "a3_map_", "map_"} {
		name = strings.TrimPrefix(name, prefix)
	}
	return strings.ToLower(name)
}

// FindWRP finds the first .wrp file in a directory tree.
func FindWRP(dir string) (string, error) {
	var found string
	err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() && strings.EqualFold(filepath.Ext(path), ".wrp") {
			found = path
			return filepath.SkipAll
		}
		return nil
	})
	if err != nil {
		return "", fmt.Errorf("walking directory: %w", err)
	}
	if found == "" {
		return "", fmt.Errorf("no .wrp file found in %s", dir)
	}
	return found, nil
}

// ExtractPBO extracts a PBO file to the given output directory using an available tool.
func ExtractPBO(ctx context.Context, tools ToolSet, pboPath, outputDir string) error {
	if err := os.MkdirAll(outputDir, 0755); err != nil {
		return fmt.Errorf("create output dir: %w", err)
	}

	var depboTool Tool
	for _, t := range tools {
		if t.Name == "depbo" && t.Found {
			depboTool = t
			break
		}
	}
	if !depboTool.Found {
		return fmt.Errorf("no PBO extraction tool found (need depbo, extractpbo, or pboproject)")
	}

	bin := filepath.Base(depboTool.Path)
	var cmd *exec.Cmd
	switch {
	case strings.Contains(bin, "extractpbo"):
		cmd = exec.CommandContext(ctx, depboTool.Path, "-P", pboPath, outputDir)
	case strings.Contains(bin, "depbo"):
		cmd = exec.CommandContext(ctx, depboTool.Path, "-P", pboPath, "-o", outputDir)
	default:
		cmd = exec.CommandContext(ctx, depboTool.Path, "-P", pboPath, outputDir)
	}

	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("extract PBO with %s: %w", bin, err)
	}
	return nil
}

// NewExtractPBOStage creates a pipeline stage that extracts a PBO.
func NewExtractPBOStage(tools ToolSet) Stage {
	return Stage{
		Name: "extract_pbo",
		Run: func(ctx context.Context, job *Job) error {
			if err := ExtractPBO(ctx, tools, job.InputPath, job.TempDir); err != nil {
				return err
			}
			wrpPath, err := FindWRP(job.TempDir)
			if err != nil {
				return err
			}
			job.WRPPath = wrpPath
			return nil
		},
	}
}
