package server

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestJWT_CreateAndValidate(t *testing.T) {
	mgr := NewJWTManager("test-secret", time.Hour)

	token, err := mgr.Create()
	require.NoError(t, err)
	require.NotEmpty(t, token)

	assert.NoError(t, mgr.Validate(token))
}

func TestJWT_Expired(t *testing.T) {
	mgr := NewJWTManager("test-secret", time.Millisecond)

	token, err := mgr.Create()
	require.NoError(t, err)

	time.Sleep(5 * time.Millisecond)
	assert.Error(t, mgr.Validate(token))
}

func TestJWT_Tampered(t *testing.T) {
	mgr := NewJWTManager("test-secret", time.Hour)

	token, err := mgr.Create()
	require.NoError(t, err)

	// Flip a character in the signature portion
	tampered := token[:len(token)-1] + "X"
	assert.Error(t, mgr.Validate(tampered))
}

func TestJWT_WrongSecret(t *testing.T) {
	mgr1 := NewJWTManager("secret-1", time.Hour)
	mgr2 := NewJWTManager("secret-2", time.Hour)

	token, err := mgr1.Create()
	require.NoError(t, err)

	assert.Error(t, mgr2.Validate(token))
}

func TestJWT_EmptyToken(t *testing.T) {
	mgr := NewJWTManager("test-secret", time.Hour)
	assert.Error(t, mgr.Validate(""))
}

func TestJWT_MalformedToken(t *testing.T) {
	mgr := NewJWTManager("test-secret", time.Hour)
	assert.Error(t, mgr.Validate("not.a.jwt"))
}
