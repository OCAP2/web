package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func frontendFS() fstest.MapFS {
	return fstest.MapFS{
		"index.html":                &fstest.MapFile{Data: []byte("<html><head></head><body></body></html>")},
		"assets/index-BsiBu4cN.js":  &fstest.MapFile{Data: []byte("console.log('app')")},
		"assets/index-BOnpnqGh.css": &fstest.MapFile{Data: []byte("body{color:red}")},
		"favicon.ico":               &fstest.MapFile{Data: []byte("icon-bytes")},
	}
}

func TestStaticCacheControl(t *testing.T) {
	assert.Equal(t, immutableCacheControl, staticCacheControl("assets/index-BsiBu4cN.js"))
	assert.Equal(t, immutableCacheControl, staticCacheControl("assets/index-BOnpnqGh.css"))
	assert.Equal(t, "no-cache", staticCacheControl("index.html"),
		"the shell keeps its name across deploys, so it must revalidate")
	assert.Equal(t, "no-cache", staticCacheControl("favicon.ico"))
}

// Content-hashed bundles are the largest repeat-visit cost; they must be
// frozen, and they must carry exactly one Cache-Control value.
func TestSpaFileServer_HashedAssetsAreImmutable(t *testing.T) {
	handler := spaFileServer(frontendFS(), "")

	req := httptest.NewRequest(http.MethodGet, "/assets/index-BsiBu4cN.js", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, []string{immutableCacheControl}, rec.Header().Values("Cache-Control"))
	assert.NotEmpty(t, rec.Header().Get("Etag"))
}

func TestSpaFileServer_IndexIsRevalidated(t *testing.T) {
	handler := spaFileServer(frontendFS(), "")

	req := httptest.NewRequest(http.MethodGet, "/app/route", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "no-cache", rec.Header().Get("Cache-Control"))
	assert.NotEmpty(t, rec.Header().Get("Etag"))
	assert.Contains(t, rec.Body.String(), "__BASE_PATH__")
}

// embed.FS reports a zero modification time, so Last-Modified can never answer
// a revalidation. The ETag is what turns "no-cache" into a 304 instead of a
// full re-download.
func TestSpaFileServer_ConditionalRequestReturns304(t *testing.T) {
	handler := spaFileServer(frontendFS(), "")

	req := httptest.NewRequest(http.MethodGet, "/assets/index-BsiBu4cN.js", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)
	etag := rec.Header().Get("Etag")
	require.NotEmpty(t, etag)

	conditional := httptest.NewRequest(http.MethodGet, "/assets/index-BsiBu4cN.js", nil)
	conditional.Header.Set("If-None-Match", etag)
	rec2 := httptest.NewRecorder()
	handler.ServeHTTP(rec2, conditional)

	assert.Equal(t, http.StatusNotModified, rec2.Code)
	assert.Zero(t, rec2.Body.Len(), "a 304 carries no body")
}

func TestSpaFileServer_IndexConditionalRequestReturns304(t *testing.T) {
	handler := spaFileServer(frontendFS(), "")

	req := httptest.NewRequest(http.MethodGet, "/app/route", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	etag := rec.Header().Get("Etag")
	require.NotEmpty(t, etag)

	conditional := httptest.NewRequest(http.MethodGet, "/app/route", nil)
	conditional.Header.Set("If-None-Match", etag)
	rec2 := httptest.NewRecorder()
	handler.ServeHTTP(rec2, conditional)

	assert.Equal(t, http.StatusNotModified, rec2.Code)
}

// The ETag must track the served bytes, which for index.html means the body
// after the base-path injection, not the file on disk.
func TestSpaFileServer_IndexETagCoversInjectedBody(t *testing.T) {
	plain := spaFileServer(frontendFS(), "")
	prefixed := spaFileServer(frontendFS(), "/aar")

	rec := httptest.NewRecorder()
	plain.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/route", nil))

	rec2 := httptest.NewRecorder()
	prefixed.ServeHTTP(rec2, httptest.NewRequest(http.MethodGet, "/aar/route", nil))

	require.NotEmpty(t, rec.Header().Get("Etag"))
	require.NotEmpty(t, rec2.Header().Get("Etag"))
	assert.NotEqual(t, rec.Header().Get("Etag"), rec2.Header().Get("Etag"),
		"different injected base paths are different bodies")
}

func TestSpaFileServer_ETagChangesWithContent(t *testing.T) {
	first := frontendFS()
	second := frontendFS()
	second["assets/index-BsiBu4cN.js"] = &fstest.MapFile{Data: []byte("console.log('changed')")}

	get := func(fsys fstest.MapFS) string {
		rec := httptest.NewRecorder()
		spaFileServer(fsys, "").ServeHTTP(rec,
			httptest.NewRequest(http.MethodGet, "/assets/index-BsiBu4cN.js", nil))
		return rec.Header().Get("Etag")
	}

	assert.NotEqual(t, get(first), get(second))
}
