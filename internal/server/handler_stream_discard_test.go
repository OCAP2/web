package server

import (
	"os"
	"strings"
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
