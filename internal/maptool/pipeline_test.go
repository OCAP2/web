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

	job := &Job{WorldName: "test", InputPath: "/tmp/test.pbo"}
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

	job := &Job{WorldName: "test", InputPath: "/tmp/test.pbo"}
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

	job := &Job{WorldName: "test", InputPath: "/tmp/test.pbo"}
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

	job := &Job{WorldName: "test", InputPath: "/tmp/test.pbo"}
	p := NewPipeline(stages)
	err := p.Run(ctx, job)

	require.Error(t, err)
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

	job := &Job{WorldName: "test", InputPath: "/tmp/test.pbo"}
	p := NewPipeline(stages)
	err := p.Run(context.Background(), job)

	require.NoError(t, err)
	assert.Equal(t, []string{"required", "optional", "final"}, executed)
	assert.Equal(t, StatusDone, job.Status)
}
