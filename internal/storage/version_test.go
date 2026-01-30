// internal/storage/version_test.go
package storage

import "testing"

func TestCurrentJSONVersion(t *testing.T) {
	if CurrentJSONVersion < 1 {
		t.Error("CurrentJSONVersion must be at least 1")
	}
}

func TestVersionString(t *testing.T) {
	v := JSONVersion(1)
	if v.String() != "v1" {
		t.Errorf("expected v1, got %s", v.String())
	}
}

func TestDetectJSONVersion_V1(t *testing.T) {
	// V1 format has: worldName, missionName, endFrame, captureDelay, entities, events
	data := map[string]interface{}{
		"worldName":    "Altis",
		"missionName":  "Test",
		"endFrame":     100.0,
		"captureDelay": 1.0,
		"entities":     []interface{}{},
		"events":       []interface{}{},
	}

	v := DetectJSONVersion(data)
	if v != JSONVersionV1 {
		t.Errorf("expected V1, got %s", v.String())
	}
}

func TestDetectJSONVersion_Unknown(t *testing.T) {
	// Missing required fields
	data := map[string]interface{}{
		"foo": "bar",
	}

	v := DetectJSONVersion(data)
	if v != JSONVersionUnknown {
		t.Errorf("expected Unknown, got %s", v.String())
	}
}
