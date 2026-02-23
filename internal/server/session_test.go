package server

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSessionStore_CreateAndValidate(t *testing.T) {
	store := NewSessionStore(time.Hour)

	token := store.Create()
	require.NotEmpty(t, token)

	assert.True(t, store.Valid(token))
	assert.False(t, store.Valid("bogus-token"))
}

func TestSessionStore_Destroy(t *testing.T) {
	store := NewSessionStore(time.Hour)

	token := store.Create()
	assert.True(t, store.Valid(token))

	store.Destroy(token)
	assert.False(t, store.Valid(token))
}

func TestSessionStore_Expiry(t *testing.T) {
	store := NewSessionStore(time.Millisecond)

	token := store.Create()
	assert.True(t, store.Valid(token))

	time.Sleep(5 * time.Millisecond)
	assert.False(t, store.Valid(token))
}
