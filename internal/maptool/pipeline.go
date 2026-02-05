package maptool

import (
	"context"
	"fmt"
	"sync"
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
	mu        sync.RWMutex `json:"-"`
	ID        string       `json:"id"`
	WorldName string       `json:"worldName"`
	InputPath string       `json:"inputPath"`
	OutputDir string       `json:"outputDir"`
	TempDir   string       `json:"tempDir"`
	Status    string       `json:"status"`
	Error     string       `json:"error,omitempty"`
	StartedAt time.Time    `json:"startedAt"`

	// Progress tracking
	Stage       string `json:"stage,omitempty"`
	StageNum    int    `json:"stageNum,omitempty"`
	TotalStages int    `json:"totalStages,omitempty"`
	Message     string `json:"message,omitempty"`

	// Populated by stages (internal, not exposed via JSON)
	WRPPath   string `json:"-"`
	WorldSize int    `json:"-"`
	ImageSize int    `json:"-"`
	TilesDir  string `json:"-"`
	SatImage  string `json:"-"`
}

// JobInfo is a read-only snapshot of a Job, safe for concurrent access and serialization.
type JobInfo struct {
	ID          string    `json:"id"`
	WorldName   string    `json:"worldName"`
	InputPath   string    `json:"inputPath"`
	OutputDir   string    `json:"outputDir"`
	TempDir     string    `json:"tempDir"`
	Status      string    `json:"status"`
	Error       string    `json:"error,omitempty"`
	StartedAt   time.Time `json:"startedAt"`
	Stage       string    `json:"stage,omitempty"`
	StageNum    int       `json:"stageNum,omitempty"`
	TotalStages int       `json:"totalStages,omitempty"`
	Message     string    `json:"message,omitempty"`
}

// Snapshot returns a read-only copy of the job safe for concurrent access.
func (j *Job) Snapshot() JobInfo {
	j.mu.RLock()
	defer j.mu.RUnlock()
	return JobInfo{
		ID:          j.ID,
		WorldName:   j.WorldName,
		InputPath:   j.InputPath,
		OutputDir:   j.OutputDir,
		TempDir:     j.TempDir,
		Status:      j.Status,
		Error:       j.Error,
		StartedAt:   j.StartedAt,
		Stage:       j.Stage,
		StageNum:    j.StageNum,
		TotalStages: j.TotalStages,
		Message:     j.Message,
	}
}

func (j *Job) setStatus(status, errMsg string) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.Status = status
	j.Error = errMsg
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
	job.setStatus(StatusRunning, "")
	job.mu.Lock()
	job.StartedAt = time.Now()
	job.mu.Unlock()

	for i, stage := range p.stages {
		if err := ctx.Err(); err != nil {
			job.setStatus(StatusCancelled, "")
			return fmt.Errorf("cancelled before stage %s: %w", stage.Name, err)
		}

		p.reportProgress(job, Progress{
			JobID:       job.ID,
			Stage:       stage.Name,
			StageNum:    i + 1,
			TotalStages: len(p.stages),
		})

		if err := stage.Run(ctx, job); err != nil {
			if stage.Optional {
				p.reportProgress(job, Progress{
					JobID:       job.ID,
					Stage:       stage.Name,
					StageNum:    i + 1,
					TotalStages: len(p.stages),
					Message:     fmt.Sprintf("Optional stage %s skipped: %v", stage.Name, err),
				})
				continue
			}
			job.setStatus(StatusFailed, err.Error())
			return fmt.Errorf("stage %s: %w", stage.Name, err)
		}
	}

	job.setStatus(StatusDone, "")
	return nil
}

func (p *Pipeline) reportProgress(job *Job, prog Progress) {
	job.mu.Lock()
	job.Stage = prog.Stage
	job.StageNum = prog.StageNum
	job.TotalStages = prog.TotalStages
	job.Message = prog.Message
	job.mu.Unlock()

	if p.OnProgress != nil {
		p.OnProgress(prog)
	}
}
