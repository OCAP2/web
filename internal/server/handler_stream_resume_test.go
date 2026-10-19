package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/OCAP2/extension/v5/pkg/streaming"
	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// resumeHarness drives the stream endpoint with the resumable protocol.
type resumeHarness struct {
	t   *testing.T
	h   *Handler
	srv *httptest.Server
	dir string
}

func newResumeHarness(t *testing.T, grace time.Duration) *resumeHarness {
	t.Helper()
	h, mux, dir := newTestStreamHandlerWithRepo(t)
	h.setting.Streaming.ResumeGrace = grace
	h.setting.Streaming.AckInterval = 20 * time.Millisecond
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return &resumeHarness{t: t, h: h, srv: srv, dir: dir}
}

func (rh *resumeHarness) dial() *websocket.Conn {
	rh.t.Helper()
	c, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(rh.srv.URL, "http")+"/api/v1/stream?secret=test-secret", nil)
	require.NoError(rh.t, err)
	rh.t.Cleanup(func() { c.Close() })
	return c
}

func sendEnv(t *testing.T, c *websocket.Conn, typ string, seq uint64, payload any) {
	t.Helper()
	raw, err := json.Marshal(payload)
	require.NoError(t, err)
	require.NoError(t, c.WriteJSON(streaming.Envelope{Type: typ, Seq: seq, Payload: raw}))
}

// readUntil reads server messages until match, skipping cumulative acks.
func readUntil(t *testing.T, c *websocket.Conn, match func(streaming.AckMessage) bool) streaming.AckMessage {
	t.Helper()
	c.SetReadDeadline(time.Now().Add(5 * time.Second))
	defer c.SetReadDeadline(time.Time{})
	for {
		var m streaming.AckMessage
		require.NoError(t, c.ReadJSON(&m))
		if match(m) {
			return m
		}
	}
}

func isAckFor(typ string) func(streaming.AckMessage) bool {
	return func(m streaming.AckMessage) bool { return m.Type == streaming.ServerAck && m.For == typ }
}

func isType(typ string) func(streaming.AckMessage) bool {
	return func(m streaming.AckMessage) bool { return m.Type == typ }
}

func startPayload(name, missionID, producerID string) map[string]any {
	return map[string]any{
		"mission":         map[string]any{"MissionName": name, "CaptureDelay": 1.0, "Tag": "TvT"},
		"world":           map[string]any{"WorldName": "altis"},
		"frameBase":       1,
		"missionId":       missionID,
		"producerId":      producerID,
		"protocolVersion": streaming.ProtocolVersionResume,
	}
}

// startResumable starts a mission as seq 1 and returns the ack.
func startResumable(t *testing.T, c *websocket.Conn, name, missionID, producerID string) streaming.AckMessage {
	t.Helper()
	sendEnv(t, c, streaming.TypeStartMission, 1, startPayload(name, missionID, producerID))
	return readUntil(t, c, isAckFor(streaming.TypeStartMission))
}

func soldierState(frame int) map[string]any {
	return map[string]any{"SoldierID": 1, "CaptureFrame": frame, "Position": map[string]any{"x": frame, "y": 1, "z": 0}}
}

// sendStates sends soldier states for frames from..to as envelopes seq+1...
func sendStates(t *testing.T, c *websocket.Conn, firstSeq uint64, from, to int) uint64 {
	t.Helper()
	seq := firstSeq
	for f := from; f <= to; f++ {
		sendEnv(t, c, streaming.TypeSoldierState, seq, soldierState(f))
		seq++
	}
	return seq - 1
}

func (rh *resumeHarness) waitSeq(missionID string, seq uint64) *streamSession {
	rh.t.Helper()
	var ss *streamSession
	require.Eventually(rh.t, func() bool {
		ss = rh.h.streamRegistry().get(missionID)
		return ss != nil && ss.lastSeq.Load() == seq
	}, 5*time.Second, 5*time.Millisecond)
	return ss
}

func (rh *resumeHarness) ops() []Operation {
	rh.t.Helper()
	ops, err := rh.h.repoOperation.Select(context.Background(), Filter{})
	require.NoError(rh.t, err)
	return ops
}

func (rh *resumeHarness) counts(ss *streamSession, typ string) int {
	ss.mu.Lock()
	defer ss.mu.Unlock()
	return ss.counts[typ]
}

