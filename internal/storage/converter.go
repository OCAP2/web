// server/storage/converter.go
package storage

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"

	pbv1 "github.com/OCAP2/web/pkg/schemas/protobuf/v1"
)

// DefaultChunkSize is the default number of frames per chunk (~5 minutes at 1 frame/second)
const DefaultChunkSize = 300

// Converter transforms JSON recordings to chunked protobuf/flatbuffers format
type Converter struct {
	ChunkSize uint32
}

// NewConverter creates a converter with the given chunk size
func NewConverter(chunkSize uint32) *Converter {
	if chunkSize == 0 {
		chunkSize = DefaultChunkSize
	}
	return &Converter{ChunkSize: chunkSize}
}

// Convert reads a JSON recording and writes chunked output files.
// The format parameter specifies the output format ("protobuf" or "flatbuffers").
func (c *Converter) Convert(ctx context.Context, jsonPath, outputPath string, format string) error {
	// 1. Load JSON
	data, err := c.loadJSON(jsonPath)
	if err != nil {
		return fmt.Errorf("load JSON: %w", err)
	}

	// 2. Detect version and get parser
	inputVersion := DetectJSONInputVersion(data)
	if inputVersion == JSONInputVersionUnknown {
		return fmt.Errorf("unknown JSON input version")
	}

	parser, err := GetParser(inputVersion)
	if err != nil {
		return fmt.Errorf("get parser: %w", err)
	}

	// 3. Parse to schema-agnostic result
	result, err := parser.Parse(data, c.ChunkSize)
	if err != nil {
		return fmt.Errorf("parse JSON: %w", err)
	}

	// 4. Get writer for target format and schema version
	schemaVersion := MapInputToSchema(inputVersion)
	writer, err := GetWriter(format, schemaVersion)
	if err != nil {
		return fmt.Errorf("get writer: %w", err)
	}

	// 5. Create output directory structure
	if err := os.MkdirAll(outputPath, 0755); err != nil {
		return fmt.Errorf("create output directory: %w", err)
	}

	// 6. Write output
	if err := writer.WriteManifest(ctx, outputPath, result); err != nil {
		return fmt.Errorf("write manifest: %w", err)
	}

	if err := writer.WriteChunks(ctx, outputPath, result); err != nil {
		return fmt.Errorf("write chunks: %w", err)
	}

	return nil
}

// loadJSON reads a JSON file (gzipped or plain)
func (c *Converter) loadJSON(path string) (map[string]interface{}, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var reader io.Reader = f

	// Check if gzipped by trying to read gzip header
	// or by file extension
	if filepath.Ext(path) == ".gz" {
		gr, err := gzip.NewReader(f)
		if err != nil {
			return nil, fmt.Errorf("gzip reader: %w", err)
		}
		defer gr.Close()
		reader = gr
	}

	var data map[string]interface{}
	if err := json.NewDecoder(reader).Decode(&data); err != nil {
		return nil, fmt.Errorf("decode JSON: %w", err)
	}

	return data, nil
}

// Helper functions for type conversion (used by other files)

func stringToEntityType(s string) pbv1.EntityType {
	switch s {
	case "unit":
		return pbv1.EntityType_ENTITY_TYPE_UNIT
	case "vehicle":
		return pbv1.EntityType_ENTITY_TYPE_VEHICLE
	default:
		return pbv1.EntityType_ENTITY_TYPE_UNKNOWN
	}
}

func stringToSide(s string) pbv1.Side {
	switch s {
	case "WEST":
		return pbv1.Side_SIDE_WEST
	case "EAST":
		return pbv1.Side_SIDE_EAST
	case "GUER", "INDEPENDENT":
		return pbv1.Side_SIDE_GUER
	case "CIV", "CIVILIAN":
		return pbv1.Side_SIDE_CIV
	case "GLOBAL":
		return pbv1.Side_SIDE_GLOBAL
	default:
		return pbv1.Side_SIDE_UNKNOWN
	}
}

func sideIndexToSide(idx int) pbv1.Side {
	switch idx {
	case 0:
		return pbv1.Side_SIDE_WEST
	case 1:
		return pbv1.Side_SIDE_EAST
	case 2:
		return pbv1.Side_SIDE_GUER
	case 3:
		return pbv1.Side_SIDE_CIV
	default:
		return pbv1.Side_SIDE_UNKNOWN
	}
}

func toFloat64(v interface{}) float64 {
	if f, ok := v.(float64); ok {
		return f
	}
	return 0
}

func toString(v interface{}) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}
