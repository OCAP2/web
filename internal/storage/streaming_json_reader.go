package storage

import (
	"bytes"
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

// StreamingJSONReader reads a JSON recording file using streaming tokens.
// It first reads all scalar metadata fields, then provides methods to
// stream through arrays (entities, events, markers, times) one element at a time.
type StreamingJSONReader struct {
	closer io.Closer
	meta   StreamingMetadata

	// Track which arrays we've collected during initial scan
	pendingArrays map[string]json.RawMessage
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

	sr, err := NewStreamingJSONReader(reader)
	if err != nil {
		closer.Close()
		return nil, err
	}
	sr.closer = closer
	return sr, nil
}

// NewStreamingJSONReader creates a reader from any io.Reader.
// It performs an initial scan to extract metadata and locate array positions.
func NewStreamingJSONReader(r io.Reader) (*StreamingJSONReader, error) {
	sr := &StreamingJSONReader{
		pendingArrays: make(map[string]json.RawMessage),
	}

	decoder := json.NewDecoder(r)

	// Expect opening brace
	tok, err := decoder.Token()
	if err != nil {
		return nil, fmt.Errorf("expected opening brace: %w", err)
	}
	if delim, ok := tok.(json.Delim); !ok || delim != '{' {
		return nil, fmt.Errorf("expected '{', got %v", tok)
	}

	// Read key-value pairs
	for decoder.More() {
		// Read key
		tok, err := decoder.Token()
		if err != nil {
			return nil, fmt.Errorf("read key: %w", err)
		}
		key, ok := tok.(string)
		if !ok {
			return nil, fmt.Errorf("expected string key, got %T", tok)
		}

		// For known array fields, capture as raw JSON for streaming later
		switch key {
		case "entities", "events", "Markers", "times":
			var raw json.RawMessage
			if err := decoder.Decode(&raw); err != nil {
				return nil, fmt.Errorf("decode %s: %w", key, err)
			}
			sr.pendingArrays[key] = raw
		default:
			// Scalar metadata fields
			var val interface{}
			if err := decoder.Decode(&val); err != nil {
				return nil, fmt.Errorf("decode %s: %w", key, err)
			}
			switch key {
			case "worldName":
				sr.meta.WorldName, _ = val.(string)
			case "missionName":
				sr.meta.MissionName, _ = val.(string)
			case "missionAuthor":
				sr.meta.MissionAuthor, _ = val.(string)
			case "endFrame":
				if f, ok := val.(float64); ok {
					sr.meta.FrameCount = uint32(f)
				}
			case "captureDelay":
				if f, ok := val.(float64); ok {
					sr.meta.CaptureDelayMs = uint32(f * 1000)
				}
			case "extensionVersion":
				sr.meta.ExtensionVersion, _ = val.(string)
			case "addonVersion":
				sr.meta.AddonVersion, _ = val.(string)
			}
		}
	}

	return sr, nil
}

// Metadata returns the extracted scalar metadata.
func (sr *StreamingJSONReader) Metadata() StreamingMetadata {
	return sr.meta
}

// StreamEntities calls fn for each entity in the entities array.
func (sr *StreamingJSONReader) StreamEntities(fn func(entity map[string]interface{}) error) error {
	raw, ok := sr.pendingArrays["entities"]
	if !ok {
		return nil
	}

	decoder := json.NewDecoder(bytes.NewReader(raw))
	// Expect opening bracket
	tok, err := decoder.Token()
	if err != nil {
		return fmt.Errorf("entities: expected opening bracket: %w", err)
	}
	if delim, ok := tok.(json.Delim); !ok || delim != '[' {
		return fmt.Errorf("entities: expected '[', got %v", tok)
	}

	for decoder.More() {
		var entity map[string]interface{}
		if err := decoder.Decode(&entity); err != nil {
			return fmt.Errorf("decode entity: %w", err)
		}
		if err := fn(entity); err != nil {
			return err
		}
	}

	return nil
}

// StreamEvents calls fn for each event in the events array.
func (sr *StreamingJSONReader) StreamEvents(fn func(event []interface{}) error) error {
	raw, ok := sr.pendingArrays["events"]
	if !ok {
		return nil
	}

	decoder := json.NewDecoder(bytes.NewReader(raw))
	tok, err := decoder.Token()
	if err != nil {
		return fmt.Errorf("events: expected opening bracket: %w", err)
	}
	if delim, ok := tok.(json.Delim); !ok || delim != '[' {
		return fmt.Errorf("events: expected '[', got %v", tok)
	}

	for decoder.More() {
		var event []interface{}
		if err := decoder.Decode(&event); err != nil {
			return fmt.Errorf("decode event: %w", err)
		}
		if err := fn(event); err != nil {
			return err
		}
	}

	return nil
}

// StreamMarkers calls fn for each marker in the Markers array.
func (sr *StreamingJSONReader) StreamMarkers(fn func(marker []interface{}) error) error {
	raw, ok := sr.pendingArrays["Markers"]
	if !ok {
		return nil
	}

	decoder := json.NewDecoder(bytes.NewReader(raw))
	tok, err := decoder.Token()
	if err != nil {
		return fmt.Errorf("markers: expected opening bracket: %w", err)
	}
	if delim, ok := tok.(json.Delim); !ok || delim != '[' {
		return fmt.Errorf("markers: expected '[', got %v", tok)
	}

	for decoder.More() {
		var marker []interface{}
		if err := decoder.Decode(&marker); err != nil {
			return fmt.Errorf("decode marker: %w", err)
		}
		if err := fn(marker); err != nil {
			return err
		}
	}

	return nil
}

// StreamTimes calls fn for each time sample in the times array.
func (sr *StreamingJSONReader) StreamTimes(fn func(ts map[string]interface{}) error) error {
	raw, ok := sr.pendingArrays["times"]
	if !ok {
		return nil
	}

	decoder := json.NewDecoder(bytes.NewReader(raw))
	tok, err := decoder.Token()
	if err != nil {
		return fmt.Errorf("times: expected opening bracket: %w", err)
	}
	if delim, ok := tok.(json.Delim); !ok || delim != '[' {
		return fmt.Errorf("times: expected '[', got %v", tok)
	}

	for decoder.More() {
		var ts map[string]interface{}
		if err := decoder.Decode(&ts); err != nil {
			return fmt.Errorf("decode time: %w", err)
		}
		if err := fn(ts); err != nil {
			return err
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
