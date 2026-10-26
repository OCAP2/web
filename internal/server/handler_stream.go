package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/OCAP2/extension/v5/pkg/streaming"
	"github.com/OCAP2/web/internal/ingestion"
	"github.com/OCAP2/web/internal/storage"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	// Allow non-browser clients (no Origin header, e.g. Arma extension).
	// Reject browser requests that include an Origin header.
	CheckOrigin: func(r *http.Request) bool { return r.Header.Get("Origin") == "" },
}

// HandleStream upgrades to WebSocket and processes streaming mission data.
func (h *Handler) HandleStream(w http.ResponseWriter, r *http.Request) {
	if !h.setting.Streaming.Enabled {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	if r.URL.Query().Get("secret") != h.setting.Secret {
		w.WriteHeader(http.StatusForbidden)
		return
	}

	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer ws.Close()

	h.streamLoop(ws)
}

// ackBatch acknowledges a resumable producer early during bursts, between
// ack ticks, so its buffer is released promptly.
const ackBatch = 500

func (h *Handler) streamLoop(ws *websocket.Conn) {
	// Ping/pong keepalive
	pingInterval := h.setting.Streaming.PingInterval
	pingTimeout := h.setting.Streaming.PingTimeout
	if pingInterval <= 0 {
		pingInterval = 30 * time.Second
	}
	if pingTimeout <= 0 {
		pingTimeout = 10 * time.Second
	}

	var mu sync.Mutex
	ws.SetPongHandler(func(string) error {
		return ws.SetReadDeadline(time.Now().Add(pingInterval + pingTimeout))
	})
	ws.SetReadDeadline(time.Now().Add(pingInterval + pingTimeout))

	// Ping ticker
	done := make(chan struct{})
	go func() {
		ticker := time.NewTicker(pingInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				mu.Lock()
				err := ws.WriteControl(websocket.PingMessage, nil, time.Now().Add(pingTimeout))
				mu.Unlock()
				if err != nil {
					slog.Warn("stream: failed to write ping", "error", err)
					return
				}
			case <-done:
				return
			}
		}
	}()
	defer close(done)

	conn := &streamConn{ws: ws, writeMu: &mu}
	var current atomic.Pointer[streamSession] // the recording this connection feeds
	var acked atomic.Uint64                   // highest envelope acknowledged on this connection

	writeJSON := func(v any) {
		data, _ := json.Marshal(v)
		mu.Lock()
		ws.WriteMessage(websocket.TextMessage, data)
		mu.Unlock()
	}
	// ackProgress tells a resumable producer which envelopes it may release.
	ackProgress := func() {
		ss := current.Load()
		if ss == nil || !ss.resumable() {
			return
		}
		seq := ss.lastSeq.Load()
		if seq <= acked.Load() {
			return
		}
		acked.Store(seq)
		writeJSON(streaming.AckMessage{Type: streaming.ServerAck, Seq: seq})
	}
	ackInterval := h.setting.Streaming.AckInterval
	if ackInterval <= 0 {
		ackInterval = time.Second
	}
	go func() {
		ticker := time.NewTicker(ackInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				ackProgress()
			case <-done:
				return
			}
		}
	}()
	attach := func(ss *streamSession) {
		current.Store(ss)
		acked.Store(ss.lastSeq.Load())
	}

	defer func() {
		if ss := current.Load(); ss != nil {
			h.detachStream(ss, conn)
		}
	}()
	fail := func(reason string) {
		ws.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseInternalServerErr, reason), time.Now().Add(pingTimeout))
	}

	for {
		_, msg, err := ws.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				slog.Warn("stream: unexpected disconnect", "error", err)
			} else {
				slog.Info("stream: connection closed")
			}
			return
		}

		var envelope streaming.Envelope
		if err := json.Unmarshal(msg, &envelope); err != nil {
			slog.Warn("stream: invalid message", "error", err)
			continue
		}

		ss := current.Load()
		switch envelope.Type {
		case streaming.TypeStartMission:
			if ss != nil {
				fail("mission already active")
				return
			}
			started, reason := h.startStream(envelope, conn)
			if started == nil {
				fail(reason)
				return
			}
			attach(started)
			ack := streaming.AckMessage{Type: streaming.ServerAck, For: streaming.TypeStartMission}
			if started.resumable() {
				ack.Seq = started.lastSeq.Load()
				ack.ProtocolVersion = streaming.ProtocolVersionDiscard
			}
			writeJSON(ack)

		case streaming.TypeResume:
			if ss != nil {
				fail("mission already active")
				return
			}
			reply, resumed := h.resumeStream(envelope.Payload, conn)
			if resumed != nil {
				attach(resumed)
			}
			writeJSON(reply)

		case streaming.TypeEndMission:
			if ss == nil {
				slog.Info("stream: mission ended without an active session")
				writeJSON(streaming.AckMessage{Type: streaming.ServerAck, For: streaming.TypeEndMission})
				return
			}
			switch h.endStream(ss, conn, envelope) {
			case endTakenOver:
				return
			case endFailed:
				current.Store(nil)
				fail("mission could not be saved")
				return
			}
			current.Store(nil)
			ack := streaming.AckMessage{Type: streaming.ServerAck, For: streaming.TypeEndMission}
			if ss.resumable() {
				ack.Seq = ss.lastSeq.Load()
			}
			writeJSON(ack)
			return

		case streaming.TypeDiscardMission:
			if ss == nil {
				if !h.discardStreamed(envelope.Payload) {
					fail("mission could not be discarded")
					return
				}
				writeJSON(streaming.AckMessage{Type: streaming.ServerAck, For: streaming.TypeDiscardMission})
				return
			}
			switch h.discardStream(ss, conn, envelope) {
			case endTakenOver:
				return
			case endFailed:
				current.Store(nil)
				fail("mission could not be discarded")
				return
			}
			current.Store(nil)
			ack := streaming.AckMessage{Type: streaming.ServerAck, For: streaming.TypeDiscardMission}
			if ss.resumable() {
				ack.Seq = ss.lastSeq.Load()
			}
			writeJSON(ack)
			return

		default:
			// All other messages require an active session.
			if ss == nil {
				slog.Warn("stream: message received before start_mission, ignoring", "type", envelope.Type)
				continue
			}
			if !h.ingestStream(ss, conn, envelope) {
				return // another connection took the mission over
			}
			if ss.resumable() && ss.lastSeq.Load()-acked.Load() >= ackBatch {
				ackProgress()
			}
		}
	}
}

