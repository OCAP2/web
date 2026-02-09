package storage

import (
	"context"
	"fmt"
)

// Writer writes ParseResult to a specific schema version
type Writer interface {
	Version() SchemaVersion
	Format() string // "protobuf" or "flatbuffers"
	WriteManifest(ctx context.Context, outputPath string, result *ParseResult) error
	WriteChunks(ctx context.Context, outputPath string, result *ParseResult) error
}

// writers is the registry of writers by format and version
var writers = make(map[string]Writer) // key: "protobuf_v1", "flatbuffers_v1"

// RegisterWriter registers a writer for its format and version
func RegisterWriter(w Writer) {
	key := fmt.Sprintf("%s_v%d", w.Format(), w.Version())
	writers[key] = w
}

// GetWriter returns the writer for a given format and version
func GetWriter(format string, version SchemaVersion) (Writer, error) {
	key := fmt.Sprintf("%s_v%d", format, version)
	if w, ok := writers[key]; ok {
		return w, nil
	}
	return nil, fmt.Errorf("no writer for %s version %d", format, version)
}
