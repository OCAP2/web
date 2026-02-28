package server

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestJWT_CreateAndValidate(t *testing.T) {
	mgr := NewJWTManager("test-secret", time.Hour)

	token, err := mgr.Create("")
	require.NoError(t, err)
	require.NotEmpty(t, token)

	assert.NoError(t, mgr.Validate(token))
}

func TestJWT_Expired(t *testing.T) {
	mgr := NewJWTManager("test-secret", time.Millisecond)

	token, err := mgr.Create("")
	require.NoError(t, err)

	time.Sleep(5 * time.Millisecond)
	assert.Error(t, mgr.Validate(token))
}

func TestJWT_Tampered(t *testing.T) {
	mgr := NewJWTManager("test-secret", time.Hour)

	token, err := mgr.Create("")
	require.NoError(t, err)

	// Replace several characters to ensure actual signature bytes change
	// (flipping only the last char can land on base64 padding bits)
	tampered := token[:len(token)-4] + "XXXX"
	assert.Error(t, mgr.Validate(tampered))
}

func TestJWT_WrongSecret(t *testing.T) {
	mgr1 := NewJWTManager("secret-1", time.Hour)
	mgr2 := NewJWTManager("secret-2", time.Hour)

	token, err := mgr1.Create("")
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

func TestJWT_Subject(t *testing.T) {
	mgr := NewJWTManager("test-secret", time.Hour)

	token, err := mgr.Create("steam123")
	require.NoError(t, err)
	assert.Equal(t, "steam123", mgr.Subject(token))
}

func TestJWT_SubjectEmpty(t *testing.T) {
	mgr := NewJWTManager("test-secret", time.Hour)

	token, err := mgr.Create("")
	require.NoError(t, err)
	assert.Equal(t, "", mgr.Subject(token))
}

func TestJWT_SubjectInvalidToken(t *testing.T) {
	mgr := NewJWTManager("test-secret", time.Hour)
	assert.Equal(t, "", mgr.Subject("garbage"))
}

func TestJWT_WithSteamProfile(t *testing.T) {
	mgr := NewJWTManager("test-secret", time.Hour)

	token, err := mgr.Create("76561198012345678", WithSteamProfile("PlayerOne", "https://avatars.steamstatic.com/abc.jpg"))
	require.NoError(t, err)

	claims := mgr.Claims(token)
	require.NotNil(t, claims)
	assert.Equal(t, "76561198012345678", claims.Subject)
	assert.Equal(t, "PlayerOne", claims.SteamName)
	assert.Equal(t, "https://avatars.steamstatic.com/abc.jpg", claims.SteamAvatar)
}

func TestJWT_ClaimsWithoutProfile(t *testing.T) {
	mgr := NewJWTManager("test-secret", time.Hour)

	token, err := mgr.Create("76561198012345678")
	require.NoError(t, err)

	claims := mgr.Claims(token)
	require.NotNil(t, claims)
	assert.Equal(t, "76561198012345678", claims.Subject)
	assert.Empty(t, claims.SteamName)
	assert.Empty(t, claims.SteamAvatar)
}

func TestJWT_ClaimsInvalidToken(t *testing.T) {
	mgr := NewJWTManager("test-secret", time.Hour)
	assert.Nil(t, mgr.Claims("garbage"))
}

func TestJWT_ClaimsExpiredToken(t *testing.T) {
	mgr := NewJWTManager("test-secret", time.Millisecond)

	token, err := mgr.Create("steam123", WithSteamProfile("Name", "url"))
	require.NoError(t, err)

	time.Sleep(5 * time.Millisecond)
	assert.Nil(t, mgr.Claims(token))
}

func TestJWT_ClaimsWrongSecret(t *testing.T) {
	mgr1 := NewJWTManager("secret-1", time.Hour)
	mgr2 := NewJWTManager("secret-2", time.Hour)

	token, err := mgr1.Create("steam123")
	require.NoError(t, err)

	assert.Nil(t, mgr2.Claims(token))
}

func TestJWT_ValidateWrongSigningMethod(t *testing.T) {
	mgr := NewJWTManager("test-secret", time.Hour)

	// Create a token signed with "none" method instead of HMAC
	token := jwt.NewWithClaims(jwt.SigningMethodNone, jwt.MapClaims{
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	tokenStr, err := token.SignedString(jwt.UnsafeAllowNoneSignatureType)
	require.NoError(t, err)

	err = mgr.Validate(tokenStr)
	assert.Error(t, err) // Should reject non-HMAC signing method
}

func TestJWT_ClaimsWrongSigningMethod(t *testing.T) {
	mgr := NewJWTManager("test-secret", time.Hour)

	// Create a token signed with "none" method instead of HMAC
	token := jwt.NewWithClaims(jwt.SigningMethodNone, jwt.MapClaims{
		"exp": time.Now().Add(time.Hour).Unix(),
		"sub": "user123",
	})
	tokenStr, err := token.SignedString(jwt.UnsafeAllowNoneSignatureType)
	require.NoError(t, err)

	claims := mgr.Claims(tokenStr)
	assert.Nil(t, claims) // parseClaims should reject non-HMAC signing method
}
