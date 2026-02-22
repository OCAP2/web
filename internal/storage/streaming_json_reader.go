package storage

import (
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"os"
)

// StreamingMetadata holds the scalar metadata from the JSON file.
type StreamingMetadata struct {
	WorldName        string
	MissionName      string
	MissionAuthor    string
	FrameCount       uint32
	CaptureDelayMs   uint32
	ExtensionVersion string
	AddonVersion     string
}

// StreamingCallbacks defines callbacks for each array element type.
// All callbacks are optional — nil callbacks cause the array to be skipped.
type StreamingCallbacks struct {
	OnEntity func(entity map[string]interface{}) error
	OnEvent  func(event []interface{}) error
	OnMarker func(marker []interface{}) error
	OnTime   func(ts map[string]interface{}) error
}

// StreamingJSONReader reads a JSON recording file in a single pass.
// It processes arrays directly from the decoder without buffering,
// keeping only one element in memory at a time.
type StreamingJSONReader struct {
	decoder *json.Decoder
	closer  io.Closer
}

// OpenStreamingJSONReader opens a file (gzipped or plain) and creates a reader.
func OpenStreamingJSONReader(path string) (*StreamingJSONReader, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}

	var reader io.Reader = f
	var closer io.Closer = f

	// Detect gzip by magic bytes
	magic := make([]byte, 2)
	if n, err := f.Read(magic); err == nil && n == 2 {
		if _, err := f.Seek(0, io.SeekStart); err != nil {
			f.Close()
			return nil, fmt.Errorf("seek: %w", err)
		}
		if magic[0] == 0x1f && magic[1] == 0x8b {
			gr, err := gzip.NewReader(f)
			if err != nil {
				f.Close()
				return nil, fmt.Errorf("gzip reader: %w", err)
			}
			reader = gr
			closer = &multiCloser{closers: []io.Closer{gr, f}}
		}
	}

	return &StreamingJSONReader{
		decoder: json.NewDecoder(reader),
		closer:  closer,
	}, nil
}

// NewStreamingJSONReader creates a reader from any io.Reader.
func NewStreamingJSONReader(r io.Reader) *StreamingJSONReader {
	return &StreamingJSONReader{
		decoder: json.NewDecoder(r),
	}
}

// Process performs a single-pass read through the JSON file.
// Scalar metadata is extracted and returned. Arrays are streamed
// element-by-element through the provided callbacks, never buffered.
func (sr *StreamingJSONReader) Process(callbacks StreamingCallbacks) (StreamingMetadata, error) {
	var meta StreamingMetadata

	// Expect opening brace
	tok, err := sr.decoder.Token()
	if err != nil {
		return meta, fmt.Errorf("expected opening brace: %w", err)
	}
	if delim, ok := tok.(json.Delim); !ok || delim != '{' {
		return meta, fmt.Errorf("expected '{', got %v", tok)
	}

	// Read key-value pairs sequentially
	for sr.decoder.More() {
		tok, err := sr.decoder.Token()
		if err != nil {
			return meta, fmt.Errorf("read key: %w", err)
		}
		key, ok := tok.(string)
		if !ok {
			return meta, fmt.Errorf("expected string key, got %T", tok)
		}

		switch key {
		case "entities":
			if err := sr.streamMapArray(callbacks.OnEntity); err != nil {
				return meta, fmt.Errorf("stream entities: %w", err)
			}
		case "events":
			if err := sr.streamSliceArray(callbacks.OnEvent); err != nil {
				return meta, fmt.Errorf("stream events: %w", err)
			}
		case "Markers":
			if err := sr.streamSliceArray(callbacks.OnMarker); err != nil {
				return meta, fmt.Errorf("stream markers: %w", err)
			}
		case "times":
			if err := sr.streamMapArray(callbacks.OnTime); err != nil {
				return meta, fmt.Errorf("stream times: %w", err)
			}
		default:
			var val interface{}
			if err := sr.decoder.Decode(&val); err != nil {
				return meta, fmt.Errorf("decode %s: %w", key, err)
			}
			switch key {
			case "worldName":
				if s, ok := val.(string); ok {
					meta.WorldName = s
				}
			case "missionName":
				if s, ok := val.(string); ok {
					meta.MissionName = s
				}
			case "missionAuthor":
				if s, ok := val.(string); ok {
					meta.MissionAuthor = s
				}
			case "endFrame":
				if f, ok := val.(float64); ok {
					meta.FrameCount = uint32(f)
				}
			case "captureDelay":
				if f, ok := val.(float64); ok {
					meta.CaptureDelayMs = uint32(f * 1000)
				}
			case "extensionVersion":
				if s, ok := val.(string); ok {
					meta.ExtensionVersion = s
				}
			case "addonVersion":
				if s, ok := val.(string); ok {
					meta.AddonVersion = s
				}
			}
		}
	}

	return meta, nil
}

// streamMapArray reads a JSON array of objects, calling fn for each.
// If fn is nil, the array is skipped without allocating.
func (sr *StreamingJSONReader) streamMapArray(fn func(map[string]interface{}) error) error {
	if err := sr.expectToken('['); err != nil {
		return err
	}
	if fn == nil {
		return sr.skipToEndOfArray()
	}
	for sr.decoder.More() {
		var item map[string]interface{}
		if err := sr.decoder.Decode(&item); err != nil {
			return fmt.Errorf("decode item: %w", err)
		}
		if err := fn(item); err != nil {
			return err
		}
	}
	_, err := sr.decoder.Token() // consume ']'
	return err
}

// streamSliceArray reads a JSON array of arrays, calling fn for each.
// If fn is nil, the array is skipped without allocating.
func (sr *StreamingJSONReader) streamSliceArray(fn func([]interface{}) error) error {
	if err := sr.expectToken('['); err != nil {
		return err
	}
	if fn == nil {
		return sr.skipToEndOfArray()
	}
	for sr.decoder.More() {
		var item []interface{}
		if err := sr.decoder.Decode(&item); err != nil {
			return fmt.Errorf("decode item: %w", err)
		}
		if err := fn(item); err != nil {
			return err
		}
	}
	_, err := sr.decoder.Token() // consume ']'
	return err
}

// expectToken reads the next token and verifies it matches the expected delimiter.
func (sr *StreamingJSONReader) expectToken(expected rune) error {
	tok, err := sr.decoder.Token()
	if err != nil {
		return fmt.Errorf("expected '%c': %w", expected, err)
	}
	if delim, ok := tok.(json.Delim); !ok || delim != json.Delim(expected) {
		return fmt.Errorf("expected '%c', got %v", expected, tok)
	}
	return nil
}

// skipToEndOfArray skips tokens until the matching closing bracket.
func (sr *StreamingJSONReader) skipToEndOfArray() error {
	depth := 1
	for depth > 0 {
		tok, err := sr.decoder.Token()
		if err != nil {
			return err
		}
		if delim, ok := tok.(json.Delim); ok {
			switch delim {
			case '[', '{':
				depth++
			case ']', '}':
				depth--
			}
		}
	}
	return nil
}

// Close closes the underlying reader if it was opened with OpenStreamingJSONReader.
func (sr *StreamingJSONReader) Close() error {
	if sr.closer != nil {
		return sr.closer.Close()
	}
	return nil
}

type multiCloser struct {
	closers []io.Closer
}

func (mc *multiCloser) Close() error {
	var firstErr error
	for _, c := range mc.closers {
		if err := c.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}
