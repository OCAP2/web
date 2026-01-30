// internal/storage/parser_test.go
package storage

import (
	"testing"
)

func TestParserRegistry_Unknown(t *testing.T) {
	_, err := GetParser(JSONVersionUnknown)
	if err == nil {
		t.Error("expected error for unknown version")
	}
}
