package maptoolcli

import (
	"context"
	"fmt"
	"os"

	"github.com/OCAP2/web/internal/maptool"
)

// renderFunc is the per-input rendering callback used by the orchestration loop.
// Returns the resolved world name (used for summary reporting) and an error.
type renderFunc func(ctx context.Context, inputZip, outDir string, fm formatter) (worldName string, err error)

// realRender is the production renderFunc that drives the real pipeline.
func realRender(tools maptool.ToolSet) renderFunc {
	return func(ctx context.Context, inputZip, outDir string, fm formatter) (string, error) {
		extractDir, err := os.MkdirTemp("", "ocap-maptool-cli-")
		if err != nil {
			return "", fmt.Errorf("create extract dir: %w", err)
		}
		defer os.RemoveAll(extractDir)

		if err := maptool.ExtractZip(inputZip, extractDir); err != nil {
			return "", fmt.Errorf("extract zip: %w", err)
		}

		gradMehDir, err := maptool.FindGradMehDir(extractDir)
		if err != nil {
			return "", fmt.Errorf("locate grad_meh dir: %w", err)
		}

		meta, err := maptool.ReadGradMehMeta(gradMehDir)
		if err != nil {
			return "", fmt.Errorf("read grad_meh meta: %w", err)
		}
		world := meta.WorldName

		if err := os.MkdirAll(outDir, 0755); err != nil {
			return world, fmt.Errorf("create output dir: %w", err)
		}
		tempDir, err := os.MkdirTemp("", "ocap-maptool-cli-work-")
		if err != nil {
			return world, fmt.Errorf("create temp dir: %w", err)
		}
		defer os.RemoveAll(tempDir)

		job := &maptool.Job{
			ID:        fmt.Sprintf("cli-%s", world),
			WorldName: world,
			InputPath: gradMehDir,
			OutputDir: outDir,
			TempDir:   tempDir,
			Status:    maptool.StatusPending,
			SubDirs:   true,
		}

		pipeline := maptool.BuildGradMehPipeline(tools)
		pipeline.OnProgress = func(p maptool.Progress) {
			fm.Stage(world, p.Stage, p.StageNum, p.TotalStages)
		}

		job.Start()
		if err := pipeline.Run(ctx, job); err != nil {
			return world, fmt.Errorf("pipeline: %w", err)
		}
		return world, nil
	}
}

// publishPartial atomically renames the partial dir to its final name.
// If the final dir exists (force re-render path), it is removed first.
func publishPartial(partialDir, finalDir string) error {
	if _, err := os.Stat(finalDir); err == nil {
		if err := os.RemoveAll(finalDir); err != nil {
			return fmt.Errorf("remove existing final dir: %w", err)
		}
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("stat final dir: %w", err)
	}
	if err := os.Rename(partialDir, finalDir); err != nil {
		return fmt.Errorf("rename partial -> final: %w", err)
	}
	return nil
}

// preflight reports missing required external tools.
func preflight(tools maptool.ToolSet) error {
	missing := tools.MissingRequired()
	if len(missing) == 0 {
		return nil
	}
	names := make([]string, 0, len(missing))
	for _, t := range missing {
		names = append(names, t.Name)
	}
	return fmt.Errorf("missing required tools: %v\n\n"+
		"Install them locally, or run inside the OCAP full Docker image:\n"+
		"  ghcr.io/ocap2/web:full", names)
}
