package server

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/OCAP2/web/internal/storage"
)

func TestAcceptedEncodings(t *testing.T) {
	tests := []struct {
		name   string
		header string
		want   map[string]float64
	}{
		{"empty", "", nil},
		{"single", "gzip", map[string]float64{"gzip": 1}},
		{"list", "gzip, zstd", map[string]float64{"gzip": 1, "zstd": 1}},
		{"qvalues", "gzip;q=0.5, zstd;q=1.0", map[string]float64{"gzip": 0.5, "zstd": 1}},
		{"refusal", "gzip;q=0, zstd", map[string]float64{"gzip": 0, "zstd": 1}},
		{"wildcard", "*", map[string]float64{"*": 1}},
		{"messy spacing", "  gzip ;  q=0.8 ,zstd ", map[string]float64{"gzip": 0.8, "zstd": 1}},
		{"case folded", "GZIP, Zstd", map[string]float64{"gzip": 1, "zstd": 1}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, acceptedEncodings(tt.header))
		})
	}
}

func TestAcceptsEncoding(t *testing.T) {
	assert.True(t, acceptsEncoding(acceptedEncodings("zstd"), "zstd"))
	assert.False(t, acceptsEncoding(acceptedEncodings("zstd"), "gzip"))
	assert.True(t, acceptsEncoding(acceptedEncodings("*"), "gzip"), "wildcard allows any coding")
	assert.False(t, acceptsEncoding(acceptedEncodings("gzip;q=0"), "gzip"), "q=0 is a refusal")
	assert.False(t, acceptsEncoding(acceptedEncodings("*;q=0"), "gzip"))
}

func TestDataContentType(t *testing.T) {
	assert.Equal(t, "application/x-protobuf", dataContentType("chunks/0000.pb"))
	assert.Equal(t, "application/x-protobuf", dataContentType("MANIFEST.PB"))
	assert.Equal(t, "", dataContentType("recording.json"))
}

// writeArtifactWithSidecars lays out a file the way the converter does.
func writeArtifactWithSidecars(t *testing.T, dir, name string, payload []byte) string {
	t.Helper()
	path := filepath.Join(dir, name)
	require.NoError(t, storage.WriteArtifact(path, payload))
	return path
}

func protoPayload() []byte {
	return bytes.Repeat([]byte("entity frame state "), 4096)
}

func TestServePrecompressed_PrefersZstd(t *testing.T) {
	dir := t.TempDir()
	path := writeArtifactWithSidecars(t, dir, "manifest.pb", protoPayload())

	req := httptest.NewRequest(http.MethodGet, "/data/x/manifest.pb", nil)
	req.Header.Set("Accept-Encoding", "gzip, zstd")
	rec := httptest.NewRecorder()

	assert.True(t, servePrecompressed(rec, req, path, "application/x-protobuf"))
	assert.Equal(t, "zstd", rec.Header().Get("Content-Encoding"))
	assert.Equal(t, "application/x-protobuf", rec.Header().Get("Content-Type"))
	assert.Less(t, rec.Body.Len(), len(protoPayload()), "compressed body is served")
}

func TestServePrecompressed_FallsBackToGzip(t *testing.T) {
	dir := t.TempDir()
	path := writeArtifactWithSidecars(t, dir, "manifest.pb", protoPayload())

	req := httptest.NewRequest(http.MethodGet, "/data/x/manifest.pb", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	rec := httptest.NewRecorder()

	assert.True(t, servePrecompressed(rec, req, path, "application/x-protobuf"))
	assert.Equal(t, "gzip", rec.Header().Get("Content-Encoding"))
}

func TestServePrecompressed_DeclinesWithoutAcceptEncoding(t *testing.T) {
	dir := t.TempDir()
	path := writeArtifactWithSidecars(t, dir, "manifest.pb", protoPayload())

	req := httptest.NewRequest(http.MethodGet, "/data/x/manifest.pb", nil)
	rec := httptest.NewRecorder()

	assert.False(t, servePrecompressed(rec, req, path, "application/x-protobuf"))
	assert.Empty(t, rec.Header().Get("Content-Encoding"))
	assert.Zero(t, rec.Body.Len(), "response is left untouched for the caller")
}

func TestServePrecompressed_DeclinesWhenNoSidecarExists(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "legacy.pb")
	require.NoError(t, os.WriteFile(path, protoPayload(), 0644))

	req := httptest.NewRequest(http.MethodGet, "/data/x/legacy.pb", nil)
	req.Header.Set("Accept-Encoding", "gzip, zstd")
	rec := httptest.NewRecorder()

	assert.False(t, servePrecompressed(rec, req, path, "application/x-protobuf"),
		"a recording converted before sidecars existed still serves raw")
}

// A sidecar left over from an earlier conversion must never be served in place
// of an artifact that has since been rewritten.
func TestServePrecompressed_IgnoresStaleSidecar(t *testing.T) {
	dir := t.TempDir()
	path := writeArtifactWithSidecars(t, dir, "manifest.pb", protoPayload())

	// Age both sidecars behind the artifact.
	stale := time.Now().Add(-time.Hour)
	for _, coding := range storage.PrecompressEncodings {
		require.NoError(t, os.Chtimes(path+storage.PrecompressSuffix[coding], stale, stale))
	}

	req := httptest.NewRequest(http.MethodGet, "/data/x/manifest.pb", nil)
	req.Header.Set("Accept-Encoding", "gzip, zstd")
	rec := httptest.NewRecorder()

	assert.False(t, servePrecompressed(rec, req, path, "application/x-protobuf"))
}

func TestServePrecompressed_HonoursRefusal(t *testing.T) {
	dir := t.TempDir()
	path := writeArtifactWithSidecars(t, dir, "manifest.pb", protoPayload())

	req := httptest.NewRequest(http.MethodGet, "/data/x/manifest.pb", nil)
	req.Header.Set("Accept-Encoding", "zstd;q=0, gzip;q=0")
	rec := httptest.NewRecorder()

	assert.False(t, servePrecompressed(rec, req, path, "application/x-protobuf"))
}
