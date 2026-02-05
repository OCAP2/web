package maptool

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type JobManager struct {
	mapsDir     string
	newPipeline func() *Pipeline
	mu          sync.RWMutex
	jobs        map[string]*Job
	queue       chan *Job
	cancel      context.CancelFunc
	onProgress  func(Progress)
}

func NewJobManager(mapsDir string, newPipeline func() *Pipeline) *JobManager {
	return &JobManager{
		mapsDir:     mapsDir,
		newPipeline: newPipeline,
		jobs:        make(map[string]*Job),
		queue:       make(chan *Job, 100),
	}
}

func (jm *JobManager) OnProgress(fn func(Progress)) {
	jm.mu.Lock()
	defer jm.mu.Unlock()
	jm.onProgress = fn
}

func (jm *JobManager) Start(ctx context.Context) {
	ctx, jm.cancel = context.WithCancel(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case job := <-jm.queue:
			jm.processJob(ctx, job)
		}
	}
}

func (jm *JobManager) Stop() {
	if jm.cancel != nil {
		jm.cancel()
	}
}

func (jm *JobManager) Submit(pboPath, worldName string) (*Job, error) {
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

	jm.queue <- job
	return job, nil
}

func (jm *JobManager) GetJob(id string) *Job {
	jm.mu.RLock()
	defer jm.mu.RUnlock()
	return jm.jobs[id]
}

func (jm *JobManager) ListJobs() []*Job {
	jm.mu.RLock()
	defer jm.mu.RUnlock()
	result := make([]*Job, 0, len(jm.jobs))
	for _, j := range jm.jobs {
		result = append(result, j)
	}
	return result
}

func (jm *JobManager) processJob(ctx context.Context, job *Job) {
	if err := os.MkdirAll(job.OutputDir, 0755); err != nil {
		job.Status = StatusFailed
		job.Error = err.Error()
		return
	}
	if err := os.MkdirAll(job.TempDir, 0755); err != nil {
		job.Status = StatusFailed
		job.Error = err.Error()
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

	os.RemoveAll(job.TempDir)
}