func TestStreamResume_StartAckAdvertisesResume(t *testing.T) {
	rh := newResumeHarness(t, time.Minute)
	c := rh.dial()
	ack := startResumable(t, c, "Advertise", "m-1", "p-1")
	assert.Equal(t, uint8(streaming.ProtocolVersionResume), ack.ProtocolVersion)
	assert.Equal(t, uint64(1), ack.Seq)
	assert.NotNil(t, rh.h.streamRegistry().get("m-1"))
}

func TestStreamResume_LegacyStartIsNotRegistered(t *testing.T) {
	rh := newResumeHarness(t, time.Minute)
	c := rh.dial()
	sendStartMission(t, c, "Legacy", "altis")
	assert.Zero(t, rh.h.streamRegistry().count())
}

func TestStreamResume_CumulativeAcks(t *testing.T) {
	rh := newResumeHarness(t, time.Minute)
	c := rh.dial()
	startResumable(t, c, "Acks", "m-acks", "p-1")
	last := sendStates(t, c, 2, 1, 10)
	m := readUntil(t, c, func(m streaming.AckMessage) bool {
		return m.Type == streaming.ServerAck && m.For == "" && m.Seq == last
	})
	assert.Equal(t, uint64(11), m.Seq)
}

func TestStreamResume_ReconnectContinuesSameRecording(t *testing.T) {
	rh := newResumeHarness(t, time.Minute)
	c1 := rh.dial()
	startResumable(t, c1, "Resume", "m-r", "p-1")
	sendEnv(t, c1, streaming.TypeAddSoldier, 2, map[string]any{"ID": 1, "JoinFrame": 1, "UnitName": "P1", "Side": "WEST", "IsPlayer": true})
	last := sendStates(t, c1, 3, 1, 20)
	rh.waitSeq("m-r", last)
	c1.Close() // network drops

	c2 := rh.dial()
	sendEnv(t, c2, streaming.TypeResume, 0, streaming.ResumePayload{MissionID: "m-r", ProducerID: "p-1"})
	ok := readUntil(t, c2, isType(streaming.ServerResumeOK))
	require.Equal(t, last, ok.Seq)

	// The producer may resend envelopes the server already holds.
	sendStates(t, c2, last-4, 16, 20)
	last = sendStates(t, c2, last+1, 21, 30)
	ss := rh.waitSeq("m-r", last)
	assert.Equal(t, 30, rh.counts(ss, streaming.TypeSoldierState), "resent envelopes are applied once")

	sendEnv(t, c2, streaming.TypeEndMission, last+1, nil)
	end := readUntil(t, c2, isAckFor(streaming.TypeEndMission))
	assert.Equal(t, last+1, end.Seq)

	ops := rh.ops()
	require.Len(t, ops, 1, "one recording, not two segments")
	assert.Equal(t, "TvT", ops[0].Tag, "a resumed recording is complete")
	assert.Equal(t, ConversionStatusCompleted, ops[0].ConversionStatus)
	assert.FileExists(t, rh.dir+"/"+ops[0].Filename+"/manifest.pb")
	assert.Nil(t, rh.h.streamRegistry().get("m-r"))
}

func TestStreamResume_GraceExpirySavesPartial(t *testing.T) {
	rh := newResumeHarness(t, 100*time.Millisecond)
	c := rh.dial()
	startResumable(t, c, "Expire", "m-e", "p-1")
	last := sendStates(t, c, 2, 1, 5)
	rh.waitSeq("m-e", last)
	c.Close()

	require.Eventually(t, func() bool { return rh.h.streamRegistry().get("m-e") == nil }, 5*time.Second, 10*time.Millisecond)
	ops := rh.ops()
	require.Len(t, ops, 1)
	assert.Equal(t, "TvT,partial", ops[0].Tag)
	assert.Equal(t, ConversionStatusCompleted, ops[0].ConversionStatus)

	// The producer comes back too late: the server no longer holds the mission.
	c2 := rh.dial()
	sendEnv(t, c2, streaming.TypeResume, 0, streaming.ResumePayload{MissionID: "m-e", ProducerID: "p-1"})
	readUntil(t, c2, isType(streaming.ServerResumeUnknown))
}

