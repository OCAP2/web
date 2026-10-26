package server

import (
	"context"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/OCAP2/extension/v5/pkg/streaming"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// recordingFiles lists what the data directory holds besides the database.
func (rh *resumeHarness) recordingFiles() []string {
	rh.t.Helper()
	entries, err := os.ReadDir(rh.dir)
	require.NoError(rh.t, err)
	var out []string
	for _, e := range entries {
		if !strings.HasPrefix(e.Name(), "test.db") {
			out = append(out, e.Name())
		}
	}
	return out
}

// requireClosed checks that the server closed the connection.
func requireClosed(t *testing.T, c *websocket.Conn) {
	t.Helper()
	c.SetReadDeadline(time.Now().Add(5 * time.Second))
	for {
		if _, _, err := c.ReadMessage(); err != nil {
			return
		}
	}
}

func TestStreamDiscard_RemovesRecording(t *testing.T) {
	rh := newResumeHarness(t, time.Minute)
	c := rh.dial()
	startResumable(t, c, "Discard", "m-d", "p-1")
	last := sendStates(t, c, 2, 1, 5)
	rh.waitSeq("m-d", last)
	require.Len(t, rh.ops(), 1, "a streaming row exists while the mission records")

	sendEnv(t, c, streaming.TypeDiscardMission, last+1, nil)
	ack := readUntil(t, c, isAckFor(streaming.TypeDiscardMission))
	assert.Equal(t, last+1, ack.Seq, "the discard is acknowledged with everything before it")
	requireClosed(t, c)

	assert.Empty(t, rh.ops())
	assert.Empty(t, rh.recordingFiles(), "no files are left behind")
	reg := rh.h.streamRegistry()
	assert.Nil(t, reg.get("m-d"))
	assert.True(t, reg.isCompleted("m-d"))
	assert.Zero(t, reg.activeCount(), "the session's slot is released")
}

func TestStreamDiscard_LostAckResolvedByResume(t *testing.T) {
	rh := newResumeHarness(t, time.Minute)
	c := rh.dial()
	startResumable(t, c, "Lost Ack", "m-lost", "p-1")
	sendEnv(t, c, streaming.TypeDiscardMission, 2, nil)
	readUntil(t, c, isAckFor(streaming.TypeDiscardMission))

	c2 := rh.dial()
	sendEnv(t, c2, streaming.TypeResume, 0, streaming.ResumePayload{MissionID: "m-lost", ProducerID: "p-1"})
	readUntil(t, c2, isType(streaming.ServerResumeCompleted))
	assert.Empty(t, rh.ops())
}

func TestStreamDiscard_ResumedSession(t *testing.T) {
	rh := newResumeHarness(t, time.Minute)
	c := rh.dial()
	startResumable(t, c, "Resumed", "m-res", "p-1")
	last := sendStates(t, c, 2, 1, 3)
	rh.waitSeq("m-res", last)
	c.Close()

	// The producer finishes an unconfirmed discard on a new connection.
	c2 := rh.dial()
	sendEnv(t, c2, streaming.TypeResume, 0, streaming.ResumePayload{MissionID: "m-res", ProducerID: "p-1"})
	reply := readUntil(t, c2, isType(streaming.ServerResumeOK))
	sendEnv(t, c2, streaming.TypeDiscardMission, reply.Seq+1, nil)
	readUntil(t, c2, isAckFor(streaming.TypeDiscardMission))

	assert.Empty(t, rh.ops())
	assert.Empty(t, rh.recordingFiles())
	reg := rh.h.streamRegistry()
	assert.True(t, reg.isCompleted("m-res"))
	assert.Zero(t, reg.activeCount())
}

func TestStreamDiscard_RemovesEarlierSegments(t *testing.T) {
	rh := newResumeHarness(t, 100*time.Millisecond)
	c := rh.dial()
	startResumable(t, c, "Segments", "m-seg", "p-1")
	sendStates(t, c, 2, 1, 5)
	rh.waitSeq("m-seg", 6)
	c.Close()
	// The producer stays away past the grace period: a partial segment is saved.
	require.Eventually(t, func() bool { return rh.h.streamRegistry().get("m-seg") == nil }, 5*time.Second, 10*time.Millisecond)
	require.Len(t, rh.opsByMission("m-seg"), 1)

	// It returns, resends the mission and then discards it.
	c2 := rh.dial()
	sendEnv(t, c2, streaming.TypeResume, 0, streaming.ResumePayload{MissionID: "m-seg", ProducerID: "p-1"})
	readUntil(t, c2, isType(streaming.ServerResumeUnknown))
	startResumable(t, c2, "Segments", "m-seg", "p-1")
	last := sendStates(t, c2, 2, 1, 8)
	sendEnv(t, c2, streaming.TypeDiscardMission, last+1, nil)
	readUntil(t, c2, isAckFor(streaming.TypeDiscardMission))

	assert.Empty(t, rh.ops(), "every segment of the discarded mission is removed")
	assert.Empty(t, rh.recordingFiles())
}

func TestStreamDiscard_LeavesOtherMissionsAlone(t *testing.T) {
	rh := newResumeHarness(t, time.Minute)
	other := rh.dial()
	replayMission(t, other, "Kept", "m-kept", "p-2", 3)

	c := rh.dial()
	startResumable(t, c, "Dropped", "m-drop", "p-1")
	sendEnv(t, c, streaming.TypeDiscardMission, 2, nil)
	readUntil(t, c, isAckFor(streaming.TypeDiscardMission))

	ops := rh.ops()
	require.Len(t, ops, 1)
	assert.Equal(t, "Kept", ops[0].MissionName)
}

func TestStreamDiscard_WithoutSession(t *testing.T) {
	rh := newResumeHarness(t, time.Minute)
	c := rh.dial()
	sendEnv(t, c, streaming.TypeDiscardMission, 0, nil)
	readUntil(t, c, isAckFor(streaming.TypeDiscardMission))
	requireClosed(t, c)
}

func TestStreamDiscard_LegacySession(t *testing.T) {
	rh := newResumeHarness(t, time.Minute)
	c := rh.dial()
	sendStartMission(t, c, "Legacy", "altis")
	sendEnv(t, c, streaming.TypeSoldierState, 0, soldierState(1))
	sendEnv(t, c, streaming.TypeDiscardMission, 0, nil)
	readUntil(t, c, isAckFor(streaming.TypeDiscardMission))
	requireClosed(t, c)

	assert.Empty(t, rh.ops(), "the disconnect that follows does not save it as partial")
	assert.Empty(t, rh.recordingFiles())
	assert.Zero(t, rh.h.streamRegistry().activeCount())
}

// discardPayload names a mission in discard_mission.
func discardPayload(missionID, producerID string) streaming.DiscardMissionPayload {
	return streaming.DiscardMissionPayload{MissionID: missionID, ProducerID: producerID}
}

func TestStreamDiscard_AfterSessionEndedRemovesPartial(t *testing.T) {
	rh := newResumeHarness(t, 100*time.Millisecond)
	c := rh.dial()
	startResumable(t, c, "Expired", "m-exp", "p-1")
	sendStates(t, c, 2, 1, 5)
	rh.waitSeq("m-exp", 6)
	c.Close()
	// The discard never arrived and the grace expired: saved as partial.
	require.Eventually(t, func() bool { return rh.h.streamRegistry().get("m-exp") == nil }, 5*time.Second, 10*time.Millisecond)
	require.Len(t, rh.opsByMission("m-exp"), 1)

	// The producer's recovery finishes the discard without a session.
	c2 := rh.dial()
	sendEnv(t, c2, streaming.TypeResume, 0, streaming.ResumePayload{MissionID: "m-exp", ProducerID: "p-1"})
	reply := readUntil(t, c2, isType(streaming.ServerResumeUnknown))
	assert.Equal(t, uint8(streaming.ProtocolVersionDiscard), reply.ProtocolVersion, "tells the producer it may discard without a session")
	sendEnv(t, c2, streaming.TypeDiscardMission, 0, discardPayload("m-exp", "p-1"))
	readUntil(t, c2, isAckFor(streaming.TypeDiscardMission))
	requireClosed(t, c2)

	assert.Empty(t, rh.ops())
	assert.Empty(t, rh.recordingFiles())
}

func TestStreamDiscard_AfterRestartRemovesFailedRecording(t *testing.T) {
	rh := newResumeHarness(t, time.Minute)
	c := rh.dial()
	startResumable(t, c, "Restarted", "m-rst", "p-1")
	last := sendStates(t, c, 2, 1, 3)
	rh.waitSeq("m-rst", last)
	c.Close()
	rh.restart()
	_, err := FailInterruptedStreams(context.Background(), rh.h.repoOperation)
	require.NoError(t, err)
	require.Len(t, rh.ops(), 1, "the interrupted recording is kept as failed")

	c2 := rh.dial()
	sendEnv(t, c2, streaming.TypeDiscardMission, 0, discardPayload("m-rst", "p-1"))
	readUntil(t, c2, isAckFor(streaming.TypeDiscardMission))
	assert.Empty(t, rh.ops())
}

func TestStreamDiscard_AfterSessionEndedKeepsSavedRecording(t *testing.T) {
	rh := newResumeHarness(t, time.Minute)
	c := rh.dial()
	replayMission(t, c, "Saved", "m-saved", "p-1", 3)

	c2 := rh.dial()
	sendEnv(t, c2, streaming.TypeDiscardMission, 0, discardPayload("m-saved", "p-1"))
	readUntil(t, c2, isAckFor(streaming.TypeDiscardMission))
	require.Len(t, rh.ops(), 1, "a recording saved through end_mission is never discarded")
}

func TestStreamDiscard_NotAcknowledgedBeforeRemoval(t *testing.T) {
	rh := newResumeHarness(t, time.Minute)
	c := rh.dial()
	startResumable(t, c, "Slow", "m-slow-d", "p-1")
	last := sendStates(t, c, 2, 1, 3)
	rh.waitSeq("m-slow-d", last)

	release := make(chan struct{})
	var releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(release) }) }
	streamTestHooks.beforeDiscard = func() error { <-release; return nil }
	t.Cleanup(func() { unblock(); streamTestHooks.beforeDiscard = nil })

	msgs := make(chan streaming.AckMessage, 64)
	go func() {
		for {
			var m streaming.AckMessage
			if c.ReadJSON(&m) != nil {
				close(msgs)
				return
			}
			msgs <- m
		}
	}()

	discardSeq := last + 1
	sendEnv(t, c, streaming.TypeDiscardMission, discardSeq, discardPayload("m-slow-d", "p-1"))
	// Several acknowledgement ticks pass while the removal is held.
	hold := time.After(300 * time.Millisecond)
