package maptool

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func noopPipeline() *Pipeline {
	return NewPipeline([]Stage{
		{Name: "noop", Run: func(ctx context.Context, job *Job) error { return nil }},
	})
}

func TestJobManager_Submit(t *testing.T) {
	jm := NewJobManager(t.TempDir(), func() *Pipeline { return noopPipeline() })
	go jm.Start(context.Background())
	defer jm.Stop()

	job, err := jm.Submit("/tmp/altis", "altis")
	require.NoError(t, err)
	assert.Equal(t, "altis", job.WorldName)
	assert.Equal(t, StatusPending, job.Status)

	time.Sleep(500 * time.Millisecond)

	got := jm.GetJob(job.ID)
	require.NotNil(t, got)
	assert.Equal(t, StatusDone, got.Status)
}

func TestJobManager_ListJobs(t *testing.T) {
	jm := NewJobManager(t.TempDir(), func() *Pipeline { return noopPipeline() })
	jobs := jm.ListJobs()
	assert.Empty(t, jobs)
}

func TestJobManager_SubmitFunc(t *testing.T) {
	jm := NewJobManager(t.TempDir(), func() *Pipeline { return noopPipeline() })
	go jm.Start(context.Background())
	defer jm.Stop()

	called := false
	snap, err := jm.SubmitFunc("test-1", "restyle", func(ctx context.Context, job *Job) error {
		called = true
		return nil
	})
	require.NoError(t, err)
	assert.Equal(t, "restyle", snap.WorldName)

	time.Sleep(500 * time.Millisecond)

	assert.True(t, called)
	got := jm.GetJob("test-1")
	require.NotNil(t, got)
	assert.Equal(t, StatusDone, got.Status)
}

func TestJobManager_SubmitFunc_Error(t *testing.T) {
	jm := NewJobManager(t.TempDir(), func() *Pipeline { return noopPipeline() })
	go jm.Start(context.Background())
	defer jm.Stop()

	jm.SubmitFunc("fail-1", "world", func(ctx context.Context, job *Job) error {
		return fmt.Errorf("something broke")
	})

	time.Sleep(500 * time.Millisecond)

	got := jm.GetJob("fail-1")
	require.NotNil(t, got)
	assert.Equal(t, StatusFailed, got.Status)
	assert.Contains(t, got.Error, "something broke")
}

func TestJobManager_SubmitWithCleanup(t *testing.T) {
	mapsDir := t.TempDir()
	cleanupDir := filepath.Join(t.TempDir(), "extract-123")
	require.NoError(t, os.MkdirAll(cleanupDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(cleanupDir, "file.txt"), []byte("data"), 0644))

	jm := NewJobManager(mapsDir, func() *Pipeline { return noopPipeline() })
	go jm.Start(context.Background())
	defer jm.Stop()

	snap, err := jm.SubmitWithCleanup("/some/input", "altis", cleanupDir)
	require.NoError(t, err)
	assert.Equal(t, "altis", snap.WorldName)

	time.Sleep(500 * time.Millisecond)

	got := jm.GetJob(snap.ID)
	require.NotNil(t, got)
	assert.Equal(t, StatusDone, got.Status)

	// CleanupDir should be removed on success
	_, err = os.Stat(cleanupDir)
	assert.True(t, os.IsNotExist(err), "cleanupDir should be removed after successful job")
}

func TestJobManager_CancelJob(t *testing.T) {
	jm := NewJobManager(t.TempDir(), func() *Pipeline { return noopPipeline() })
	go jm.Start(context.Background())
	defer jm.Stop()

	// Submit a long-running job
	jm.SubmitFunc("cancel-1", "world", func(ctx context.Context, job *Job) error {
		<-ctx.Done()
		return ctx.Err()
	})

	time.Sleep(200 * time.Millisecond)

	err := jm.CancelJob("cancel-1")
	require.NoError(t, err)

	time.Sleep(500 * time.Millisecond)

	got := jm.GetJob("cancel-1")
	require.NotNil(t, got)
	assert.Equal(t, StatusCancelled, got.Status)
}

func TestJobManager_CancelJob_NotFound(t *testing.T) {
	jm := NewJobManager(t.TempDir(), func() *Pipeline { return noopPipeline() })
	err := jm.CancelJob("nonexistent")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "not found")
}

func TestJobManager_GetJob_NotFound(t *testing.T) {
	jm := NewJobManager(t.TempDir(), func() *Pipeline { return noopPipeline() })
	got := jm.GetJob("nonexistent")
	assert.Nil(t, got)
}

func TestJobManager_OnProgress(t *testing.T) {
	jm := NewJobManager(t.TempDir(), func() *Pipeline { return noopPipeline() })
	called := false
	jm.OnProgress(func(p Progress) { called = true })
	// OnProgress is only used when pipeline.Run is invoked, which triggers
	// the callback. We just verify it can be set without panic.
	assert.False(t, called)
}

// ─── EventHub tests ───

func TestEventHub_SubscribeUnsubscribe(t *testing.T) {
	hub := newEventHub()

	id1, ch1 := hub.subscribe()
	id2, _ := hub.subscribe()
	assert.NotEqual(t, id1, id2)

	hub.broadcast(Event{Type: "status"})

	select {
	case evt := <-ch1:
		assert.Equal(t, "status", evt.Type)
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for broadcast")
	}

	hub.unsubscribe(id1)
	// Unsubscribing again should not panic
	hub.unsubscribe(id1)
}

func TestEventHub_BroadcastToMultiple(t *testing.T) {
	hub := newEventHub()

	_, ch1 := hub.subscribe()
	_, ch2 := hub.subscribe()

	hub.broadcast(Event{Type: "progress"})

	for _, ch := range []<-chan Event{ch1, ch2} {
		select {
		case evt := <-ch:
			assert.Equal(t, "progress", evt.Type)
		case <-time.After(time.Second):
			t.Fatal("timed out")
		}
	}
}

func TestEventHub_DropOnSlowSubscriber(t *testing.T) {
	hub := newEventHub()
	_, ch := hub.subscribe()

	// Fill the channel buffer (capacity 64)
	for range 64 {
		hub.broadcast(Event{Type: "fill"})
	}

	// This should not block — event is dropped for slow subscriber
	hub.broadcast(Event{Type: "dropped"})

	// Drain and verify we got 64 events
	count := 0
	for {
		select {
		case <-ch:
			count++
		default:
			goto done
		}
	}
done:
	assert.Equal(t, 64, count)
}

func TestJobManager_Subscribe(t *testing.T) {
	jm := NewJobManager(t.TempDir(), func() *Pipeline { return noopPipeline() })
	go jm.Start(context.Background())
	defer jm.Stop()

	subID, events := jm.Subscribe()
	defer jm.Unsubscribe(subID)

	// Submit a job — should receive status broadcasts
	jm.SubmitFunc("sub-1", "world", func(ctx context.Context, job *Job) error {
		return nil
	})

	// Should receive at least one status event (pending broadcast)
	select {
	case evt := <-events:
		assert.Equal(t, "status", evt.Type)
		assert.NotNil(t, evt.Job)
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for event")
	}
}
