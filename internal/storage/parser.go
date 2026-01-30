// internal/storage/parser.go
package storage

import (
	"fmt"

	pb "github.com/OCAP2/web/pkg/schemas/protobuf"
)

// entityPositionData holds parsed position data for an entity
type entityPositionData struct {
	ID         uint32
	Type       string
	StartFrame uint32
	Positions  []interface{} // Raw position arrays
}

// ParseResult contains the parsed manifest and position data
type ParseResult struct {
	Manifest        *pb.Manifest
	EntityPositions []entityPositionData
}

// Parser converts JSON data to internal format
type Parser interface {
	// Version returns which JSON version this parser handles
	Version() JSONVersion
	// Parse converts JSON data to ParseResult
	Parse(data map[string]interface{}, chunkSize uint32) (*ParseResult, error)
}

var parsers = make(map[JSONVersion]Parser)

// RegisterParser adds a parser to the registry
func RegisterParser(p Parser) {
	parsers[p.Version()] = p
}

// GetParser returns a parser for the given version
func GetParser(v JSONVersion) (Parser, error) {
	if p, ok := parsers[v]; ok {
		return p, nil
	}
	return nil, fmt.Errorf("no parser for JSON version %s", v.String())
}
