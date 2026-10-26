package server

import (
	"context"
	"errors"
	"net"
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
			requireNotTimeout(t, err)
			return
		}
	}
}

// requireNotTimeout fails when a read ended by its deadline: the server was
// expected to close the connection.
func requireNotTimeout(t *testing.T, err error) {
	t.Helper()
	var netErr net.Error
	require.False(t, errors.As(err, &netErr) && netErr.Timeout(), "the server did not close the connection: %v", err)
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
	streamTestHooks.beforeRemove = func() error { <-release; return nil }
	t.Cleanup(func() { unblock(); streamTestHooks.beforeRemove = nil })

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

	streamTestHooks.beforeRemove = func() error { return errors.New("database is locked") }
	t.Cleanup(func() { streamTestHooks.beforeRemove = nil })
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
	streamTestHooks.beforeRemove = nil

	// The producer repeats the discard: resume_unknown, then without a session.
	c2 := rh.dial()
	sendEnv(t, c2, streaming.TypeResume, 0, streaming.ResumePayload{MissionID: "m-fail", ProducerID: "p-1"})
	readUntil(t, c2, isType(streaming.ServerResumeUnknown))
	sendEnv(t, c2, streaming.TypeDiscardMission, 0, discardPayload("m-fail", "p-1"))
	readUntil(t, c2, isAckFor(streaming.TypeDiscardMission))
	assert.Empty(t, rh.ops())
	assert.Empty(t, rh.recordingFiles())
}

// requireClosedUnacknowledged checks that the server closes the connection
// with an error and never acknowledges discard_mission.
func requireClosedUnacknowledged(t *testing.T, c *websocket.Conn) {
	t.Helper()
	c.SetReadDeadline(time.Now().Add(5 * time.Second))
	for {
		var m streaming.AckMessage
		if err := c.ReadJSON(&m); err != nil {
			requireNotTimeout(t, err)
			return
		}
		require.NotEqual(t, streaming.TypeDiscardMission, m.For, "discard_mission must not be acknowledged")
	}
}

func TestStreamDiscard_WithoutSessionDropsWaitingSession(t *testing.T) {
	rh := newResumeHarness(t, time.Minute)
	c := rh.dial()
	startResumable(t, c, "Waiting", "m-wait", "p-1")
	last := sendStates(t, c, 2, 1, 3)
	rh.waitSeq("m-wait", last)
	c.Close()
	reg := rh.h.streamRegistry()
	rh.detachedSession("m-wait")

	c2 := rh.dial()
	sendEnv(t, c2, streaming.TypeDiscardMission, 0, discardPayload("m-wait", "p-1"))
	readUntil(t, c2, isAckFor(streaming.TypeDiscardMission))

	assert.Empty(t, rh.ops())
	assert.Empty(t, rh.recordingFiles())
	assert.Nil(t, reg.get("m-wait"))
	assert.True(t, reg.isCompleted("m-wait"))
	assert.Zero(t, reg.activeCount())
}

// detachedSession waits until the mission's session waits for its producer.
func (rh *resumeHarness) detachedSession(missionID string) {
	rh.t.Helper()
	require.Eventually(rh.t, func() bool {
		ss := rh.h.streamRegistry().get(missionID)
		if ss == nil {
			return false
		}
		ss.mu.Lock()
		defer ss.mu.Unlock()
		return ss.owner == nil
	}, 5*time.Second, 10*time.Millisecond)
}

func TestStreamDiscard_WithoutSessionLeavesOtherProducersSession(t *testing.T) {
	rh := newResumeHarness(t, time.Minute)
	c := rh.dial()
	startResumable(t, c, "Theirs", "m-theirs", "p-1")
	rh.waitSeq("m-theirs", sendStates(t, c, 2, 1, 3))
	c.Close()
	rh.detachedSession("m-theirs")

	c2 := rh.dial()
	sendEnv(t, c2, streaming.TypeDiscardMission, 0, discardPayload("m-theirs", "p-2"))
	requireClosedUnacknowledged(t, c2)
	require.Len(t, rh.ops(), 1)
	assert.NotNil(t, rh.h.streamRegistry().get("m-theirs"), "its producer may still resume it")
}

