package server

import (
	"crypto/rand"
	"encoding/hex"
	"sync"
	"time"
)

type session struct {
	expiresAt time.Time
}

// SessionStore manages in-memory admin sessions.
type SessionStore struct {
	mu       sync.Mutex
	sessions map[string]session
	ttl      time.Duration
}

func NewSessionStore(ttl time.Duration) *SessionStore {
	return &SessionStore{
		sessions: make(map[string]session),
		ttl:      ttl,
	}
}

// Create generates a new session token.
func (s *SessionStore) Create() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic("crypto/rand failed: " + err.Error())
	}
	token := hex.EncodeToString(b)

	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessions[token] = session{expiresAt: time.Now().Add(s.ttl)}
	return token
}

// Valid checks whether a token exists and is not expired.
func (s *SessionStore) Valid(token string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, ok := s.sessions[token]
	if !ok {
		return false
	}
	if time.Now().After(sess.expiresAt) {
		delete(s.sessions, token)
		return false
	}
	return true
}

// Destroy removes a session.
func (s *SessionStore) Destroy(token string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.sessions, token)
}
