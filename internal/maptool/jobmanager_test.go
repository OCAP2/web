package maptool

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestJobManager_Submit(t *testing.T) {
	noopPipeline := func() *Pipeline {
		return NewPipeline([]Stage{
			{Name: "noop", Run: func(ctx context.Context, job *Job) error { return nil }},
		})
	}

	jm := NewJobManager(t.TempDir(), noopPipeline)
	go jm.Start(context.Background())
	defer jm.Stop()

	job, err := jm.Submit("/tmp/altis.pbo", "altis")
	require.NoError(t, err)
	assert.Equal(t, "altis", job.WorldName)
	assert.Equal(t, StatusPending, job.Status)

	// Wait for job to complete
	time.Sleep(500 * time.Millisecond)

	got := jm.GetJob(job.ID)
	require.NotNil(t, got)
	assert.Equal(t, StatusDone, got.Status)
}

func TestJobManager_ListJobs(t *testing.T) {
	noopPipeline := func() *Pipeline {
		return NewPipeline([]Stage{
			{Name: "noop", Run: func(ctx context.Context, job *Job) error { return nil }},
		})
	}

	jm := NewJobManager(t.TempDir(), noopPipeline)
	jobs := jm.ListJobs()
	assert.Empty(t, jobs)
}