// startStream registers the recording announced by start_mission. It returns
// nil and a close reason when the mission cannot be accepted.
func (h *Handler) startStream(envelope streaming.Envelope, conn *streamConn) (*streamSession, string) {
	var payload streaming.StartMissionPayload
	if err := json.Unmarshal(envelope.Payload, &payload); err != nil || payload.Mission == nil || payload.World == nil || payload.Mission.MissionName == "" || payload.World.WorldName == "" || payload.Mission.CaptureDelay <= 0 {
		return nil, "invalid mission metadata"
	}
	// Additional protocol metadata is optional for historical clients. Keep
	// Mission and World in the shared extension types.
	var framing struct {
		FrameBase uint8 `json:"frameBase"`
	}
	if err := json.Unmarshal(envelope.Payload, &framing); err != nil || framing.FrameBase > 1 {
		return nil, "invalid frame base"
	}

	reg := h.streamRegistry()
	resumable := payload.MissionID != "" && payload.ProtocolVersion >= streaming.ProtocolVersionResume
	if resumable {
		// Reserve the mission id before the slow setup below, so a repeated
		// start racing this one takes over the same session instead of
		// creating a second recording.
		existing, err := reg.reserve(payload.MissionID, streamReserveWait)
		if err != nil {
			return nil, "mission start in progress"
		}
		if existing != nil {
			if existing.producer != payload.ProducerID {
				return nil, "mission id in use"
			}
			// The producer repeats a start whose acknowledgement it missed.
			if !h.takeOver(existing, conn) {
				return nil, "mission already saved"
			}
			slog.Info("stream: mission start repeated", "missionId", payload.MissionID)
			return existing, ""
		}
		// A producer records one mission at a time: a new start supersedes
		// whatever it left behind. Other producers are unaffected. Resends
		// from the spool are not the live mission: a recovered start
		// supersedes nothing, and is not superseded (see byProducer).
		if !payload.Recovered {
			for _, old := range reg.byProducer(payload.ProducerID, payload.MissionID) {
				go h.expireStream(old, 0)
			}
		}
	}
	// settle ends the reservation: ss nil when the mission was refused.
	settle := func(ss *streamSession) {
		if resumable {
			reg.settle(payload.MissionID, ss)
		}
	}

	if hook := streamTestHooks.beforeCreate; hook != nil {
		hook()
	}

	// Every session holds its mission in memory until it is saved. A producer
	// turned away keeps its data and retries.
	if !reg.acquire(h.setting.Streaming.MaxSessions) {
		settle(nil)
		slog.Warn("stream: refusing mission, too many active", "limit", h.setting.Streaming.MaxSessions, "mission", payload.Mission.MissionName)
		return nil, "too many active missions"
	}
	refuse := func(reason string) (*streamSession, string) {
		reg.release()
		settle(nil)
		return nil, reason
	}
	if h.setting.Data == "" || h.repoOperation == nil {
		return refuse("streaming storage unavailable")
	}
	if err := os.MkdirAll(h.setting.Data, 0755); err != nil {
		return refuse("streaming storage unavailable")
	}
	// Allocate one unique key for the row, v2 directory and legacy backup.
	output, err := os.MkdirTemp(h.setting.Data, ingestion.MakeFilename(payload.Mission.MissionName)+"_*")
	if err != nil {
		return refuse("streaming storage unavailable")
	}
	cf, err := ingestion.NewChunkFlusher(output, 300)
	if err != nil {
		return refuse("streaming storage unavailable")
	}
	op := Operation{WorldName: payload.World.WorldName, MissionName: payload.Mission.MissionName, Filename: filepath.Base(output), Date: time.Now().Format("2006-01-02"), Tag: payload.Mission.Tag, StorageFormat: "protobuf", ConversionStatus: ConversionStatusStreaming, SchemaVersion: uint32(storage.SchemaVersionV2)}
	if err := h.repoOperation.Store(context.Background(), &op); err != nil {
		return refuse("cannot register mission")
	}
	session := ingestion.NewSession()
	session.SetFrameBase(framing.FrameBase)
	session.SetMission(payload.Mission, payload.World)
	session.SetChunkFlusher(cf)

	ss := &streamSession{session: session, outputDir: output, opID: op.ID, counts: map[string]int{}, owner: conn}
	ss.lastSeq.Store(envelope.Seq)
	if resumable {
		ss.missionID = payload.MissionID
		ss.producer = payload.ProducerID
		ss.recovered = payload.Recovered
		if err := h.repoOperation.SetStreamMission(context.Background(), op.ID, ss.missionID); err != nil {
			slog.Warn("stream: cannot record mission id", "error", err)
		}
		settle(ss)
	}
	slog.Info("stream: mission started", "mission", payload.Mission.MissionName, "missionId", ss.missionID, "producerId", ss.producer, "resumable", resumable)
	return ss, ""
}