func TestStreamResume_ResumeWithinGraceKeepsSession(t *testing.T) {
	rh := newResumeHarness(t, 300*time.Millisecond)
	c := rh.dial()
	startResumable(t, c, "Grace", "m-g", "p-1")
	c.Close()
	time.Sleep(100 * time.Millisecond)

	c2 := rh.dial()
	sendEnv(t, c2, streaming.TypeResume, 0, streaming.ResumePayload{MissionID: "m-g", ProducerID: "p-1"})
	readUntil(t, c2, isType(streaming.ServerResumeOK))
	time.Sleep(400 * time.Millisecond) // past the original grace deadline
	require.NotNil(t, rh.h.streamRegistry().get("m-g"), "a resumed session is not expired")
	assert.Equal(t, ConversionStatusStreaming, rh.ops()[0].ConversionStatus, "still recording, not saved as partial")
}

func TestStreamResume_CompletedMission(t *testing.T) {
	rh := newResumeHarness(t, time.Minute)
	c := rh.dial()
	startResumable(t, c, "Done", "m-d", "p-1")
	sendEnv(t, c, streaming.TypeEndMission, 2, nil)
	readUntil(t, c, isAckFor(streaming.TypeEndMission))

	// The end ack was lost on the producer side; it reconnects.
	c2 := rh.dial()
	sendEnv(t, c2, streaming.TypeResume, 0, streaming.ResumePayload{MissionID: "m-d", ProducerID: "p-1"})
	readUntil(t, c2, isType(streaming.ServerResumeCompleted))
	assert.Len(t, rh.ops(), 1)
}

func TestStreamResume_UnknownMission(t *testing.T) {
	rh := newResumeHarness(t, time.Minute)
	c := rh.dial()
	sendEnv(t, c, streaming.TypeResume, 0, streaming.ResumePayload{MissionID: "nope", ProducerID: "p-1"})
	readUntil(t, c, isType(streaming.ServerResumeUnknown))
	sendEnv(t, c, streaming.TypeResume, 0, nil)
	readUntil(t, c, isType(streaming.ServerResumeUnknown))
}

func TestStreamResume_OtherProducerCannotResume(t *testing.T) {
	rh := newResumeHarness(t, time.Minute)
	c := rh.dial()
	startResumable(t, c, "Owned", "m-o", "p-1")
	c.Close()

	c2 := rh.dial()
	sendEnv(t, c2, streaming.TypeResume, 0, streaming.ResumePayload{MissionID: "m-o", ProducerID: "p-2"})
	readUntil(t, c2, isType(streaming.ServerResumeUnknown))

	c3 := rh.dial()
	sendEnv(t, c3, streaming.TypeStartMission, 1, startPayload("Owned", "m-o", "p-2"))
	c3.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, _, err := c3.ReadMessage()
	require.Error(t, err, "a mission id of another producer is refused")
	assert.True(t, websocket.IsCloseError(err, websocket.CloseInternalServerErr), "%v", err)
}

func TestStreamResume_TakeoverClosesHalfOpenConnection(t *testing.T) {
	rh := newResumeHarness(t, time.Minute)
	c1 := rh.dial()
	startResumable(t, c1, "Takeover", "m-t", "p-1")
	last := sendStates(t, c1, 2, 1, 5)
	rh.waitSeq("m-t", last)

	// c1 is still open on the server (half-open); the producer reconnects.
	c2 := rh.dial()
	sendEnv(t, c2, streaming.TypeResume, 0, streaming.ResumePayload{MissionID: "m-t", ProducerID: "p-1"})
	readUntil(t, c2, isType(streaming.ServerResumeOK))

	c1.SetReadDeadline(time.Now().Add(2 * time.Second))
	for {
		if _, _, err := c1.ReadMessage(); err != nil {
			break // the server dropped the predecessor
		}
	}
	// A late write on the old socket must not reach the session.
	_ = c1.WriteJSON(streaming.Envelope{Type: streaming.TypeSoldierState, Seq: last + 1, Payload: json.RawMessage(`{"SoldierID":1,"CaptureFrame":99}`)})

	last = sendStates(t, c2, last+1, 6, 10)
	ss := rh.waitSeq("m-t", last)
	assert.Equal(t, 10, rh.counts(ss, streaming.TypeSoldierState))
	sendEnv(t, c2, streaming.TypeEndMission, last+1, nil)
	readUntil(t, c2, isAckFor(streaming.TypeEndMission))
	assert.Len(t, rh.ops(), 1)
}

