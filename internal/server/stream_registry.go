package server

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"time"

	"github.com/OCAP2/web/internal/ingestion"
	"github.com/gorilla/websocket"
)

// completedTTL is how long a saved mission id is remembered, so a producer
// whose end_mission acknowledgement was lost learns the mission was saved.
const completedTTL = time.Hour

// streamMetaInterval spaces live metadata writes per session; tests lower it.
var streamMetaInterval = 15 * time.Second

// streamReserveWait bounds how long a start waits for a concurrent start of
// the same mission to finish setting it up.
const streamReserveWait = 30 * time.Second

// streamTestHooks let tests hold a session at points where races matter.
// They are nil outside tests.
var streamTestHooks struct {
	beforeCreate func() // a start reserved its mission and is about to set it up
	beforeSave   func() // a session is about to be finalized
}

// streamConn is one producer WebSocket connection.
type streamConn struct {
	ws      *websocket.Conn
	writeMu *sync.Mutex // serializes writes with the ping goroutine
}

// kick closes the connection so its read loop exits. Used when another
// connection takes over its mission.
func (c *streamConn) kick() { _ = c.ws.Close() }

// streamSession is one recording being ingested.
//
// A resumable session (one with a mission id) outlives its WebSocket
// connection: when the producer reconnects and sends resume, the new
// connection takes it over, and only a session left detached for the grace
// period is saved as partial. A legacy session belongs to its connection.
//
// mu serializes everything that touches the ingestion session: message
// handling, takeover, finalization.
type streamSession struct {
	mu        sync.Mutex
	missionID string // empty for legacy sessions
	producer  string
	session   *ingestion.Session
	outputDir string
	opID      int64
	counts    map[string]int
	lastSeq   atomic.Uint64 // highest envelope received; written under mu
	gap       bool          // an envelope number was skipped
	owner     *streamConn   // nil while detached
	grace     *time.Timer
	detachGen uint64 // identifies the detachment the grace timer belongs to
	// metaWritten is when the live metadata row was last updated.
	metaWritten time.Time
	done        bool // finalized, or being finalized
}

func (s *streamSession) resumable() bool { return s.missionID != "" }

// streamRegistry indexes resumable sessions by mission id. Sessions of
// different producers never interact: a mission id is a random UUID chosen
// by the producer for each recording.
type streamRegistry struct {
	mu        sync.Mutex
	sessions  map[string]*streamSession
	pending   map[string]chan struct{} // mission ids whose session is being created
	completed map[string]time.Time     // mission ids saved through end_mission
	active    int                      // sessions being ingested, legacy ones included
}

// errReserveTimeout means a concurrent start of the same mission did not
// finish in time.
var errReserveTimeout = errors.New("mission start in progress")

// reserve returns the session registered for missionID, or, when there is
// none, reserves the id for the caller (nil session) until settle. A start
// racing another start of the same mission waits for it to finish and then
// gets its session.
func (r *streamRegistry) reserve(missionID string, wait time.Duration) (*streamSession, error) {
	deadline := time.Now().Add(wait)
	for {
		r.mu.Lock()
		if s := r.sessions[missionID]; s != nil {
			r.mu.Unlock()
			return s, nil
		}
		ch := r.pending[missionID]
		if ch == nil {
			r.pending[missionID] = make(chan struct{})
			r.mu.Unlock()
			return nil, nil
		}
		r.mu.Unlock()
		select {
		case <-ch:
		case <-time.After(time.Until(deadline)):
			return nil, errReserveTimeout
		}
	}
}

// settle ends a reservation: s is registered, or nil when the start failed,
// and waiting starts proceed.
func (r *streamRegistry) settle(missionID string, s *streamSession) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if s != nil {
		r.sessions[missionID] = s
	}
	if ch := r.pending[missionID]; ch != nil {
		close(ch)
		delete(r.pending, missionID)
	}
}

// acquire reserves a slot for a new session; limit <= 0 means no limit.
func (r *streamRegistry) acquire(limit int) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if limit > 0 && r.active >= limit {
		return false
	}
	r.active++
	return true
}

// release frees the slot of a session that was saved or abandoned.
func (r *streamRegistry) release() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.active > 0 {
		r.active--
	}
}

func (r *streamRegistry) activeCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.active
}

func newStreamRegistry() *streamRegistry {
	return &streamRegistry{sessions: map[string]*streamSession{}, pending: map[string]chan struct{}{}, completed: map[string]time.Time{}}
}

func (r *streamRegistry) get(missionID string) *streamSession {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.sessions[missionID]
}

// remove unregisters a session; saved marks it completed for resume.
func (r *streamRegistry) remove(s *streamSession, saved bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.sessions[s.missionID] == s {
		delete(r.sessions, s.missionID)
	}
	if saved {
		now := time.Now()
		for id, at := range r.completed {
			if now.Sub(at) > completedTTL {
				delete(r.completed, id)
			}
		}
		r.completed[s.missionID] = now
	}
}

func (r *streamRegistry) isCompleted(missionID string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	at, ok := r.completed[missionID]
	return ok && time.Since(at) <= completedTTL
}

// byProducer returns the producer's active sessions except keep.
func (r *streamRegistry) byProducer(producer string, keep string) []*streamSession {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []*streamSession
	for id, s := range r.sessions {
		if id != keep && s.producer == producer {
			out = append(out, s)
		}
	}
	return out
}

func (r *streamRegistry) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.sessions)
}

// FailInterruptedStreams marks recordings that were still streaming when the
// server stopped as failed. Their sessions lived in memory and are gone, so
// they would otherwise show as live forever. A producer that comes back
// resends the mission in full, and the complete recording replaces them.
// Call it once at startup, before the stream endpoint accepts connections.
func FailInterruptedStreams(ctx context.Context, repo *RepoOperation) (int64, error) {
	return repo.ResetConversionStatus(ctx, ConversionStatusStreaming, ConversionStatusFailed)
}

// streamRegistry returns the handler's registry, creating it on first use.
func (h *Handler) streamRegistry() *streamRegistry {
	h.streamsOnce.Do(func() { h.streams = newStreamRegistry() })
	return h.streams
}