// takeOver makes conn the session's connection, closing any previous one and
// cancelling a pending grace expiry. It fails once the session is saved.
func (h *Handler) takeOver(ss *streamSession, conn *streamConn) bool {
	ss.mu.Lock()
	defer ss.mu.Unlock()
	if ss.done {
		return false
	}
	if ss.owner != nil && ss.owner != conn {
		ss.owner.kick() // a half-open predecessor must not feed the session any more
	}
	ss.owner = conn
	if ss.grace != nil {
		ss.grace.Stop()
		ss.grace = nil
	}
	return true
}

// resumeStream answers resume and returns the session conn now feeds, if any.
// Every reply carries the protocol version: a producer finishing a discard
// learns whether the server takes discard_mission without a session.
func (h *Handler) resumeStream(raw json.RawMessage, conn *streamConn) (streaming.AckMessage, *streamSession) {
	reply := func(msgType string, seq uint64) streaming.AckMessage {
		return streaming.AckMessage{Type: msgType, Seq: seq, ProtocolVersion: streaming.ProtocolVersionDiscard}
	}
	var p streaming.ResumePayload
	if err := json.Unmarshal(raw, &p); err != nil || p.MissionID == "" {
		return reply(streaming.ServerResumeUnknown, 0), nil
	}
	reg := h.streamRegistry()
	if ss := reg.get(p.MissionID); ss != nil && ss.producer == p.ProducerID && h.takeOver(ss, conn) {
		seq := ss.lastSeq.Load()
		slog.Info("stream: mission resumed", "missionId", p.MissionID, "seq", seq)
		return reply(streaming.ServerResumeOK, seq), ss
	}
	if reg.isCompleted(p.MissionID) || h.streamEnded(p.MissionID) {
		return reply(streaming.ServerResumeCompleted, 0), nil
	}
	slog.Warn("stream: resume of unknown mission", "missionId", p.MissionID)
	return reply(streaming.ServerResumeUnknown, 0), nil
}

