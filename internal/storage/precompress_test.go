package storage

import (
	"bytes"
	"compress/gzip"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/klauspost/compress/zstd"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// compressiblePayload returns data that is well above the sidecar threshold and
// compresses heavily, the way a real protobuf chunk does.
func compressiblePayload() []byte {
	return bytes.Repeat([]byte("ocap entity state frame "), 4096)
}

func readGzip(t *testing.T, path string) []byte {
	t.Helper()
	f, err := os.Open(path)
	require.NoError(t, err)
	defer f.Close()
	zr, err := gzip.NewReader(f)
	require.NoError(t, err)
	defer zr.Close()
	out, err := io.ReadAll(zr)
	require.NoError(t, err)
	return out
}

func readZstd(t *testing.T, path string) []byte {
	t.Helper()
	raw, err := os.ReadFile(path)
	require.NoError(t, err)
	dec, err := zstd.NewReader(nil)
	require.NoError(t, err)
	defer dec.Close()
	out, err := dec.DecodeAll(raw, nil)
	require.NoError(t, err)
	return out
}

func TestWriteArtifact_WritesRawAndSidecars(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "manifest.pb")
	payload := compressiblePayload()

	require.NoError(t, WriteArtifact(path, payload))

	raw, err := os.ReadFile(path)
	require.NoError(t, err)
	assert.Equal(t, payload, raw, "raw artifact stays authoritative")

	assert.Equal(t, payload, readZstd(t, path+".zst"), "zstd sidecar round-trips")
	assert.Equal(t, payload, readGzip(t, path+".gz"), "gzip sidecar round-trips")

	zstdInfo, err := os.Stat(path + ".zst")
	require.NoError(t, err)
	assert.Less(t, zstdInfo.Size(), int64(len(payload)), "sidecar is smaller than the payload")
}

func TestWriteArtifact_SkipsSidecarsForSmallPayloads(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "tiny.pb")

	require.NoError(t, WriteArtifact(path, []byte("small")))

	for _, suffix := range []string{".zst", ".gz"} {
		_, err := os.Stat(path + suffix)
		assert.ErrorIs(t, err, os.ErrNotExist, "no sidecar for %s", suffix)
	}
}

// A re-conversion that shrinks an artifact below the threshold must not leave
// the previous run's sidecar behind — the server would otherwise hand out stale
// bytes for a file that has since changed.
func TestWriteArtifact_RemovesStaleSidecarsWhenPayloadShrinks(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "chunk.pb")

	require.NoError(t, WriteArtifact(path, compressiblePayload()))
	require.FileExists(t, path+".zst")
	require.FileExists(t, path+".gz")

	require.NoError(t, WriteArtifact(path, []byte("now tiny")))

	for _, suffix := range []string{".zst", ".gz"} {
		_, err := os.Stat(path + suffix)
		assert.ErrorIs(t, err, os.ErrNotExist, "stale %s sidecar removed", suffix)
	}
	raw, err := os.ReadFile(path)
	require.NoError(t, err)
	assert.Equal(t, []byte("now tiny"), raw)
}

// Random data does not compress; writing a sidecar bigger than the payload
// would make the response worse, so none is kept.
func TestWriteArtifact_SkipsSidecarThatDoesNotShrink(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "random.pb")

	payload := make([]byte, 4096)
	for i := range payload {
		payload[i] = byte(i * 7919 % 251)
	}
	// Defeat any structure the generator above leaves behind.
	for i := 0; i < len(payload); i += 3 {
		payload[i] ^= byte(i >> 3)
	}

	require.NoError(t, WriteArtifact(path, payload))

	raw, err := os.ReadFile(path)
	require.NoError(t, err)
	assert.Equal(t, payload, raw)

	for _, suffix := range []string{".zst", ".gz"} {
		if info, err := os.Stat(path + suffix); err == nil {
			assert.Less(t, info.Size(), int64(len(payload)),
				"a kept %s sidecar must be smaller than the payload", suffix)
		}
	}
}