func TestStreamResume_ParallelProducersAreIndependent(t *testing.T) {
	rh := newResumeHarness(t, time.Minute)
	a := rh.dial()
	b := rh.dial()
	startResumable(t, a, "Server A", "m-a", "p-a")
	startResumable(t, b, "Server B", "m-b", "p-b")

	lastA := sendStates(t, a, 2, 1, 10)
	lastB := sendStates(t, b, 2, 1, 10)
	rh.waitSeq("m-a", lastA)
	rh.waitSeq("m-b", lastB)

	a.Close() // only server A loses its network
	lastB = sendStates(t, b, lastB+1, 11, 20)
	rh.waitSeq("m-b", lastB)
	sendEnv(t, b, streaming.TypeEndMission, lastB+1, nil)
	readUntil(t, b, isAckFor(streaming.TypeEndMission))

	a2 := rh.dial()
	sendEnv(t, a2, streaming.TypeResume, 0, streaming.ResumePayload{MissionID: "m-a", ProducerID: "p-a"})
	ok := readUntil(t, a2, isType(streaming.ServerResumeOK))
	require.Equal(t, lastA, ok.Seq)
	lastA = sendStates(t, a2, lastA+1, 11, 20)
	sendEnv(t, a2, streaming.TypeEndMission, lastA+1, nil)
	readUntil(t, a2, isAckFor(streaming.TypeEndMission))

	ops := rh.ops()
	require.Len(t, ops, 2)
	for _, op := range ops {
		assert.Equal(t, "TvT", op.Tag, "%s must be complete", op.MissionName)
	}
}

func TestStreamResume_NewMissionSupersedesProducersOldOne(t *testing.T) {
	rh := newResumeHarness(t, time.Hour)
	c := rh.dial()
	startResumable(t, c, "Old", "m-old", "p-1")
	other := rh.dial()
	startResumable(t, other, "Other", "m-other", "p-2")
	c.Close() // waiting for resume, an hour of grace

	// The game server restarted and records a new mission.
	c2 := rh.dial()
	startResumable(t, c2, "New", "m-new", "p-1")
	require.Eventually(t, func() bool { return rh.h.streamRegistry().get("m-old") == nil }, 5*time.Second, 10*time.Millisecond)
	assert.NotNil(t, rh.h.streamRegistry().get("m-other"), "another producer's mission is untouched")

	var old Operation
	for _, op := range rh.ops() {
		if op.MissionName == "Old" {
			old = op
		}
	}
	assert.Equal(t, "TvT,partial", old.Tag)
}

func TestStreamResume_RepeatedStartReusesSession(t *testing.T) {
	rh := newResumeHarness(t, time.Minute)
	c := rh.dial()
	startResumable(t, c, "Repeat", "m-rep", "p-1")
	last := sendStates(t, c, 2, 1, 3)
	rh.waitSeq("m-rep", last)
	c.Close()

	// The start ack was lost: the producer reconnects and repeats the start.
	c2 := rh.dial()
	ack := startResumable(t, c2, "Repeat", "m-rep", "p-1")
	assert.Equal(t, last, ack.Seq, "the ack reports everything the server holds")
	assert.Len(t, rh.ops(), 1)
}

func TestStreamResume_GapMarksPartial(t *testing.T) {
	rh := newResumeHarness(t, time.Minute)
	c := rh.dial()
	startResumable(t, c, "Gap", "m-gap", "p-1")
	sendEnv(t, c, streaming.TypeSoldierState, 2, soldierState(1))
	sendEnv(t, c, streaming.TypeSoldierState, 5, soldierState(4)) // 3 and 4 never arrive
	sendEnv(t, c, streaming.TypeEndMission, 6, nil)
	readUntil(t, c, isAckFor(streaming.TypeEndMission))
	ops := rh.ops()
	require.Len(t, ops, 1)
	assert.Equal(t, "TvT,partial", ops[0].Tag)
}

func TestWithPartialTag(t *testing.T) {
	assert.Equal(t, "partial", withPartialTag(""))
	assert.Equal(t, "TvT,partial", withPartialTag("TvT"))
	assert.Equal(t, "TvT,partial", withPartialTag("TvT,partial"))
	assert.Equal(t, "partial, TvT", withPartialTag("partial, TvT"))
}