// acceptSeq applies envelope numbering. It reports false for a duplicate the
// session already holds. Caller must hold ss.mu.
func acceptSeq(ss *streamSession, seq uint64) bool {
	if !checkSeq(ss, seq) {
		return false
	}
	if seq > 0 {
		ss.lastSeq.Store(seq)
	}
	return true
}

// checkSeq reports whether seq is new to the session and records a gap in
// front of it, without counting it as received. Caller must hold ss.mu.
func checkSeq(ss *streamSession, seq uint64) bool {
	if seq == 0 {
		return true // legacy producer: no numbering
	}
	last := ss.lastSeq.Load()
	if seq <= last {
		return false
	}
	if seq > last+1 && !ss.gap {
		slog.Warn("stream: envelopes missing, recording will be partial", "missionId", ss.missionID, "expected", last+1, "got", seq)
		ss.gap = true
	}
	return true
}

// ingestStream applies one mission envelope. It reports false when conn no
// longer feeds the session.
func (h *Handler) ingestStream(ss *streamSession, conn *streamConn, envelope streaming.Envelope) bool {
	ss.mu.Lock()
	defer ss.mu.Unlock()
	if ss.owner != conn || ss.done {
		return false
	}
	if !acceptSeq(ss, envelope.Seq) {
		return true // resent after a reconnect; already applied
	}
	ss.counts[envelope.Type]++
	if err := ss.session.HandleMessage(envelope); err != nil {
		slog.Warn("stream: invalid message", "type", envelope.Type, "error", err)
		return true
	}
	// The live duration and player count need no more than an occasional
	// write; telemetry from every game server would otherwise contend for
	// the SQLite writer.
	if envelope.Type == streaming.TypeTelemetry && ss.opID > 0 && time.Since(ss.metaWritten) >= streamMetaInterval {
		ss.metaWritten = time.Now()
		duration := float64(ss.session.FrameCount()) * float64(ss.session.Mission().CaptureDelay)
		if err := h.repoOperation.UpdateStreamingMeta(context.Background(), ss.opID, duration, ss.session.LivePlayerCount()); err != nil {
			slog.Warn("stream: metadata update failed", "error", err)
		}
	}
	return true
}

type endResult int

const (
	endSaved endResult = iota
	endFailed
	endTakenOver
)

// endStream saves the session for end_mission.
func (h *Handler) endStream(ss *streamSession, conn *streamConn, envelope streaming.Envelope) endResult {
	ss.mu.Lock()
	defer ss.mu.Unlock()
	if ss.owner != conn || ss.done {
		return endTakenOver
	}
	// end_mission is acknowledged only once its save succeeded: until then
	// its number stays out of the progress acknowledgements, so the producer
	// keeps it to resend if the save fails.
	checkSeq(ss, envelope.Seq)

	tag := ""
	interrupted := false
	if ss.session.Mission() != nil {
		tag = ss.session.Mission().Tag
	}
	// The extension may carry a save-time tag override in the envelope
	// payload. Prefer it over the mission-start tag when non-empty so
	// the operation row and the v2 manifest both reflect it.
	if len(envelope.Payload) > 0 && string(envelope.Payload) != "null" {
		var endPayload streaming.EndMissionPayload
		if err := json.Unmarshal(envelope.Payload, &endPayload); err != nil {
			slog.Warn("stream: invalid end_mission payload", "error", err)
		} else {
			if endPayload.Tag != "" {
				tag = endPayload.Tag
				if ss.session.Mission() != nil {
					ss.session.Mission().Tag = endPayload.Tag
				}
			}
			// A producer recovering a mission its game server crashed in ends
			// it on its behalf: the recording stops where the crash cut it.
			interrupted = endPayload.Interrupted
		}
	}
	if ss.gap || interrupted {
		tag = withPartialTag(tag)
	}
	slog.Info("stream: mission ended", "missionId", ss.missionID, "counts", ss.counts)

	ss.done = true
	err := h.saveStream(ss, tag)
	ctx := context.Background()
	if err == nil && ss.resumable() {
		// Marked before the session leaves the registry, so a discard of the
		// mission id never takes the saved recording for an unended one.
		if err := h.repoOperation.MarkStreamEnded(ctx, ss.opID); err != nil {
			// A discard of the mission id would now take it for unended.
			slog.Error("stream: cannot mark mission ended", "missionId", ss.missionID, "id", ss.opID, "error", err)
		}
	}
	if ss.resumable() {
		h.streamRegistry().remove(ss, err == nil)
	}
	if err != nil {
		return endFailed
	}
	if envelope.Seq > 0 {
		ss.lastSeq.Store(envelope.Seq)
	}
	if ss.resumable() && !ss.gap {
		h.replaceStreamSegments(ctx, ss)
	}
	return endSaved
}

