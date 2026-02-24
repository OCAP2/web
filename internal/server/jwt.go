package server

import (
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// JWTManager creates and validates stateless JWT tokens using HMAC-SHA256.
type JWTManager struct {
	secret []byte
	ttl    time.Duration
}

// SteamClaims extends standard JWT claims with Steam profile data.
type SteamClaims struct {
	jwt.RegisteredClaims
	SteamName   string `json:"steam_name,omitempty"`
	SteamAvatar string `json:"steam_avatar,omitempty"`
}

func NewJWTManager(secret string, ttl time.Duration) *JWTManager {
	return &JWTManager{
		secret: []byte(secret),
		ttl:    ttl,
	}
}

// Create signs a new token with an expiry claim, optional subject, and optional Steam profile data.
func (m *JWTManager) Create(subject string, opts ...ClaimOption) (string, error) {
	claims := SteamClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(m.ttl)),
		},
	}
	if subject != "" {
		claims.Subject = subject
	}
	for _, opt := range opts {
		opt(&claims)
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(m.secret)
}

// ClaimOption configures additional JWT claims.
type ClaimOption func(*SteamClaims)

// WithSteamProfile sets the Steam display name and avatar URL in the token.
func WithSteamProfile(name, avatar string) ClaimOption {
	return func(c *SteamClaims) {
		c.SteamName = name
		c.SteamAvatar = avatar
	}
}

// Validate parses the token and checks signature and expiry.
func (m *JWTManager) Validate(tokenString string) error {
	_, err := jwt.Parse(tokenString, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return m.secret, nil
	})
	return err
}

// Subject parses the token and returns the sub claim.
func (m *JWTManager) Subject(tokenString string) string {
	claims := m.parseClaims(tokenString)
	if claims == nil {
		return ""
	}
	return claims.Subject
}

// Claims parses the token and returns all custom Steam claims.
func (m *JWTManager) Claims(tokenString string) *SteamClaims {
	return m.parseClaims(tokenString)
}

func (m *JWTManager) parseClaims(tokenString string) *SteamClaims {
	claims := &SteamClaims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return m.secret, nil
	})
	if err != nil || !token.Valid {
		return nil
	}
	return claims
}
