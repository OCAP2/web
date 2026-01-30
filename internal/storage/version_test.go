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