// replaceStreamSegments removes the partial recordings an earlier attempt of
// the mission left behind, once a complete recording of it is saved. They
// exist when the producer resent the mission in full, for example after a web
// server restart lost the session.
func (h *Handler) replaceStreamSegments(ctx context.Context, ss *streamSession) {
	segments, err := h.repoOperation.StreamSegments(ctx, ss.missionID, ss.opID)
	if err != nil {
		slog.Warn("stream: cannot list earlier segments", "missionId", ss.missionID, "error", err)
		return
	}
	for _, seg := range segments {
		if err := h.removeStreamOperation(ctx, seg.ID, seg.Filename); err != nil {
			slog.Warn("stream: cannot remove earlier segment", "id", seg.ID, "error", err)
			continue
		}
		slog.Info("stream: replaced partial segment with complete recording", "missionId", ss.missionID, "removed", seg.Filename, "kept", filepath.Base(ss.outputDir))
	}
}

// discardStream drops the session for discard_mission: the producer decided
// the recording does not meet its save limits, for example the minimum
// mission duration. The streaming row and its files go, along with any
// partial segments an earlier attempt of the mission left behind. A failure
// leaves the discard unacknowledged, so the producer repeats it.
func (h *Handler) discardStream(ss *streamSession, conn *streamConn, envelope streaming.Envelope) endResult {
	ss.mu.Lock()
	defer ss.mu.Unlock()
	if ss.owner != conn || ss.done {
		return endTakenOver
	}
	// Like end_mission, discard_mission is acknowledged only once the
	// recording is gone.
	checkSeq(ss, envelope.Seq)
	ss.done = true
	if h.dropSession(ss) != nil {
		return endFailed
	}
	if envelope.Seq > 0 {
		ss.lastSeq.Store(envelope.Seq)
	}
	return endSaved
}

// dropSession removes a discarded session's recording and earlier unended
// segments of its mission, and releases the session. On failure the row is
// marked failed, no longer live; the producer's repeated discard, without a
// session, removes it. Caller holds ss.mu and has set ss.done.
func (h *Handler) dropSession(ss *streamSession) error {
	slog.Info("stream: mission discarded", "missionId", ss.missionID, "mission", ss.session.Mission().MissionName, "counts", ss.counts)
	ctx := context.Background()
	// The session's own row goes last: after a failure it is still there to
	// be marked failed.
	var err error
	if ss.resumable() {
		err = h.removeUnendedSegments(ctx, ss.missionID, ss.opID)
	}
	if err == nil {
		err = h.removeStreamOperation(ctx, ss.opID, filepath.Base(ss.outputDir))
	}
	if ss.resumable() {
		// Remembered as finished, so a producer whose acknowledgement was
		// lost learns from resume that the discard went through.
		h.streamRegistry().remove(ss, err == nil)
	}
	h.streamRegistry().release()
	if err != nil {
		slog.Error("stream: cannot remove discarded mission", "missionId", ss.missionID, "id", ss.opID, "error", err)
		if ss.opID > 0 {
			h.repoOperation.UpdateConversionStatus(ctx, ss.opID, ConversionStatusFailed)
		}
	}
	return err
}

