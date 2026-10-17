package server

import (
	"bytes"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/klauspost/compress/zstd"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/proto"

	"github.com/OCAP2/web/internal/storage"
	pbv1 "github.com/OCAP2/web/pkg/schemas/protobuf/v1"
)

// buildBulkyRecording produces a recording large enough that its converted
// artifacts clear the sidecar threshold, so the precompression path is actually
// exercised rather than skipped.
func buildBulkyRecording() map[string]interface{} {
	const (
		entityCount = 40
		frameCount  = 60
	)

	entities := make([]map[string]interface{}, 0, entityCount)
	for id := 1; id <= entityCount; id++ {
		positions := make([][]interface{}, 0, frameCount)
		for f := 0; f < frameCount; f++ {
			positions = append(positions, []interface{}{
				[]float64{float64(100 + f), float64(200 + f)},
				float64(f % 360), 1.0, 0.0,
				fmt.Sprintf("Rifleman %d", id),
				1.0,
			})
		}
		entities = append(entities, map[string]interface{}{
			"id":            id,
			"type":          "unit",
			"startFrameNum": 0,
			"name":          fmt.Sprintf("Rifleman %d", id),
			"group":         fmt.Sprintf("Alpha-%d", id%8),
			"side":          "WEST",
			"isPlayer":      1,
			"positions":     positions,
			"framesFired":   []interface{}{},
		})
	}

	// Events with real message payloads, the way radio traffic and Zeus camera
	// samples land in a production manifest.
	events := make([][]interface{}, 0, 400)
	for f := 0; f < 400; f++ {
		events = append(events, []interface{}{
			f, "generalEvent", 1, []interface{}{0},
			fmt.Sprintf(`{"action":"Start","channel":%d,"frequency":%d,"radio":"RT-1523G (ASIP) Big [Black]","type":"LR","unitId":%d}`,
				f%8, 60+f%40, f%entityCount+1),
		})
	}

	return map[string]interface{}{
		"worldName":    "altis",
		"missionName":  "Precompression Integration Mission",
		"captureDelay": 1.0,
		"endFrame":     frameCount - 1,
		"entities":     entities,
		"events":       events,
		"times":        []interface{}{},
		"Markers":      []interface{}{},
	}
}

func decodeZstd(t *testing.T, data []byte) []byte {
	t.Helper()
	dec, err := zstd.NewReader(nil)
	require.NoError(t, err)
	defer dec.Close()
	out, err := dec.DecodeAll(data, nil)
	require.NoError(t, err)
	return out
}

func decodeGzip(t *testing.T, data []byte) []byte {
	t.Helper()
	zr, err := gzip.NewReader(bytes.NewReader(data))
	require.NoError(t, err)
	defer zr.Close()
	out, err := io.ReadAll(zr)
	require.NoError(t, err)
	return out
}