func TestStreamRegistryCompletedExpires(t *testing.T) {
	r := newStreamRegistry()
	s := &streamSession{missionID: "m"}
	got, err := r.reserve("m", time.Second)
	require.NoError(t, err)
	require.Nil(t, got)
	r.settle("m", s)
	r.remove(s, true)
	assert.True(t, r.isCompleted("m"))
	r.completed["m"] = time.Now().Add(-2 * completedTTL)
	assert.False(t, r.isCompleted("m"))
	r.remove(&streamSession{missionID: "n"}, true) // prunes stale entries
	_, stale := r.completed["m"]
	assert.False(t, stale)
}

// restart replaces the web server with a fresh process image: same database
// and data directory, empty session registry.
func (rh *resumeHarness) restart() {
	rh.t.Helper()
	rh.srv.Close()
	h := &Handler{repoOperation: rh.h.repoOperation, setting: rh.h.setting}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/stream", h.HandleStream)
	rh.h = h
	rh.srv = httptest.NewServer(mux)
	rh.t.Cleanup(rh.srv.Close)
}

func (rh *resumeHarness) opsByMission(missionID string) []StreamSegment {
	rh.t.Helper()
	segs, err := rh.h.repoOperation.StreamSegments(context.Background(), missionID, 0)
	require.NoError(rh.t, err)
	return segs
}

// replayMission sends start_mission, frames 1..frames as envelopes 2.., and
// end_mission, as a producer resending a mission in full.
func replayMission(t *testing.T, c *websocket.Conn, name, missionID, producerID string, frames int) {
	t.Helper()
	startResumable(t, c, name, missionID, producerID)
	last := sendStates(t, c, 2, 1, frames)
	sendEnv(t, c, streaming.TypeEndMission, last+1, nil)
	readUntil(t, c, isAckFor(streaming.TypeEndMission))
}

func TestStreamResume_FullReplayReplacesPartialSegment(t *testing.T) {
	rh := newResumeHarness(t, 100*time.Millisecond)
	c := rh.dial()
	startResumable(t, c, "Replay", "m-full", "p-1")
	sendStates(t, c, 2, 1, 5)
	rh.waitSeq("m-full", 6)
	c.Close()
	// The producer stays away past the grace period: a partial segment is saved.
	require.Eventually(t, func() bool { return rh.h.streamRegistry().get("m-full") == nil }, 5*time.Second, 10*time.Millisecond)
	segs := rh.opsByMission("m-full")
	require.Len(t, segs, 1)
	partial := segs[0]

	// It returns, learns the server lost the mission, and resends it in full.
	c2 := rh.dial()
	sendEnv(t, c2, streaming.TypeResume, 0, streaming.ResumePayload{MissionID: "m-full", ProducerID: "p-1"})
	readUntil(t, c2, isType(streaming.ServerResumeUnknown))
	replayMission(t, c2, "Replay", "m-full", "p-1", 10)

	ops := rh.ops()
	require.Len(t, ops, 1, "the complete recording replaces the partial segment")
	assert.Equal(t, "TvT", ops[0].Tag)
	assert.NotEqual(t, partial.Filename, ops[0].Filename)
	assert.NoDirExists(t, filepath.Join(rh.dir, partial.Filename))
	assert.NoFileExists(t, filepath.Join(rh.dir, partial.Filename+".json.gz"))
	assert.DirExists(t, filepath.Join(rh.dir, ops[0].Filename))
}

func TestStreamResume_WebRestartMidMission(t *testing.T) {
	rh := newResumeHarness(t, time.Minute)
	c := rh.dial()
	startResumable(t, c, "Restart", "m-restart", "p-1")
	sendStates(t, c, 2, 1, 5)
	rh.waitSeq("m-restart", 6)
	c.Close()
	rh.restart() // the session in memory is gone; its row stays "streaming"

	c2 := rh.dial()
	sendEnv(t, c2, streaming.TypeResume, 0, streaming.ResumePayload{MissionID: "m-restart", ProducerID: "p-1"})
	readUntil(t, c2, isType(streaming.ServerResumeUnknown))
	replayMission(t, c2, "Restart", "m-restart", "p-1", 10)

	ops := rh.ops()
	require.Len(t, ops, 1, "the interrupted row is replaced")
	assert.Equal(t, "TvT", ops[0].Tag)
	assert.Equal(t, ConversionStatusCompleted, ops[0].ConversionStatus)
}