func TestStreamDiscard_WithoutSessionWaitsForExpiry(t *testing.T) {
	rh := newResumeHarness(t, time.Minute)
	c := rh.dial()
	startResumable(t, c, "Expiring", "m-expiring", "p-1")
	rh.waitSeq("m-expiring", sendStates(t, c, 2, 1, 3))
	c.Close()
	rh.detachedSession("m-expiring")
	ss := rh.h.streamRegistry().get("m-expiring")

	// The grace expires and the partial is being saved when the discard
	// arrives: it waits for the save, then removes the partial.
	saving := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	streamTestHooks.beforeSave = func() { close(saving); <-release }
	t.Cleanup(func() { unblock(); streamTestHooks.beforeSave = nil })
	go rh.h.expireStream(ss, 0)
	<-saving
	streamTestHooks.beforeSave = nil

	reached := make(chan struct{})
	var reachedOnce sync.Once
	streamTestHooks.beforeDiscardSession = func() { reachedOnce.Do(func() { close(reached) }) }
	t.Cleanup(func() { streamTestHooks.beforeDiscardSession = nil })
	c2 := rh.dial()
	sendEnv(t, c2, streaming.TypeDiscardMission, 0, discardPayload("m-expiring", "p-1"))
	<-reached // the discard found the session being saved
	unblock()
	readUntil(t, c2, isAckFor(streaming.TypeDiscardMission))
	assert.Empty(t, rh.ops(), "the partial saved meanwhile is removed")
}

func TestStreamDiscard_WithoutSessionKeepsRecordingSavedMeanwhile(t *testing.T) {
	rh := newResumeHarness(t, time.Minute)
	c := rh.dial()
	startResumable(t, c, "Saved", "m-saving", "p-1")
	last := sendStates(t, c, 2, 1, 3)
	rh.waitSeq("m-saving", last)

	// end_mission is being saved when a session-less discard of the
	// mission arrives: the saved recording stays.
	saving := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	streamTestHooks.beforeSave = func() { close(saving); <-release }
	t.Cleanup(func() { unblock(); streamTestHooks.beforeSave = nil })
	sendEnv(t, c, streaming.TypeEndMission, last+1, nil)
	<-saving
	streamTestHooks.beforeSave = nil

	reached := make(chan struct{})
	var reachedOnce sync.Once
	streamTestHooks.beforeDiscardSession = func() { reachedOnce.Do(func() { close(reached) }) }
	t.Cleanup(func() { streamTestHooks.beforeDiscardSession = nil })
	c2 := rh.dial()
	sendEnv(t, c2, streaming.TypeDiscardMission, 0, discardPayload("m-saving", "p-1"))
	<-reached
	unblock()
	readUntil(t, c, isAckFor(streaming.TypeEndMission))
	readUntil(t, c2, isAckFor(streaming.TypeDiscardMission))
	require.Len(t, rh.ops(), 1, "a recording saved through end_mission is never discarded")
}

func TestStreamDiscard_WithoutSessionHoldsOffStart(t *testing.T) {
	rh := newResumeHarness(t, 100*time.Millisecond)
	c := rh.dial()
	startResumable(t, c, "Expired", "m-held", "p-1")
	rh.waitSeq("m-held", sendStates(t, c, 2, 1, 3))
	c.Close()
	require.Eventually(t, func() bool { return rh.h.streamRegistry().get("m-held") == nil }, 5*time.Second, 10*time.Millisecond)

	// The session-less discard is removing the partial when a start of the
	// same mission arrives: the start waits for it.
	removing := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	streamTestHooks.beforeRemove = func() error { close(removing); <-release; return nil }
	t.Cleanup(func() { unblock(); streamTestHooks.beforeRemove = nil })
	c2 := rh.dial()
	sendEnv(t, c2, streaming.TypeDiscardMission, 0, discardPayload("m-held", "p-1"))
	<-removing
	streamTestHooks.beforeRemove = nil

	c3 := rh.dial()
	sendEnv(t, c3, streaming.TypeStartMission, 1, startPayload("Restarted", "m-held", "p-1"))
	assert.Never(t, func() bool { return rh.h.streamRegistry().get("m-held") != nil }, 200*time.Millisecond, 10*time.Millisecond, "the start waits for the discard")
	unblock()
	readUntil(t, c2, isAckFor(streaming.TypeDiscardMission))
	readUntil(t, c3, isAckFor(streaming.TypeStartMission))
	ops := rh.ops()
	require.Len(t, ops, 1, "only the new start's recording is left")
	assert.Equal(t, "Restarted", ops[0].MissionName)
}