holding:
	for {
		select {
		case m := <-msgs:
			require.Less(t, m.Seq, discardSeq, "discard_mission acknowledged before the recording was removed: %+v", m)
		case <-hold:
			break holding
		}
	}
	unblock()
	for m := range msgs {
		if m.For == streaming.TypeDiscardMission {
			assert.Equal(t, discardSeq, m.Seq)
			assert.Empty(t, rh.ops())
			return
		}
	}
	t.Fatal("discard_mission was not acknowledged")
}

func TestStreamDiscard_FailedRemovalIsRepeated(t *testing.T) {
	rh := newResumeHarness(t, time.Minute)
	c := rh.dial()
	startResumable(t, c, "Locked", "m-fail", "p-1")
	last := sendStates(t, c, 2, 1, 3)
	rh.waitSeq("m-fail", last)

	streamTestHooks.beforeDiscard = func() error { return errors.New("database is locked") }
	t.Cleanup(func() { streamTestHooks.beforeDiscard = nil })
	sendEnv(t, c, streaming.TypeDiscardMission, last+1, discardPayload("m-fail", "p-1"))
	c.SetReadDeadline(time.Now().Add(5 * time.Second))
	for {
		var m streaming.AckMessage
		err := c.ReadJSON(&m)
		if err != nil {
			require.True(t, websocket.IsCloseError(err, websocket.CloseInternalServerErr), "%v", err)
			break
		}
		require.NotEqual(t, streaming.TypeDiscardMission, m.For, "a failed discard is not acknowledged")
		require.Less(t, m.Seq, last+1)
	}
	ops := rh.ops()
	require.Len(t, ops, 1)
	assert.Equal(t, ConversionStatusFailed, ops[0].ConversionStatus, "no longer shown as live")
	reg := rh.h.streamRegistry()
	assert.False(t, reg.isCompleted("m-fail"))
	assert.Zero(t, reg.activeCount())
	streamTestHooks.beforeDiscard = nil

	// The producer repeats the discard: resume_unknown, then without a session.
	c2 := rh.dial()
	sendEnv(t, c2, streaming.TypeResume, 0, streaming.ResumePayload{MissionID: "m-fail", ProducerID: "p-1"})
	readUntil(t, c2, isType(streaming.ServerResumeUnknown))
	sendEnv(t, c2, streaming.TypeDiscardMission, 0, discardPayload("m-fail", "p-1"))
	readUntil(t, c2, isAckFor(streaming.TypeDiscardMission))
	assert.Empty(t, rh.ops())
	assert.Empty(t, rh.recordingFiles())
}