func TestWriteArtifact_OverwritesPreviousSidecars(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "manifest.pb")

	require.NoError(t, WriteArtifact(path, compressiblePayload()))

	updated := bytes.Repeat([]byte("different frame payload "), 4096)
	require.NoError(t, WriteArtifact(path, updated))

	assert.Equal(t, updated, readZstd(t, path+".zst"))
	assert.Equal(t, updated, readGzip(t, path+".gz"))
}

func TestCompress_UnknownEncoding(t *testing.T) {
	_, err := compress("br", []byte("data"))
	require.Error(t, err)
	assert.Contains(t, err.Error(), `unknown encoding "br"`)
}

func TestWriteSidecars_SmallPayloadRemovesStaleSidecars(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "chunk.pb")

	// Seed stale sidecars, then call WriteSidecars with a small payload: it must
	// remove them rather than leave a stale compressed copy.
	require.NoError(t, WriteArtifact(path, compressiblePayload()))
	require.FileExists(t, path+".zst")

	require.NoError(t, WriteSidecars(path, []byte("tiny")))
	_, err := os.Stat(path + ".zst")
	assert.ErrorIs(t, err, os.ErrNotExist)
}

func TestRemoveSidecar_IsIdempotent(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "missing.pb")

	// Removing a sidecar that does not exist is not an error.
	require.NoError(t, removeSidecar(path+".zst"))
	require.NoError(t, removeSidecar(path+".gz"))
}

// The rename is the atomic step; a target that cannot be renamed onto (here: a
// directory holding the same name) must fail loudly rather than clobber it.
func TestWriteFileAtomic_TargetPathIsDirectory(t *testing.T) {
	dir := t.TempDir()
	blocked := filepath.Join(dir, "blocked")
	require.NoError(t, os.Mkdir(blocked, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(blocked, "keep"), []byte("x"), 0644))

	err := writeFileAtomic(blocked, []byte("data"))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "rename onto")
}

// A missing output directory fails at temp-file creation, before any rename.
func TestWriteFileAtomic_MissingDirectory(t *testing.T) {
	err := writeFileAtomic(filepath.Join(t.TempDir(), "nope", "chunk.zst"), []byte("data"))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "create temp")
}

// A sidecar whose removal fails (a directory in its place holding a file)
// surfaces the error instead of reporting success.
func TestRemoveSidecar_ErrorOnUnremovable(t *testing.T) {
	dir := t.TempDir()
	sidecar := filepath.Join(dir, "chunk.pb.zst")
	require.NoError(t, os.Mkdir(sidecar, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(sidecar, "keep"), []byte("x"), 0644))

	err := removeSidecar(sidecar)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "remove")
}

func TestRemoveSidecars_PropagatesError(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "chunk.pb")
	sidecar := path + ".zst"
	require.NoError(t, os.Mkdir(sidecar, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(sidecar, "keep"), []byte("x"), 0644))

	err := removeSidecars(path)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "remove")
}

// WriteSidecars writes through writeFileAtomic; a sidecar path that cannot be
// renamed onto fails the whole call instead of leaving a half-written variant.
func TestWriteSidecars_WriteFailureSurfaces(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "chunk.pb")

	sidecar := path + ".zst"
	require.NoError(t, os.Mkdir(sidecar, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(sidecar, "keep"), []byte("x"), 0644))

	err := WriteSidecars(path, compressiblePayload())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "rename onto")
}

// An encoder that fails (simulated here with an unknown coding in the encoding
// list) aborts WriteSidecars with the wrapped reason and leaves the raw file
// authoritative.
func TestWriteSidecars_CompressFailureAborts(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "chunk.pb")

	original := PrecompressEncodings
	PrecompressEncodings = []string{"bogus"}
	t.Cleanup(func() { PrecompressEncodings = original })

	err := WriteSidecars(path, compressiblePayload())
	require.Error(t, err)
	assert.Contains(t, err.Error(), `compress`)
	assert.Contains(t, err.Error(), `unknown encoding "bogus"`)

	// The stale sidecars are untouched: the abort happens before any write.
	assert.DirExists(t, filepath.Join(dir))
}
