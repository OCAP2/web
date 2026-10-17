package server

import (
	"io"
	"strings"
	"testing"
)

// Confirms the trench SVGs land in the marker registry under the exact names the
// addon emits as the marker type, and that the colour template renders.
func TestTrenchMarkerIconsResolve(t *testing.T) {
	repo, err := NewRepoMarker("../../assets/markers")
	if err != nil {
		t.Fatalf("NewRepoMarker: %v", err)
	}
	for _, name := range []string{
		"trench", "trench_small", "trench_big", "trench_short",
		"trench_long", "trench_giant", "trench_vehicle",
	} {
		r, ct, err := repo.Get(t.Context(), name, "D96600")
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if ct != "image/svg+xml" {
			t.Fatalf("%s: content type %q", name, ct)
		}
		b, _ := io.ReadAll(r)
		s := string(b)
		if strings.Contains(s, "{{") {
			t.Fatalf("%s: template not rendered", name)
		}
		if !strings.Contains(s, "#d96600ff") {
			t.Fatalf("%s: colour not applied: %s", name, s[:120])
		}
	}
}