func TestStreamResume_SavedMissionKnownAfterRestart(t *testing.T) {
	rh := newResumeHarness(t, time.Minute)
	c := rh.dial()
	replayMission(t, c, "Saved", "m-saved", "p-1", 3)
	rh.restart()

	// The end_mission ack was lost; the producer asks after the restart.
	c2 := rh.dial()
	sendEnv(t, c2, streaming.TypeResume, 0, streaming.ResumePayload{MissionID: "m-saved", ProducerID: "p-1"})
	readUntil(t, c2, isType(streaming.ServerResumeCompleted))
	assert.Len(t, rh.ops(), 1)
}

func TestStreamResume_IncompleteReplayKeepsEarlierSegments(t *testing.T) {
	rh := newResumeHarness(t, 100*time.Millisecond)
	c := rh.dial()
	startResumable(t, c, "Holes", "m-holes", "p-1")
	sendStates(t, c, 2, 1, 5)
	rh.waitSeq("m-holes", 6)
	c.Close()
	require.Eventually(t, func() bool { return rh.h.streamRegistry().get("m-holes") == nil }, 5*time.Second, 10*time.Millisecond)

	// A replay with a numbering gap is no better than what is saved: keep both.
	c2 := rh.dial()
	startResumable(t, c2, "Holes", "m-holes", "p-1")
	sendEnv(t, c2, streaming.TypeSoldierState, 2, soldierState(1))
	sendEnv(t, c2, streaming.TypeSoldierState, 9, soldierState(8))
	sendEnv(t, c2, streaming.TypeEndMission, 10, nil)
	readUntil(t, c2, isAckFor(streaming.TypeEndMission))
	assert.Len(t, rh.ops(), 2)
}

func TestStreamResume_ReplacementLeavesOtherMissionsAlone(t *testing.T) {
	rh := newResumeHarness(t, time.Minute)
	other := rh.dial()
	replayMission(t, other, "Other", "m-other2", "p-2", 3)
	c := rh.dial()
	replayMission(t, c, "Mine", "m-mine", "p-1", 3)
	assert.Len(t, rh.ops(), 2)
}

func TestFailInterruptedStreams(t *testing.T) {
	rh := newResumeHarness(t, time.Minute)
	c := rh.dial()
	startResumable(t, c, "Interrupted", "m-int", "p-1")
	done := rh.dial()
	replayMission(t, done, "Done", "m-done", "p-2", 3)

	// The server stops while the first mission streams.
	n, err := FailInterruptedStreams(context.Background(), rh.h.repoOperation)
	require.NoError(t, err)
	assert.Equal(t, int64(1), n)
	for _, op := range rh.ops() {
		if op.MissionName == "Interrupted" {
			assert.Equal(t, ConversionStatusFailed, op.ConversionStatus, "no longer shown as live")
		} else {
			assert.Equal(t, ConversionStatusCompleted, op.ConversionStatus)
		}
	}
}

func TestStreamResume_InterruptedEndSavesPartial(t *testing.T) {
	rh := newResumeHarness(t, 100*time.Millisecond)
	c := rh.dial()
	startResumable(t, c, "Crashed", "m-crash", "p-1")
	sendStates(t, c, 2, 1, 5)
	rh.waitSeq("m-crash", 6)
	c.Close() // the game server crashed; the session expires as partial
	require.Eventually(t, func() bool { return rh.h.streamRegistry().get("m-crash") == nil }, 5*time.Second, 10*time.Millisecond)

	// After its restart the extension recovers the mission from its spool and
	// ends it on the crashed process' behalf.
	c2 := rh.dial()
	sendEnv(t, c2, streaming.TypeResume, 0, streaming.ResumePayload{MissionID: "m-crash", ProducerID: "p-1"})
	readUntil(t, c2, isType(streaming.ServerResumeUnknown))
	startResumable(t, c2, "Crashed", "m-crash", "p-1")
	last := sendStates(t, c2, 2, 1, 8)
	sendEnv(t, c2, streaming.TypeEndMission, last+1, streaming.EndMissionPayload{Interrupted: true})
	readUntil(t, c2, isAckFor(streaming.TypeEndMission))

	ops := rh.ops()
	require.Len(t, ops, 1, "the recovered recording replaces the expired segment")
	assert.Equal(t, "TvT,partial", ops[0].Tag, "an interrupted mission is partial")
	ended, err := rh.h.repoOperation.StreamEnded(context.Background(), "m-crash")
	require.NoError(t, err)
	assert.True(t, ended, "a later resume learns it is saved")
}