// TestIntegration_PrecompressedArtifactServing runs a real conversion and then
// serves the result through GetData, checking that a client which accepts a
// coding gets the precompressed sidecar and one that does not still gets bytes
// it can parse.
func TestIntegration_PrecompressedArtifactServing(t *testing.T) {
	dir := t.TempDir()
	dataDir := filepath.Join(dir, "data")
	require.NoError(t, os.MkdirAll(dataDir, 0755))

	jsonPath := filepath.Join(dataDir, "precompress_test.json.gz")
	writeTestGzippedJSON(t, jsonPath, buildBulkyRecording())

	outputPath := filepath.Join(dataDir, "precompress_test")
	converter := storage.NewConverter(30)
	require.NoError(t, converter.Convert(context.Background(), jsonPath, outputPath))

	hdlr := Handler{setting: Setting{Data: dataDir}}

	artifacts := []struct {
		name string
		rel  string
	}{
		{"manifest", "precompress_test/manifest.pb"},
		{"chunk", "precompress_test/chunks/0000.pb"},
	}

	for _, artifact := range artifacts {
		t.Run(artifact.name+"/conversion writes sidecars", func(t *testing.T) {
			abs := filepath.Join(dataDir, filepath.FromSlash(artifact.rel))
			rawInfo, err := os.Stat(abs)
			require.NoError(t, err)
			require.Greater(t, rawInfo.Size(), int64(1024),
				"fixture must clear the sidecar threshold for this test to mean anything")

			for _, coding := range storage.PrecompressEncodings {
				info, err := os.Stat(abs + storage.PrecompressSuffix[coding])
				require.NoError(t, err, "%s sidecar written", coding)
				assert.Less(t, info.Size(), rawInfo.Size(), "%s sidecar is smaller", coding)
			}
		})

		t.Run(artifact.name+"/serves zstd when accepted", func(t *testing.T) {
			rec := serveData(&hdlr, artifact.rel, "zstd")

			require.Equal(t, http.StatusOK, rec.Code)
			assert.Equal(t, "zstd", rec.Header().Get("Content-Encoding"))
			assert.Equal(t, "application/x-protobuf", rec.Header().Get("Content-Type"))
			assert.Contains(t, rec.Header().Values("Vary"), "Accept-Encoding")

			raw, err := os.ReadFile(filepath.Join(dataDir, filepath.FromSlash(artifact.rel)))
			require.NoError(t, err)
			assert.Equal(t, raw, decodeZstd(t, rec.Body.Bytes()),
				"the compressed body decodes to exactly the artifact")
			assert.Less(t, rec.Body.Len(), len(raw))
		})

		t.Run(artifact.name+"/serves gzip when zstd is not accepted", func(t *testing.T) {
			rec := serveData(&hdlr, artifact.rel, "gzip")

			require.Equal(t, http.StatusOK, rec.Code)
			assert.Equal(t, "gzip", rec.Header().Get("Content-Encoding"))

			raw, err := os.ReadFile(filepath.Join(dataDir, filepath.FromSlash(artifact.rel)))
			require.NoError(t, err)
			assert.Equal(t, raw, decodeGzip(t, rec.Body.Bytes()))
		})

		t.Run(artifact.name+"/serves raw when nothing is accepted", func(t *testing.T) {
			rec := serveData(&hdlr, artifact.rel, "")

			require.Equal(t, http.StatusOK, rec.Code)
			assert.Empty(t, rec.Header().Get("Content-Encoding"))
			assert.Equal(t, "application/x-protobuf", rec.Header().Get("Content-Type"))

			raw, err := os.ReadFile(filepath.Join(dataDir, filepath.FromSlash(artifact.rel)))
			require.NoError(t, err)
			assert.Equal(t, raw, rec.Body.Bytes())
		})
	}

	// The decompressed manifest must still be the protobuf the player expects.
	t.Run("zstd manifest parses as a Manifest", func(t *testing.T) {
		rec := serveData(&hdlr, "precompress_test/manifest.pb", "zstd")
		require.Equal(t, http.StatusOK, rec.Code)

		var manifest pbv1.Manifest
		require.NoError(t, proto.Unmarshal(decodeZstd(t, rec.Body.Bytes()), &manifest))
		assert.Equal(t, "altis", manifest.WorldName)
		assert.Equal(t, "Precompression Integration Mission", manifest.MissionName)
		assert.Len(t, manifest.Entities, 40)
	})

	// A recording converted before sidecars existed has none on disk; the
	// request has to fall through to the raw file rather than 404 or error.
	t.Run("legacy artifact without sidecars still serves", func(t *testing.T) {
		legacyDir := filepath.Join(dataDir, "legacy_recording")
		require.NoError(t, os.MkdirAll(legacyDir, 0755))
		raw, err := os.ReadFile(filepath.Join(dataDir, "precompress_test", "manifest.pb"))
		require.NoError(t, err)
		require.NoError(t, os.WriteFile(filepath.Join(legacyDir, "manifest.pb"), raw, 0644))

		rec := serveData(&hdlr, "legacy_recording/manifest.pb", "gzip, zstd")

		require.Equal(t, http.StatusOK, rec.Code)
		assert.Empty(t, rec.Header().Get("Content-Encoding"))
		assert.Equal(t, raw, rec.Body.Bytes())
	})
}

// serveData drives GetData the way the router does, with the given
// Accept-Encoding.
func serveData(hdlr *Handler, relPath, acceptEncoding string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/data/"+relPath, nil)
	req.SetPathValue("path", relPath)
	if acceptEncoding != "" {
		req.Header.Set("Accept-Encoding", acceptEncoding)
	}
	rec := httptest.NewRecorder()
	hdlr.GetData(rec, req)
	return rec
}