// discardStreamed handles discard_mission without a session: the producer
// finishes a discard the server did not confirm after the session ended, for
// example when its producer stayed away past the resume grace and the
// mission was saved as partial. What the server kept of the mission goes;
// recordings saved through end_mission stay. It reports false when they
// could not be removed, or a connection still feeds the mission.
func (h *Handler) discardStreamed(raw json.RawMessage) bool {
	var p streaming.DiscardMissionPayload
	if len(raw) == 0 || json.Unmarshal(raw, &p) != nil || p.MissionID == "" {
		slog.Info("stream: mission discarded without an active session")
		return true
	}
	reg := h.streamRegistry()
	// Reserving the mission id holds off a start of it while its recordings
	// go. A session of the mission is dropped in its place, unless a
	// connection still feeds it.
	for range 3 {
		existing, err := reg.reserve(p.MissionID, streamReserveWait)
		if err != nil {
			slog.Warn("stream: cannot discard mission, start in progress", "missionId", p.MissionID)
			return false
		}
		if existing == nil {
			err := h.removeUnendedSegments(context.Background(), p.MissionID, 0)
			reg.settle(p.MissionID, nil)
			if err != nil {
				slog.Error("stream: cannot remove discarded mission", "missionId", p.MissionID, "error", err)
				return false
			}
			slog.Info("stream: mission discarded after its session ended", "missionId", p.MissionID)
			return true
		}
		if hook := streamTestHooks.beforeDiscardSession; hook != nil {
			hook()
		}
		if dropped, retry := h.discardDetached(existing, p.ProducerID); !retry {
			return dropped
		}
	}
	slog.Warn("stream: cannot discard mission, its session is still being finalized", "missionId", p.MissionID)
	return false
}

// discardDetached drops a session waiting for its producer to resume, for a
// session-less discard_mission. It refuses one a connection feeds or another
// producer recorded, and asks for a retry when the session was finalized
// meanwhile: it then leaves the registry.
func (h *Handler) discardDetached(ss *streamSession, producer string) (dropped, retry bool) {
	ss.mu.Lock()
	defer ss.mu.Unlock()
	if ss.done {
		return false, true
	}
	if ss.owner != nil {
		slog.Warn("stream: cannot discard mission, a connection feeds it", "missionId", ss.missionID)
		return false, false
	}
	if ss.producer != producer {
		slog.Warn("stream: cannot discard mission of another producer", "missionId", ss.missionID)
		return false, false
	}
	if ss.grace != nil {
		ss.grace.Stop()
		ss.grace = nil
	}
	ss.done = true
	return h.dropSession(ss) == nil, false
}

// removeUnendedSegments removes the recordings of the producer mission not
// saved through end_mission, except the one with id exceptID. It returns the
// first error and removes what it can.
func (h *Handler) removeUnendedSegments(ctx context.Context, missionID string, exceptID int64) error {
	if h.repoOperation == nil {
		return nil
	}
	segments, err := h.repoOperation.UnendedStreamSegments(ctx, missionID, exceptID)
	if err != nil {
		return fmt.Errorf("list segments: %w", err)
	}
	var first error
	for _, seg := range segments {
		if err := h.removeStreamOperation(ctx, seg.ID, seg.Filename); err != nil {
			slog.Warn("stream: cannot remove segment", "id", seg.ID, "error", err)
			if first == nil {
				first = err
			}
			continue
		}
		slog.Info("stream: removed segment of discarded mission", "missionId", missionID, "removed", seg.Filename)
	}
	return first
}

// removeStreamOperation deletes a streamed operation row and its files. The
// files go on a best-effort basis, as for a deleted operation.
func (h *Handler) removeStreamOperation(ctx context.Context, id int64, filename string) error {
	if hook := streamTestHooks.beforeRemove; hook != nil {
		if err := hook(); err != nil {
			return err
		}
	}
	if id > 0 {
		if err := h.repoOperation.Delete(ctx, id); err != nil && !errors.Is(err, ErrNotFound) {
			return err
		}
	}
	removeRecordingArtifacts(h.setting.Data, filename)
	return nil
}