func TestStreamResume_MaxSessions(t *testing.T) {
	rh := newResumeHarness(t, time.Minute)
	rh.h.setting.Streaming.MaxSessions = 1
	a := rh.dial()
	startResumable(t, a, "A", "m-a1", "p-a")

	// A second mission is refused while the first holds the only slot.
	b := rh.dial()
	sendEnv(t, b, streaming.TypeStartMission, 1, startPayload("B", "m-b1", "p-b"))
	b.SetReadDeadline(time.Now().Add(2 * time.Second))
	_, _, err := b.ReadMessage()
	require.True(t, websocket.IsCloseError(err, websocket.CloseInternalServerErr), "%v", err)
	assert.Len(t, rh.ops(), 1, "no row for the refused mission")

	// Continuing the admitted mission needs no new slot.
	a.Close()
	a2 := rh.dial()
	sendEnv(t, a2, streaming.TypeResume, 0, streaming.ResumePayload{MissionID: "m-a1", ProducerID: "p-a"})
	readUntil(t, a2, isType(streaming.ServerResumeOK))
	sendEnv(t, a2, streaming.TypeEndMission, 2, nil)
	readUntil(t, a2, isAckFor(streaming.TypeEndMission))
	assert.Zero(t, rh.h.streamRegistry().activeCount())

	// The freed slot admits the producer's retry.
	b2 := rh.dial()
	startResumable(t, b2, "B", "m-b1", "p-b")
}

func TestStreamResume_SlotsReleasedOnEveryEnding(t *testing.T) {
	rh := newResumeHarness(t, 100*time.Millisecond)
	reg := rh.h.streamRegistry()

	saved := rh.dial()
	replayMission(t, saved, "Saved", "m-s", "p-1", 2)
	expired := rh.dial()
	startResumable(t, expired, "Expired", "m-x", "p-2")
	expired.Close()
	legacy := rh.dial()
	sendStartMission(t, legacy, "Legacy", "altis")
	legacy.Close()
	old := rh.dial()
	startResumable(t, old, "Old", "m-old", "p-3")
	old.Close()
	superseding := rh.dial()
	startResumable(t, superseding, "New", "m-new", "p-3") // supersedes m-old

	require.Eventually(t, func() bool { return reg.activeCount() == 1 }, 5*time.Second, 10*time.Millisecond, "only the newest mission is still active")
}

func TestStreamResume_LiveMetadataThrottled(t *testing.T) {
	old := streamMetaInterval
	streamMetaInterval = time.Hour
	t.Cleanup(func() { streamMetaInterval = old })

	rh := newResumeHarness(t, time.Minute)
	c := rh.dial()
	startResumable(t, c, "Meta", "m-meta", "p-1")
	// Envelopes are handled in order: once the next one is accepted, the
	// previous one, database write included, is done.
	barrier := func(seq uint64) {
		sendEnv(t, c, streaming.TypeSoldierState, seq, soldierState(1))
		rh.waitSeq("m-meta", seq)
	}
	sendEnv(t, c, streaming.TypeTelemetry, 2, map[string]any{"CaptureFrame": 10})
	barrier(3)
	first := rh.ops()[0].MissionDuration
	require.Positive(t, first)

	sendEnv(t, c, streaming.TypeTelemetry, 4, map[string]any{"CaptureFrame": 500})
	barrier(5)
	assert.Equal(t, first, rh.ops()[0].MissionDuration, "a second write within the interval is skipped")

	streamMetaInterval = 0
	sendEnv(t, c, streaming.TypeTelemetry, 6, map[string]any{"CaptureFrame": 600})
	barrier(7)
	assert.Greater(t, rh.ops()[0].MissionDuration, first)
}

