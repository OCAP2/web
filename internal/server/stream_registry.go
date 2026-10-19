package server

import (
	"sync"
	"sync/atomic"
	"time"

	"github.com/OCAP2/web/internal/ingestion"
	"github.com/gorilla/websocket"
)

// completedTTL is how long a saved mission id is remembered, so a producer
// whose end_mission acknowledgement was lost learns the mission was saved.
const completedTTL = time.Hour

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
	done      bool   // finalized, or being finalized
}

func (s *streamSession) resumable() bool { return s.missionID != "" }

// streamRegistry indexes resumable sessions by mission id. Sessions of
// different producers never interact: a mission id is a random UUID chosen
// by the producer for each recording.
type streamRegistry struct {
	mu        sync.Mutex
	sessions  map[string]*streamSession
	completed map[string]time.Time // mission ids saved through end_mission
}

func newStreamRegistry() *streamRegistry {
	return &streamRegistry{sessions: map[string]*streamSession{}, completed: map[string]time.Time{}}
}

func (r *streamRegistry) get(missionID string) *streamSession {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.sessions[missionID]
}

func (r *streamRegistry) add(s *streamSession) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sessions[s.missionID] = s
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

// streamRegistry returns the handler's registry, creating it on first use.
func (h *Handler) streamRegistry() *streamRegistry {
	h.streamsOnce.Do(func() { h.streams = newStreamRegistry() })
	return h.streams
}
