package storage

import "fmt"

// SchemaVersion represents the protobuf/flatbuffers schema version
type SchemaVersion uint32

const (
	SchemaVersionUnknown SchemaVersion = 0
	SchemaVersionV1      SchemaVersion = 1
	CurrentSchemaVersion               = SchemaVersionV1
)

func (v SchemaVersion) String() string {
	if v == SchemaVersionUnknown {
		return "unknown"
	}
	return fmt.Sprintf("v%d", v)
}

// JSONInputVersion represents the input JSON format version
type JSONInputVersion uint32

const (
	JSONInputVersionUnknown JSONInputVersion = 0
	JSONInputVersionV1      JSONInputVersion = 1
	CurrentJSONInputVersion                  = JSONInputVersionV1
)

func (v JSONInputVersion) String() string {
	if v == JSONInputVersionUnknown {
		return "unknown"
	}
	return fmt.Sprintf("v%d", v)
}

// DetectJSONInputVersion analyzes JSON data to determine its format version
func DetectJSONInputVersion(data map[string]interface{}) JSONInputVersion {
	requiredV1 := []string{"worldName", "missionName", "endFrame", "captureDelay", "entities"}
	for _, key := range requiredV1 {
		if _, ok := data[key]; !ok {
			return JSONInputVersionUnknown
		}
	}
	return JSONInputVersionV1
}

// MapInputToSchema returns the schema version to use for a given input version
func MapInputToSchema(input JSONInputVersion) SchemaVersion {
	switch input {
	case JSONInputVersionV1:
		return SchemaVersionV1
	default:
		return CurrentSchemaVersion
	}
}