func TestStreamResume_EndNotAcknowledgedBeforeSaveSucceeds(t *testing.T) {
	rh := newResumeHarness(t, time.Minute)
	c := rh.dial()
	startResumable(t, c, "SlowFail", "m-slow", "p-1")
	last := sendStates(t, c, 2, 1, 3)
	rh.waitSeq("m-slow", last)

	// The save is slow, then fails: a directory blocks the legacy backup.
	ops := rh.ops()
	require.Len(t, ops, 1)
	require.NoError(t, os.Mkdir(filepath.Join(rh.dir, ops[0].Filename+".json.gz"), 0o755))
	release := make(chan struct{})
	var releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(release) }) }
	streamTestHooks.beforeSave = func() { <-release }
	// Registered after the harness, so it runs first: a failing assertion
	// must not leave the save blocked while cleanup waits for it.
	t.Cleanup(func() { unblock(); streamTestHooks.beforeSave = nil })

	// Collect every server message until the connection closes.
	type received struct {
		msg streaming.AckMessage
		err error
	}
	msgs := make(chan received, 64)
	go func() {
		for {
			var m streaming.AckMessage
			err := c.ReadJSON(&m)
			msgs <- received{m, err}
			if err != nil {
				return
			}
		}
	}()

	endSeq := last + 1
	sendEnv(t, c, streaming.TypeEndMission, endSeq, nil)
	// Several acknowledgement ticks pass while the save is held.
	hold := time.After(300 * time.Millisecond)
holding:
	for {
		select {
		case r := <-msgs:
			require.NoError(t, r.err)
			require.Less(t, r.msg.Seq, endSeq, "end_mission acknowledged before its save completed: %+v", r.msg)
		case <-hold:
			break holding
		}
	}
	unblock()

	timeout := time.After(5 * time.Second)
	for {
		select {
		case r := <-msgs:
			if r.err != nil {
				require.True(t, websocket.IsCloseError(r.err, websocket.CloseInternalServerErr), "%v", r.err)
				return
			}
			require.Less(t, r.msg.Seq, endSeq, "a failed save must not acknowledge end_mission: %+v", r.msg)
		case <-timeout:
			t.Fatal("the failed save did not close the connection")
		}
	}
}

func TestStreamResume_ConcurrentRepeatedStartsShareOneSession(t *testing.T) {
	rh := newResumeHarness(t, time.Minute)
	entered := make(chan struct{}, 2)
	release := make(chan struct{})
	var releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(release) }) }
	streamTestHooks.beforeCreate = func() {
		entered <- struct{}{}
		<-release
	}
	t.Cleanup(func() { unblock(); streamTestHooks.beforeCreate = nil })

	// The first start is held while it sets the mission up...
	first := rh.dial()
	sendEnv(t, first, streaming.TypeStartMission, 1, startPayload("Race", "m-race", "p-1"))
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("first start did not reach setup")
	}
	// ...when the producer reconnects and repeats it.
	second := rh.dial()
	sendEnv(t, second, streaming.TypeStartMission, 1, startPayload("Race", "m-race", "p-1"))
	time.Sleep(100 * time.Millisecond)
	select {
	case <-entered:
		t.Fatal("the repeated start set up a second session")
	default:
	}
	unblock()

	ack := readUntil(t, second, isAckFor(streaming.TypeStartMission))
	assert.Equal(t, uint8(streaming.ProtocolVersionResume), ack.ProtocolVersion)
	assert.Len(t, rh.ops(), 1, "one recording for one mission")
	assert.Equal(t, 1, rh.h.streamRegistry().activeCount(), "one admission for one mission")

	// The repeated start took the session over and closed the first connection.
	first.SetReadDeadline(time.Now().Add(2 * time.Second))
	for {
		if _, _, err := first.ReadMessage(); err != nil {
			break
		}
	}
	sendEnv(t, second, streaming.TypeEndMission, 2, nil)
	readUntil(t, second, isAckFor(streaming.TypeEndMission))
}

func TestStreamRegistryReserveWaitsForConcurrentStart(t *testing.T) {
	r := newStreamRegistry()
	got, err := r.reserve("m", time.Second)
	require.NoError(t, err)
	require.Nil(t, got, "reserved")

	// A second start waits, and fails when the first never finishes.
	_, err = r.reserve("m", 50*time.Millisecond)
	require.ErrorIs(t, err, errReserveTimeout)

	// A failed first start frees the id for the next one.
	r.settle("m", nil)
	got, err = r.reserve("m", time.Second)
	require.NoError(t, err)
	require.Nil(t, got)

	s := &streamSession{missionID: "m"}
	done := make(chan *streamSession)
	go func() { got, _ := r.reserve("m", time.Second); done <- got }()
	time.Sleep(20 * time.Millisecond)
	r.settle("m", s)
	assert.Same(t, s, <-done, "the waiting start gets the session")
}
