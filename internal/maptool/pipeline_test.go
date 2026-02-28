package maptool

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPipeline_RunsAllStages(t *testing.T) {
	var executed []string
	stages := []Stage{
		{Name: "stage1", Run: func(ctx context.Context, job *Job) error {
			executed = append(executed, "stage1")
			return nil
		}},
		{Name: "stage2", Run: func(ctx context.Context, job *Job) error {
			executed = append(executed, "stage2")
			return nil
		}},
	}

	job := &Job{WorldName: "test", InputPath: "/tmp/test"}
	p := NewPipeline(stages)
	err := p.Run(context.Background(), job)

	require.NoError(t, err)
	assert.Equal(t, []string{"stage1", "stage2"}, executed)
	assert.Equal(t, StatusDone, job.Status)
}

func TestPipeline_StopsOnError(t *testing.T) {
	var executed []string
	stages := []Stage{
		{Name: "stage1", Run: func(ctx context.Context, job *Job) error {
			executed = append(executed, "stage1")
			return errors.New("stage1 failed")
		}},
		{Name: "stage2", Run: func(ctx context.Context, job *Job) error {
			executed = append(executed, "stage2")
			return nil
		}},
	}

	job := &Job{WorldName: "test", InputPath: "/tmp/test"}
	p := NewPipeline(stages)
	err := p.Run(context.Background(), job)

	require.Error(t, err)
	assert.Equal(t, []string{"stage1"}, executed)
	assert.Equal(t, StatusFailed, job.Status)
	assert.Contains(t, job.Error, "stage1 failed")
}

func TestPipeline_ReportsProgress(t *testing.T) {
	var updates []Progress
	stages := []Stage{
		{Name: "extract", Run: func(ctx context.Context, job *Job) error { return nil }},
		{Name: "tile", Run: func(ctx context.Context, job *Job) error { return nil }},
	}

	job := &Job{WorldName: "test", InputPath: "/tmp/test"}
	p := NewPipeline(stages)
	p.OnProgress = func(prog Progress) { updates = append(updates, prog) }
	err := p.Run(context.Background(), job)

	require.NoError(t, err)
	assert.GreaterOrEqual(t, len(updates), 2)
	assert.Equal(t, "extract", updates[0].Stage)
	assert.Equal(t, 1, updates[0].StageNum)
	assert.Equal(t, 2, updates[0].TotalStages)
}

func TestPipeline_RespectsContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	stages := []Stage{
		{Name: "stage1", Run: func(ctx context.Context, job *Job) error {
			return ctx.Err()
		}},
	}

	job := &Job{WorldName: "test", InputPath: "/tmp/test"}
	p := NewPipeline(stages)
	err := p.Run(ctx, job)

	require.Error(t, err)
}

func TestSetProgress(t *testing.T) {
	job := &Job{}
	job.SetProgress("testing", 2, 5)

	assert.Equal(t, "testing", job.Stage)
	assert.Equal(t, 2, job.StageNum)
	assert.Equal(t, 5, job.TotalStages)
}

func TestTilesOutputDir(t *testing.T) {
	t.Run("SubDirs=true", func(t *testing.T) {
		job := &Job{OutputDir: "/out", SubDirs: true}
		assert.Equal(t, "/out/tiles", job.TilesOutputDir())
	})
	t.Run("SubDirs=false", func(t *testing.T) {
		job := &Job{OutputDir: "/out", SubDirs: false}
		assert.Equal(t, "/out", job.TilesOutputDir())
	})
}

func TestStylesOutputDir(t *testing.T) {
	t.Run("SubDirs=true", func(t *testing.T) {
		job := &Job{OutputDir: "/out", SubDirs: true}
		assert.Equal(t, "/out/styles", job.StylesOutputDir())
	})
	t.Run("SubDirs=false", func(t *testing.T) {
		job := &Job{OutputDir: "/out", SubDirs: false}
		assert.Equal(t, "/out", job.StylesOutputDir())
	})
}

func TestSnapshot(t *testing.T) {
	job := &Job{
		ID:          "test-1",
		WorldName:   "altis",
		Status:      StatusRunning,
		Stage:       "processing",
		StageNum:    3,
		TotalStages: 5,
		Message:     "working",
	}

	snap := job.Snapshot()
	assert.Equal(t, "test-1", snap.ID)
	assert.Equal(t, "altis", snap.WorldName)
	assert.Equal(t, StatusRunning, snap.Status)
	assert.Equal(t, "processing", snap.Stage)
	assert.Equal(t, 3, snap.StageNum)
	assert.Equal(t, 5, snap.TotalStages)
	assert.Equal(t, "working", snap.Message)
}

func TestParallelStages_RequiredFails(t *testing.T) {
	stage := ParallelStages("parallel",
		Stage{Name: "ok", Run: func(ctx context.Context, job *Job) error {
			return nil
		}},
		Stage{Name: "fail", Run: func(ctx context.Context, job *Job) error {
			return errors.New("required failed")
		}},
	)

	job := &Job{WorldName: "test"}
	err := stage.Run(context.Background(), job)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "required failed")
}

func TestParallelStages_OptionalSkipped(t *testing.T) {
	stage := ParallelStages("parallel",
		Stage{Name: "ok", Run: func(ctx context.Context, job *Job) error {
			return nil
		}},
		Stage{Name: "optional", Optional: true, Run: func(ctx context.Context, job *Job) error {
			return errors.New("optional failed")
		}},
	)

	job := &Job{WorldName: "test"}
	err := stage.Run(context.Background(), job)
	require.NoError(t, err)
}

func TestPipeline_CancelledBeforeStage(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // cancel immediately

	stages := []Stage{
		{Name: "stage1", Run: func(ctx context.Context, job *Job) error {
			return nil
		}},
	}

	job := &Job{WorldName: "test", InputPath: "/tmp/test"}
	p := NewPipeline(stages)
	err := p.Run(ctx, job)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "cancelled")
	assert.Equal(t, StatusCancelled, job.Status)
}

func TestPipeline_OptionalStageSkipped(t *testing.T) {
	var executed []string
	stages := []Stage{
		{Name: "required", Run: func(ctx context.Context, job *Job) error {
			executed = append(executed, "required")
			return nil
		}},
		{Name: "optional", Optional: true, Run: func(ctx context.Context, job *Job) error {
			executed = append(executed, "optional")
			return errors.New("optional failed")
		}},
		{Name: "final", Run: func(ctx context.Context, job *Job) error {
			executed = append(executed, "final")
			return nil
		}},
	}

	job := &Job{WorldName: "test", InputPath: "/tmp/test"}
	p := NewPipeline(stages)
	err := p.Run(context.Background(), job)

	require.NoError(t, err)
	assert.Equal(t, []string{"required", "optional", "final"}, executed)
	assert.Equal(t, StatusDone, job.Status)
}