// streamEnded reports whether the database holds a saved recording of the
// producer mission, which outlives the in-memory registry across restarts.
func (h *Handler) streamEnded(missionID string) bool {
	if h.repoOperation == nil {
		return false
	}
	ended, err := h.repoOperation.StreamEnded(context.Background(), missionID)
	if err != nil {
		slog.Warn("stream: cannot look up mission", "missionId", missionID, "error", err)
	}
	return ended
}

// detachStream records that conn stopped feeding the session. A legacy
// session is saved as partial at once; a resumable one waits for its
// producer to reconnect.
func (h *Handler) detachStream(ss *streamSession, conn *streamConn) {
	ss.mu.Lock()
	defer ss.mu.Unlock()
	if ss.owner != conn || ss.done {
		return
	}
	ss.owner = nil
	if !ss.resumable() {
		slog.Warn("stream: producer disconnected, finalizing partial data", "counts", ss.counts)
		ss.done = true
		_ = h.saveStream(ss, "partial")
		return
	}
	grace := h.setting.Streaming.ResumeGrace
	if grace <= 0 {
		grace = 5 * time.Minute
	}
	ss.detachGen++
	gen := ss.detachGen
	slog.Warn("stream: producer disconnected, waiting for resume", "missionId", ss.missionID, "seq", ss.lastSeq.Load(), "grace", grace)
	ss.grace = time.AfterFunc(grace, func() { h.expireStream(ss, gen) })
}

// expireStream saves an abandoned resumable session as partial. gen is the
// detachment the grace timer belongs to; zero forces the save, for a session
// its producer superseded with a new mission.
func (h *Handler) expireStream(ss *streamSession, gen uint64) {
	ss.mu.Lock()
	defer ss.mu.Unlock()
	if ss.done {
		return
	}
	if gen != 0 && (ss.owner != nil || gen != ss.detachGen) {
		return // resumed, or detached again with a newer timer
	}
	if ss.owner != nil {
		ss.owner.kick()
		ss.owner = nil
	}
	if ss.grace != nil {
		ss.grace.Stop()
		ss.grace = nil
	}
	reason := "resume grace expired"
	if gen == 0 {
		reason = "superseded by a new mission"
	}
	ss.done = true
	if ss.lastSeq.Load() <= 1 {
		// Nothing was recorded after the start, for example a start the
		// producer gave up waiting for: an empty recording is not kept.
		slog.Info("stream: dropping abandoned mission that recorded nothing", "missionId", ss.missionID, "reason", reason)
		ctx := context.Background()
		if err := h.removeStreamOperation(ctx, ss.opID, filepath.Base(ss.outputDir)); err != nil {
			slog.Error("stream: cannot remove empty mission", "missionId", ss.missionID, "id", ss.opID, "error", err)
			if ss.opID > 0 {
				h.repoOperation.UpdateConversionStatus(ctx, ss.opID, ConversionStatusFailed)
			}
		}
		h.streamRegistry().remove(ss, false)
		h.streamRegistry().release()
		return
	}
	slog.Warn("stream: saving abandoned mission as partial", "missionId", ss.missionID, "reason", reason)
	_ = h.saveStream(ss, "partial")
	h.streamRegistry().remove(ss, false)
}

// saveStream finalizes the session, marking the row failed on error. Caller
// must hold ss.mu.
func (h *Handler) saveStream(ss *streamSession, tag string) error {
	defer h.streamRegistry().release() // every session is saved exactly once
	if hook := streamTestHooks.beforeSave; hook != nil {
		hook()
	}
	err := h.finalizeSession(ss.session, tag, ss.outputDir, ss.opID)
	if err != nil {
		slog.Error("stream: finalization failed", "error", err)
		if ss.opID > 0 {
			h.repoOperation.UpdateConversionStatus(context.Background(), ss.opID, ConversionStatusFailed)
		}
	}
	return err
}

// withPartialTag marks a tag list partial once.
func withPartialTag(tag string) string {
	for _, t := range strings.Split(tag, ",") {
		if strings.TrimSpace(t) == "partial" {
			return tag
		}
	}
	if tag == "" {
		return "partial"
	}
	return tag + ",partial"
}

