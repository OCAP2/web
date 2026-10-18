package storage

import (
	"bytes"
	"compress/gzip"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sync"

	"github.com/klauspost/compress/zstd"
)

// Content codings written alongside every protobuf artifact.
//
// A converted recording is immutable, so its bytes are worth compressing once
// here rather than on every request: the web server hands the sidecar straight
// to any client that accepts the coding, which both removes the per-request
// compression cost and buys a ratio a live compressor could not afford. On a
// real 3h45m recording a 2.4 MB chunk lands at ~28 KB this way against ~55 KB
// from on-the-fly gzip.
//
// zstd is preferred — smaller and much faster to decode — with gzip kept for
// clients that do not advertise zstd.
const (
	EncodingZstd = "zstd"
	EncodingGzip = "gzip"
)

// PrecompressEncodings lists the codings written for each artifact, best first.
// The server walks this order when picking a sidecar for a request.
var PrecompressEncodings = []string{EncodingZstd, EncodingGzip}

// PrecompressSuffix maps a content coding to its sidecar file extension.
var PrecompressSuffix = map[string]string{
	EncodingZstd: ".zst",
	EncodingGzip: ".gz",
}

// precompressMinSize is the size below which an artifact is written on its own.
// A sidecar for a payload this small saves nothing worth an extra file: the
// response fits in a single packet either way.
const precompressMinSize = 1024

var (
	zstdOnce sync.Once
	zstdEnc  *zstd.Encoder
	zstdErr  error
)

// zstdEncoder returns the shared encoder. zstd.Encoder.EncodeAll is safe for
// concurrent use, so one encoder serves every conversion worker.
func zstdEncoder() (*zstd.Encoder, error) {
	zstdOnce.Do(func() {
		zstdEnc, zstdErr = zstd.NewWriter(nil,
			zstd.WithEncoderLevel(zstd.SpeedBestCompression),
			zstd.WithEncoderConcurrency(1),
		)
	})
	return zstdEnc, zstdErr
}

// compress encodes data with the given coding.
func compress(encoding string, data []byte) ([]byte, error) {
	switch encoding {
	case EncodingZstd:
		enc, err := zstdEncoder()
		if err != nil {
			return nil, fmt.Errorf("zstd encoder: %w", err)
		}
		return enc.EncodeAll(data, nil), nil
	case EncodingGzip:
		var buf bytes.Buffer
		zw, err := gzip.NewWriterLevel(&buf, gzip.BestCompression)
		if err != nil {
			return nil, fmt.Errorf("gzip writer: %w", err)
		}
		if _, err := zw.Write(data); err != nil {
			return nil, fmt.Errorf("gzip write: %w", err)
		}
		if err := zw.Close(); err != nil {
			return nil, fmt.Errorf("gzip close: %w", err)
		}
		return buf.Bytes(), nil
	default:
		return nil, fmt.Errorf("unknown encoding %q", encoding)
	}
}

// WriteArtifact writes a converted protobuf artifact and its precompressed
// sidecars. The raw file stays authoritative — a client that accepts no coding,
// and every existing reader of these files, is unaffected.
func WriteArtifact(path string, data []byte) error {
	if err := os.WriteFile(path, data, 0644); err != nil {
		return err
	}
	return WriteSidecars(path, data)
}

// WriteSidecars writes just the precompressed variants of an artifact whose raw
// bytes are already on disk. Conversion reaches it through WriteArtifact; the
// backfill command uses it directly, so an existing recording gains sidecars
// without its artifacts being rewritten.
//
// Sidecars are removed rather than left behind when they are not written, so a
// re-conversion that shrinks a file below the threshold (or one running against
// a directory from an older build) can never leave a stale compressed copy for
// the server to serve in place of the current bytes.
func WriteSidecars(path string, data []byte) error {
	if len(data) < precompressMinSize {
		return removeSidecars(path)
	}

	for _, encoding := range PrecompressEncodings {
		sidecar := path + PrecompressSuffix[encoding]
		encoded, err := compress(encoding, data)
		if err != nil {
			return fmt.Errorf("compress %s: %w", sidecar, err)
		}
		// A sidecar that did not shrink the payload is pure overhead; drop it
		// and let the request fall through to the raw file.
		if len(encoded) >= len(data) {
			if err := removeSidecar(sidecar); err != nil {
				return err
			}
			continue
		}
		if err := writeFileAtomic(sidecar, encoded); err != nil {
			return err
		}
	}

	return nil
}

// writeFileAtomic writes through a temporary file in the same directory and
// renames it into place.
//
// The rename is what makes the backfill safe to run against a server that is
// already serving these recordings: a request either sees no sidecar and falls
// back to the raw artifact, or sees a complete one. It can never read a
// half-written compressed file and hand the browser truncated bytes.
func writeFileAtomic(path string, data []byte) error {
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, "."+filepath.Base(path)+".tmp*")
	if err != nil {
		return fmt.Errorf("create temp for %s: %w", path, err)
	}
	tmpName := tmp.Name()

	cleanup := func() {
		tmp.Close()
		os.Remove(tmpName)
	}

	if _, err := tmp.Write(data); err != nil {
		cleanup()
		return fmt.Errorf("write %s: %w", tmpName, err)
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpName)
		return fmt.Errorf("close %s: %w", tmpName, err)
	}
	if err := os.Chmod(tmpName, 0644); err != nil {
		os.Remove(tmpName)
		return fmt.Errorf("chmod %s: %w", tmpName, err)
	}
	if err := os.Rename(tmpName, path); err != nil {
		os.Remove(tmpName)
		return fmt.Errorf("rename onto %s: %w", path, err)
	}
	return nil
}

// removeSidecars deletes every precompressed variant of path.
func removeSidecars(path string) error {
	for _, encoding := range PrecompressEncodings {
		if err := removeSidecar(path + PrecompressSuffix[encoding]); err != nil {
			return err
		}
	}
	return nil
}

func removeSidecar(path string) error {
	if err := os.Remove(path); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return fmt.Errorf("remove %s: %w", path, err)
	}
	return nil
}
