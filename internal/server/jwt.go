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

func NewJWTManager(secret string, ttl time.Duration) *JWTManager {
	return &JWTManager{
		secret: []byte(secret),
		ttl:    ttl,
	}
}

// Create signs a new token with an expiry claim and optional subject.
func (m *JWTManager) Create(subject string) (string, error) {
	claims := jwt.RegisteredClaims{
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(m.ttl)),
	}
	if subject != "" {
		claims.Subject = subject
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(m.secret)
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
	token, err := jwt.Parse(tokenString, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return m.secret, nil
	})
	if err != nil {
		return ""
	}
	sub, _ := token.Claims.GetSubject()
	return sub
}