// finalizeSession writes v2 protobuf + v1 JSON, stores an Operation, and triggers conversion.
// If streamingOpID > 0, updates the existing "streaming" row instead of inserting a new one.
func (h *Handler) finalizeSession(session *ingestion.Session, tag string, v2OutputDir string, streamingOpID int64) error {
	if h.setting.Data == "" {
		return nil
	}

	if tag == "partial" && session.Mission() != nil && session.Mission().Tag != "" {
		tag = session.Mission().Tag + ",partial"
	}

	worldName := ""
	missionName := ""
	if session.World() != nil {
		worldName = session.World().WorldName
	}
	if session.Mission() != nil {
		missionName = session.Mission().MissionName
	}

	// Compute duration from frame count and capture delay.
	captureDelay := float32(1.0)
	if session.Mission() != nil && session.Mission().CaptureDelay > 0 {
		captureDelay = session.Mission().CaptureDelay
	}
	duration := float64(session.FrameCount()) * float64(captureDelay)

	filename := filepath.Base(v2OutputDir)
	if v2OutputDir == "" {
		filename = ingestion.MakeFilename(missionName)
	}
	if err := session.WriteJSONGzNamed(h.setting.Data, filename); err != nil {
		return fmt.Errorf("write JSON.gz: %w", err)
	}

	// Write v2 protobuf (manifest + finalize chunks).
	var chunkCount int
	hasV2 := session.ChunkFlusher() != nil && v2OutputDir != ""
	if hasV2 {
		if err := session.Finalize(v2OutputDir); err != nil {
			slog.Error("stream: v2 finalization failed, falling back to v1 only", "error", err)
			hasV2 = false
		} else {
			chunkCount = int(session.ChunkFlusher().ChunkCount())
		}
	}

	storageFormat := "json"
	schemaVersion := uint32(storage.SchemaVersionV1)
	conversionStatus := ConversionStatusPending

	if hasV2 {
		filename = filepath.Base(v2OutputDir)
		storageFormat = "protobuf"
		schemaVersion = uint32(storage.SchemaVersionV2)
		conversionStatus = ConversionStatusCompleted // v2 is already in final format
	}

	op := Operation{
		WorldName:        worldName,
		MissionName:      missionName,
		MissionDuration:  duration,
		Filename:         filename,
		Date:             time.Now().Format("2006-01-02"),
		Tag:              tag,
		StorageFormat:    storageFormat,
		ConversionStatus: conversionStatus,
		SchemaVersion:    schemaVersion,
		ChunkCount:       chunkCount,
	}
	if ranges := session.FocusRanges(); len(ranges) > 0 {
		start, end := int64(ranges[0].Start), int64(ranges[0].End)
		op.FocusStart = &start
		op.FocusEnd = &end
	}
	ctx := context.TODO()

	if streamingOpID > 0 {
		// Update the existing "streaming" row created at start_mission.
		op.ID = streamingOpID
		if err := h.repoOperation.Update(ctx, &op); err != nil {
			return fmt.Errorf("update operation: %w", err)
		}
	} else {
		if err := h.repoOperation.Store(ctx, &op); err != nil {
			return fmt.Errorf("store operation: %w", err)
		}
	}

	// Finalize owns stats: backfill skips rows where player_count != 0, and
	// UpdateStreamingMeta has already set it from telemetry.
	stats := session.Stats()
	sideComp := make(SideComposition, len(stats.Sides))
	for side, sc := range stats.Sides {
		sideComp[side] = SideCounts{Players: sc.Players, Units: sc.Units, Dead: sc.Dead, Kills: sc.Kills}
	}
	if err := h.repoOperation.UpdateOperationStats(ctx, op.ID,
		stats.PlayerCount, stats.KillCount, stats.PlayerKillCount, sideComp); err != nil {
		slog.Warn("stream: failed to update operation stats", "error", err)
	}

	slog.Info("stream: finalized",
		"id", op.ID,
		"filename", filename,
		"format", storageFormat,
		"schemaVersion", schemaVersion,
		"frames", session.FrameCount(),
		"chunks", chunkCount,
		"duration", duration,
		"tag", tag)

	// Only trigger conversion for v1 JSON (v2 is already complete).
	if !hasV2 {
		if h.conversionTrigger != nil {
			h.conversionTrigger.TriggerConversion(op.ID, op.Filename)
		} else {
			if err := h.repoOperation.UpdateConversionStatus(ctx, op.ID, ConversionStatusCompleted); err != nil {
				slog.Error("stream: failed to mark completed", "error", err)
			}
		}
	}

	return nil
}