func TestStreamDiscard_FailedSegmentRemovalMarksRowFailed(t *testing.T) {
	rh := newResumeHarness(t, 100*time.Millisecond)
	c := rh.dial()
	startResumable(t, c, "Earlier", "m-part", "p-1")
	rh.waitSeq("m-part", sendStates(t, c, 2, 1, 3))
	c.Close()
	require.Eventually(t, func() bool { return rh.h.streamRegistry().get("m-part") == nil }, 5*time.Second, 10*time.Millisecond)

	// A resend of the mission is discarded, but its earlier segment cannot go.
	c2 := rh.dial()
	startResumable(t, c2, "Resent", "m-part", "p-1")
	last := sendStates(t, c2, 2, 1, 3)
	rh.waitSeq("m-part", last)
	streamTestHooks.beforeRemove = func() error { return errors.New("database is locked") }
	t.Cleanup(func() { streamTestHooks.beforeRemove = nil })
	sendEnv(t, c2, streaming.TypeDiscardMission, last+1, discardPayload("m-part", "p-1"))
	requireClosedUnacknowledged(t, c2)

	statuses := map[string]string{}
	for _, op := range rh.ops() {
		statuses[op.MissionName] = op.ConversionStatus
	}
	assert.Len(t, statuses, 2, "nothing was removed")
	assert.Equal(t, ConversionStatusFailed, statuses["Resent"], "the discarded session's row is no longer live")
}

func TestStreamDiscard_WithoutSessionLeavesFedSession(t *testing.T) {
	rh := newResumeHarness(t, time.Minute)
	c := rh.dial()
	startResumable(t, c, "Fed", "m-fed", "p-1")
	last := sendStates(t, c, 2, 1, 3)
	rh.waitSeq("m-fed", last)

	other := rh.dial()
	sendEnv(t, other, streaming.TypeDiscardMission, 0, discardPayload("m-fed", "p-1"))
	requireClosedUnacknowledged(t, other)

	require.Len(t, rh.ops(), 1, "the live recording stays")
	sendEnv(t, c, streaming.TypeEndMission, last+1, nil)
	readUntil(t, c, isAckFor(streaming.TypeEndMission))
}

func TestStreamDiscard_LosesToSupersede(t *testing.T) {
	rh := newResumeHarness(t, time.Minute)
	c := rh.dial()
	startResumable(t, c, "Superseded", "m-old-d", "p-1")
	last := sendStates(t, c, 2, 1, 3)
	ss := rh.waitSeq("m-old-d", last)
	ss.mu.Lock()
	owner := ss.owner
	ss.mu.Unlock()

	// The producer's next mission supersedes this one before its discard is
	// handled: the discard finds the session taken and is not acknowledged.
	rh.h.expireStream(ss, 0)
	env := streaming.Envelope{Type: streaming.TypeDiscardMission, Seq: last + 1}
	assert.Equal(t, endTakenOver, rh.h.discardStream(ss, owner, env))
	requireClosedUnacknowledged(t, c)
	require.Len(t, rh.opsByMission("m-old-d"), 1, "saved as partial by the supersede")

	// The producer finishes the discard without a session.
	c2 := rh.dial()
	sendEnv(t, c2, streaming.TypeResume, 0, streaming.ResumePayload{MissionID: "m-old-d", ProducerID: "p-1"})
	readUntil(t, c2, isType(streaming.ServerResumeUnknown))
	sendEnv(t, c2, streaming.TypeDiscardMission, 0, discardPayload("m-old-d", "p-1"))
	readUntil(t, c2, isAckFor(streaming.TypeDiscardMission))
	assert.Empty(t, rh.opsByMission("m-old-d"))
}

func TestStreamDiscard_WithoutSessionFailedRemoval(t *testing.T) {
	rh := newResumeHarness(t, 100*time.Millisecond)
	c := rh.dial()
	startResumable(t, c, "Expired", "m-exp-f", "p-1")
	rh.waitSeq("m-exp-f", sendStates(t, c, 2, 1, 3))
	c.Close()
	require.Eventually(t, func() bool { return rh.h.streamRegistry().get("m-exp-f") == nil }, 5*time.Second, 10*time.Millisecond)

	streamTestHooks.beforeRemove = func() error { return errors.New("database is locked") }
	t.Cleanup(func() { streamTestHooks.beforeRemove = nil })
	c2 := rh.dial()
	sendEnv(t, c2, streaming.TypeDiscardMission, 0, discardPayload("m-exp-f", "p-1"))
	requireClosedUnacknowledged(t, c2)
	require.Len(t, rh.ops(), 1)
}
