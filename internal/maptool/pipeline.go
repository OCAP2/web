package maptool

import (
	"context"
	"fmt"
	"time"
)

// Job status constants.
const (
	StatusPending   = "pending"
	StatusRunning   = "running"
	StatusDone      = "done"
	StatusFailed    = "failed"
	StatusCancelled = "cancelled"
)

// Job represents a single PBO import job.
type Job struct {
	ID        string    `json:"id"`
	WorldName string    `json:"worldName"`
	InputPath string    `json:"inputPath"`
	OutputDir string    `json:"outputDir"`
	TempDir   string    `json:"tempDir"`
	Status    string    `json:"status"`
	Error     string    `json:"error,omitempty"`
	StartedAt time.Time `json:"startedAt"`

	// Populated by stages
	WRPPath   string `json:"-"`
	WorldSize int    `json:"-"`
	ImageSize int    `json:"-"`
	TilesDir  string `json:"-"`
	SatImage  string `json:"-"`
}

// Progress represents the current pipeline progress.
type Progress struct {
	JobID       string `json:"jobId"`
	Stage       string `json:"stage"`
	StageNum    int    `json:"stageNum"`
	TotalStages int    `json:"totalStages"`
	Message     string `json:"message,omitempty"`
}

// Stage is a single step in the pipeline.
type Stage struct {
	Name     string
	Optional bool
	Run      func(ctx context.Context, job *Job) error
}

// Pipeline orchestrates a sequence of stages.
type Pipeline struct {
	stages     []Stage
	OnProgress func(Progress)
}

// NewPipeline creates a pipeline with the given stages.
func NewPipeline(stages []Stage) *Pipeline {
	return &Pipeline{stages: stages}
}

// Run executes all stages sequentially for the given job.
func (p *Pipeline) Run(ctx context.Context, job *Job) error {
	job.Status = StatusRunning
	job.StartedAt = time.Now()

	for i, stage := range p.stages {
		if err := ctx.Err(); err != nil {
			job.Status = StatusCancelled
			return fmt.Errorf("cancelled before stage %s: %w", stage.Name, err)
		}

		p.reportProgress(Progress{
			JobID:       job.ID,
			Stage:       stage.Name,
			StageNum:    i + 1,
			TotalStages: len(p.stages),
			Message:     fmt.Sprintf("Running stage: %s", stage.Name),
		})

		if err := stage.Run(ctx, job); err != nil {
			if stage.Optional {
				p.reportProgress(Progress{
					JobID:       job.ID,
					Stage:       stage.Name,
					StageNum:    i + 1,
					TotalStages: len(p.stages),
					Message:     fmt.Sprintf("Optional stage %s skipped: %v", stage.Name, err),
				})
				continue
			}
			job.Status = StatusFailed
			job.Error = fmt.Sprintf("stage %s: %v", stage.Name, err)
			return fmt.Errorf("stage %s: %w", stage.Name, err)
		}
	}

	job.Status = StatusDone
	return nil
}

func (p *Pipeline) reportProgress(prog Progress) {
	if p.OnProgress != nil {
		p.OnProgress(prog)
	}
}
