// internal/storage/version.go
package storage

import "fmt"

// JSONVersion represents the version of the input JSON format
type JSONVersion uint32

const (
	// JSONVersionUnknown indicates the version could not be determined
	JSONVersionUnknown JSONVersion = 0
	// JSONVersionV1 is the original OCAP JSON format
	JSONVersionV1 JSONVersion = 1
	// CurrentJSONVersion is the latest supported version
	CurrentJSONVersion = JSONVersionV1
)

// String returns a human-readable version string
func (v JSONVersion) String() string {
	if v == JSONVersionUnknown {
		return "unknown"
	}
	return fmt.Sprintf("v%d", v)
}

// DetectJSONVersion analyzes JSON data to determine its format version
func DetectJSONVersion(data map[string]interface{}) JSONVersion {
	// V1 detection: requires worldName, missionName, endFrame, captureDelay, entities
	requiredV1 := []string{"worldName", "missionName", "endFrame", "captureDelay", "entities"}
	hasAllV1 := true
	for _, key := range requiredV1 {
		if _, ok := data[key]; !ok {
			hasAllV1 = false
			break
		}
	}

	if hasAllV1 {
		return JSONVersionV1
	}

	return JSONVersionUnknown
}
