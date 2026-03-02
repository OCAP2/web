package maptool

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Event is broadcast to all SSE subscribers.
type Event struct {
	Type     string   `json:"type"`              // "progress" | "status"
	Progress *Progress `json:"data,omitempty"`    // for progress events
	Job      *JobInfo  `json:"job,omitempty"`     // for status events (done/failed/cancelled)
}

// eventHub manages SSE subscribers.
type eventHub struct {
	mu          sync.RWMutex
	subscribers map[uint64]chan Event
	nextID      uint64
}

func newEventHub() *eventHub {
	return &eventHub{
		subscribers: make(map[uint64]chan Event),
	}
}

func (h *eventHub) subscribe() (uint64, <-chan Event) {
	h.mu.Lock()
	defer h.mu.Unlock()
	id := h.nextID
	h.nextID++
	ch := make(chan Event, 64)
	h.subscribers[id] = ch
	return id, ch
}

func (h *eventHub) unsubscribe(id uint64) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if ch, ok := h.subscribers[id]; ok {
		close(ch)
		delete(h.subscribers, id)
	}
}

func (h *eventHub) broadcast(evt Event) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, ch := range h.subscribers {
		select {
		case ch <- evt:
		default:
			// subscriber too slow, drop event
		}
	}
}

// JobManager manages import jobs — one active, rest queued.
// TODO: job history is in-memory only — lost on restart, grows unbounded.
// Consider capping to last N jobs or persisting to disk.
type JobManager struct {
	mapsDir     string
	newPipeline func() *Pipeline
	mu          sync.RWMutex
	jobs        map[string]*Job
	queue       chan *Job
	cancel      context.CancelFunc
	onProgress  func(Progress)
	hub         *eventHub
}

// NewJobManager creates a job manager.
func NewJobManager(mapsDir string, newPipeline func() *Pipeline) *JobManager {
	return &JobManager{
		mapsDir:     mapsDir,
		newPipeline: newPipeline,
		jobs:        make(map[string]*Job),
		queue:       make(chan *Job, 100),
		hub:         newEventHub(),
	}
}

// OnProgress sets a callback for job progress updates (used by standalone CLI).
func (jm *JobManager) OnProgress(fn func(Progress)) {
	jm.mu.Lock()
	defer jm.mu.Unlock()
	jm.onProgress = fn
}

// Subscribe registers an SSE subscriber and returns its ID and event channel.
func (jm *JobManager) Subscribe() (uint64, <-chan Event) {
	return jm.hub.subscribe()
}

