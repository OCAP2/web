package maptool

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// JobManager manages import jobs — one active, rest queued.
type JobManager struct {
	mapsDir     string
	newPipeline func() *Pipeline
	mu          sync.RWMutex
	jobs        map[string]*Job
	queue       chan *Job
	cancel      context.CancelFunc
	onProgress  func(Progress)
}

// NewJobManager creates a job manager.
func NewJobManager(mapsDir string, newPipeline func() *Pipeline) *JobManager {
	return &JobManager{
		mapsDir:     mapsDir,
		newPipeline: newPipeline,
		jobs:        make(map[string]*Job),
		queue:       make(chan *Job, 100),
	}
}

// OnProgress sets a callback for job progress updates.
func (jm *JobManager) OnProgress(fn func(Progress)) {
	jm.mu.Lock()
	defer jm.mu.Unlock()
	jm.onProgress = fn
}

// Start begins processing queued jobs. Blocks until context is cancelled.
func (jm *JobManager) Start(ctx context.Context) {
	ctx, cancel := context.WithCancel(ctx)
	jm.mu.Lock()
	jm.cancel = cancel
	jm.mu.Unlock()

	for {
		select {
		case <-ctx.Done():
			return
		case job := <-jm.queue:
			jm.processJob(ctx, job)
		}
	}
}

// Stop cancels the job manager.
func (jm *JobManager) Stop() {
	jm.mu.RLock()
	cancel := jm.cancel
	jm.mu.RUnlock()
	if cancel != nil {
		cancel()
	}
}

// Submit adds a new import job to the queue. Returns a snapshot of the job.
func (jm *JobManager) Submit(pboPath, worldName string) (JobInfo, error) {
	id := fmt.Sprintf("%s-%d", worldName, time.Now().UnixMilli())
	outputDir := filepath.Join(jm.mapsDir, worldName)
	tempDir := filepath.Join(os.TempDir(), "ocap-maptool", id)

	job := &Job{
		ID:        id,
		WorldName: worldName,
		InputPath: pboPath,
		OutputDir: outputDir,
		TempDir:   tempDir,
		Status:    StatusPending,
	}

	jm.mu.Lock()
	jm.jobs[job.ID] = job
	jm.mu.Unlock()

	snap := job.Snapshot()
	jm.queue <- job
	return snap, nil
}

// GetJob returns a snapshot of a job by ID, or nil if not found.
func (jm *JobManager) GetJob(id string) *JobInfo {
	jm.mu.RLock()
	job := jm.jobs[id]
	jm.mu.RUnlock()
	if job == nil {
		return nil
	}
	snap := job.Snapshot()
	return &snap
}

// ListJobs returns snapshots of all jobs.
func (jm *JobManager) ListJobs() []JobInfo {
	jm.mu.RLock()
	defer jm.mu.RUnlock()
	result := make([]JobInfo, 0, len(jm.jobs))
	for _, j := range jm.jobs {
		result = append(result, j.Snapshot())
	}
	return result
}

func (jm *JobManager) processJob(ctx context.Context, job *Job) {
	if err := os.MkdirAll(job.OutputDir, 0755); err != nil {
		job.setStatus(StatusFailed, err.Error())
		return
	}
	if err := os.MkdirAll(job.TempDir, 0755); err != nil {
		job.setStatus(StatusFailed, err.Error())
		return
	}

	pipeline := jm.newPipeline()

	jm.mu.RLock()
	onProgress := jm.onProgress
	jm.mu.RUnlock()
	pipeline.OnProgress = onProgress

	if err := pipeline.Run(ctx, job); err != nil {
		return
	}

	// Clean up temp directory and uploaded PBOs on success
	os.RemoveAll(job.TempDir)
	os.RemoveAll(filepath.Dir(job.InputPath))
}
