package server

import (
	"net/http"
	"os"
	"path"
	"strconv"
	"strings"

	"github.com/OCAP2/web/internal/storage"
)

// acceptedEncodings parses an Accept-Encoding header into coding → qvalue.
//
// Only what the negotiation below actually needs is modelled: explicit codings,
// their qvalues, and the "*" wildcard. A coding at q=0 is a refusal, which is
// how a client opts out of a coding the wildcard would otherwise allow.
func acceptedEncodings(header string) map[string]float64 {
	if header == "" {
		return nil
	}

	out := make(map[string]float64)
	for _, part := range strings.Split(header, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}

		coding, params, _ := strings.Cut(part, ";")
		coding = strings.ToLower(strings.TrimSpace(coding))
		if coding == "" {
			continue
		}

		q := 1.0
		for _, param := range strings.Split(params, ";") {
			key, value, ok := strings.Cut(param, "=")
			if !ok || strings.ToLower(strings.TrimSpace(key)) != "q" {
				continue
			}
			if parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64); err == nil {
				q = parsed
			}
		}
		out[coding] = q
	}
	return out
}

// acceptsEncoding reports whether the client will take the given coding, either
// by naming it or by a wildcard that does not exclude it.
func acceptsEncoding(accepted map[string]float64, coding string) bool {
	if q, ok := accepted[coding]; ok {
		return q > 0
	}
	if q, ok := accepted["*"]; ok {
		return q > 0
	}
	return false
}

// servePrecompressed serves the precompressed sidecar written next to path at
// conversion time, when the client accepts one. It reports whether it wrote a
// response; a false return leaves the response untouched for the caller to
// serve the raw file.
//
// A sidecar older than the artifact it belongs to is ignored. That makes a
// stale compressed copy harmless rather than a source of served-wrong-bytes:
// the request simply falls through to the file that is definitely current.
func servePrecompressed(w http.ResponseWriter, r *http.Request, absolutePath, contentType string) bool {
	accepted := acceptedEncodings(r.Header.Get("Accept-Encoding"))
	if len(accepted) == 0 {
		return false
	}

	info, err := os.Stat(absolutePath)
	if err != nil {
		return false
	}

	for _, coding := range storage.PrecompressEncodings {
		if !acceptsEncoding(accepted, coding) {
			continue
		}

		sidecar := absolutePath + storage.PrecompressSuffix[coding]
		sidecarInfo, err := os.Stat(sidecar)
		if err != nil || sidecarInfo.IsDir() || sidecarInfo.ModTime().Before(info.ModTime()) {
			continue
		}

		// ServeFile would sniff the sidecar's own bytes, so the type of the
		// payload it decodes to has to be set here.
		if contentType != "" {
			w.Header().Set("Content-Type", contentType)
		}
		w.Header().Set("Content-Encoding", coding)
		http.ServeFile(w, r, sidecar)
		return true
	}

	return false
}

// dataContentType returns the type to serve a /data file as.
//
// Protobuf artifacts are labelled application/x-protobuf rather than the
// generic octet-stream: it is the accurate type, and it is one a reverse proxy
// recognises as compressible, so a deployment that compresses at the edge does
// not have to special-case OCAP's payloads.
func dataContentType(relativePath string) string {
	switch strings.ToLower(path.Ext(relativePath)) {
	case ".pb":
		return "application/x-protobuf"
	default:
		return ""
	}
}