// Unsubscribe removes an SSE subscriber.
func (jm *JobManager) Unsubscribe(id uint64) {
	jm.hub.unsubscribe(id)
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
func (jm *JobManager) Submit(inputPath, worldName string) (JobInfo, error) {
	id := fmt.Sprintf("%s-%d", worldName, time.Now().UnixMilli())
	outputDir := filepath.Join(jm.mapsDir, worldName)
	tempDir := filepath.Join(os.TempDir(), "ocap-maptool", id)

	job := &Job{
		ID:        id,
		WorldName: worldName,
		InputPath: inputPath,
		OutputDir: outputDir,
		TempDir:   tempDir,
		Status:    StatusPending,
	}

	jm.mu.Lock()
	jm.jobs[job.ID] = job
	jm.mu.Unlock()

	snap := job.Snapshot()
	jm.broadcastStatus(job)
	jm.queue <- job
	return snap, nil
}

// SubmitWithCleanup is like Submit but sets CleanupDir for safe post-job cleanup.
func (jm *JobManager) SubmitWithCleanup(inputPath, worldName, cleanupDir string) (JobInfo, error) {
	id := fmt.Sprintf("%s-%d", worldName, time.Now().UnixMilli())
	outputDir := filepath.Join(jm.mapsDir, worldName)
	tempDir := filepath.Join(os.TempDir(), "ocap-maptool", id)

	job := &Job{
		ID:         id,
		WorldName:  worldName,
		InputPath:  inputPath,
		OutputDir:  outputDir,
		TempDir:    tempDir,
		Status:     StatusPending,
		CleanupDir: cleanupDir,
	}

	jm.mu.Lock()
	jm.jobs[job.ID] = job
	jm.mu.Unlock()

	snap := job.Snapshot()
	jm.broadcastStatus(job)
	jm.queue <- job
	return snap, nil
}

// SubmitFunc adds a custom job to the queue that runs fn instead of the pipeline.
func (jm *JobManager) SubmitFunc(id, worldName string, fn func(ctx context.Context, job *Job) error) (JobInfo, error) {
	job := &Job{
		ID:        id,
		WorldName: worldName,
		Status:    StatusPending,
		customRun: fn,
	}

	jm.mu.Lock()
	jm.jobs[job.ID] = job
	jm.mu.Unlock()

	snap := job.Snapshot()
	jm.broadcastStatus(job)
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

// CancelJob cancels a running job by ID.
func (jm *JobManager) CancelJob(id string) error {
	jm.mu.RLock()
	job := jm.jobs[id]
	jm.mu.RUnlock()
	if job == nil {
		return fmt.Errorf("job %q not found", id)
	}

	job.mu.RLock()
	cancelFn := job.cancelFunc
	status := job.Status
	job.mu.RUnlock()

	if status != StatusRunning && status != StatusPending {
		return fmt.Errorf("job %q is not running (status: %s)", id, status)
	}
	if cancelFn != nil {
		cancelFn()
	}
	return nil
}

func (jm *JobManager) processJob(ctx context.Context, job *Job) {
	// Create per-job context for cancellation
	jobCtx, jobCancel := context.WithCancel(ctx)
	job.mu.Lock()
	job.cancelFunc = jobCancel
	job.mu.Unlock()
	defer jobCancel()

	if job.customRun != nil {
		job.Start()
		jm.broadcastStatus(job)
		if err := job.customRun(jobCtx, job); err != nil {
			if jobCtx.Err() != nil {
				job.setStatus(StatusCancelled, "")
				jm.broadcastStatus(job)
			} else {
				job.setStatus(StatusFailed, err.Error())
				jm.broadcastStatus(job)
			}
			return
		}
		job.setStatus(StatusDone, "")
		jm.broadcastStatus(job)
		return
	}

	// Writability precheck: verify the maps directory is writable before
	// creating subdirectories. Catches permission errors early with a
	// clear message (e.g. read-only Docker mounts).
	if err := checkWritable(jm.mapsDir); err != nil {
		job.setStatus(StatusFailed, fmt.Sprintf("maps directory not writable: %v", err))
		jm.broadcastStatus(job)
		return
	}

	if err := os.MkdirAll(job.OutputDir, 0755); err != nil {
		job.setStatus(StatusFailed, err.Error())
		jm.broadcastStatus(job)
		return
	}
	if err := os.MkdirAll(job.TempDir, 0755); err != nil {
		job.setStatus(StatusFailed, err.Error())
		jm.broadcastStatus(job)
		return
	}

	job.SubDirs = true
	job.Start()
	jm.broadcastStatus(job)

	pipeline := jm.newPipeline()

	// Wire progress to both the callback (standalone CLI) and broadcast hub
	jm.mu.RLock()
	onProgress := jm.onProgress
	jm.mu.RUnlock()
	pipeline.OnProgress = func(p Progress) {
		if onProgress != nil {
			onProgress(p)
		}
		jm.hub.broadcast(Event{
			Type:     "progress",
			Progress: &p,
		})
	}

	if err := pipeline.Run(jobCtx, job); err != nil {
		// Only persist error for actual failures, not cancellations.
		job.mu.RLock()
		status := job.Status
		job.mu.RUnlock()
		if status == StatusFailed {
			writeErrorJSON(job)
		}
		jm.broadcastStatus(job)
		return
	}

	// Remove any stale error.json from a previous failed run.
	if err := os.Remove(filepath.Join(job.OutputDir, "error.json")); err != nil && !os.IsNotExist(err) {
		log.Printf("WARNING: failed to remove stale error.json: %v", err)
	}

	jm.broadcastStatus(job)

	// Clean up temp directory and uploaded extraction directory on success
	os.RemoveAll(job.TempDir)
	if job.CleanupDir != "" {
		os.RemoveAll(job.CleanupDir)
	}
}

// writeErrorJSON persists pipeline failure details to the output directory
// so they survive server restarts and are visible via the map scanner.
func writeErrorJSON(job *Job) {
	if job.OutputDir == "" {
		return
	}
	job.mu.RLock()
	errInfo := struct {
		Error    string `json:"error"`
		Stage    string `json:"stage,omitempty"`
		StageNum int    `json:"stageNum,omitempty"`
		Time     string `json:"timestamp"`
	}{
		Error:    job.Error,
		Stage:    job.Stage,
		StageNum: job.StageNum,
		Time:     time.Now().UTC().Format(time.RFC3339),
	}
	job.mu.RUnlock()

	data, err := json.MarshalIndent(errInfo, "", "  ")
	if err != nil {
		log.Printf("WARNING: marshal error.json: %v", err)
		return
	}
	path := filepath.Join(job.OutputDir, "error.json")
	if err := os.WriteFile(path, data, 0644); err != nil {
		log.Printf("WARNING: write error.json: %v", err)
	}
}

// checkWritable verifies that a directory is writable by creating and
// immediately removing a temp file.
func checkWritable(dir string) error {
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	f, err := os.CreateTemp(dir, ".writable-check-*")
	if err != nil {
		return err
	}
	name := f.Name()
	f.Close()
	return os.Remove(name)
}

func (jm *JobManager) broadcastStatus(job *Job) {
	snap := job.Snapshot()
	jm.hub.broadcast(Event{
		Type: "status",
		Job:  &snap,
	})
}
