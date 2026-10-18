package maptoolcli

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/OCAP2/web/internal/maptool"
)

func TestPublishPartial_Fresh(t *testing.T) {
	base := t.TempDir()
	partial := filepath.Join(base, ".altis.partial")
	final := filepath.Join(base, "altis")
	require.NoError(t, os.MkdirAll(partial, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(partial, "map.json"), []byte("{}"), 0644))

	require.NoError(t, publishPartial(partial, final))

	_, err := os.Stat(partial)
	assert.True(t, os.IsNotExist(err))
	data, err := os.ReadFile(filepath.Join(final, "map.json"))
	require.NoError(t, err)
	assert.Equal(t, "{}", string(data))
}

func TestPublishPartial_OverwritesExisting(t *testing.T) {
	base := t.TempDir()
	partial := filepath.Join(base, ".altis.partial")
	final := filepath.Join(base, "altis")
	require.NoError(t, os.MkdirAll(partial, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(partial, "new.txt"), []byte("new"), 0644))
	require.NoError(t, os.MkdirAll(final, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(final, "old.txt"), []byte("old"), 0644))

	require.NoError(t, publishPartial(partial, final))

	_, err := os.Stat(filepath.Join(final, "old.txt"))
	assert.True(t, os.IsNotExist(err), "old contents must be replaced, not merged")
	data, err := os.ReadFile(filepath.Join(final, "new.txt"))
	require.NoError(t, err)
	assert.Equal(t, "new", string(data))
}

// ---------------------------------------------------------------------------
// preflight tests
// ---------------------------------------------------------------------------

func TestPreflight_AllRequiredPresent(t *testing.T) {
	tools := maptool.ToolSet{
		{Name: "pmtiles", Required: true, Found: true},
		{Name: "tippecanoe", Required: true, Found: true},
		{Name: "gdalwarp", Required: false, Found: false},
	}
	assert.NoError(t, preflight(tools))
}

func TestPreflight_RequiredToolMissing(t *testing.T) {
	tools := maptool.ToolSet{
		{Name: "pmtiles", Required: true, Found: false},
		{Name: "tippecanoe", Required: true, Found: true},
	}
	err := preflight(tools)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "pmtiles")
	assert.Contains(t, err.Error(), "ghcr.io/ocap2/web:full")
}

func TestPreflight_NonRequiredToolMissing(t *testing.T) {
	tools := maptool.ToolSet{
		{Name: "pmtiles", Required: true, Found: true},
		{Name: "tippecanoe", Required: true, Found: true},
		{Name: "gdalwarp", Required: false, Found: false},
	}
	assert.NoError(t, preflight(tools))
}

// TestRealRender_EndToEnd renders a real grad_meh fixture through the full
// pipeline. It is skipped unless OCAP_MAPTOOL_FIXTURE_ZIP points at a real
// grad_meh export AND all required external tools are present.
func TestRealRender_EndToEnd(t *testing.T) {
	fixtureZip := os.Getenv("OCAP_MAPTOOL_FIXTURE_ZIP")
	if fixtureZip == "" {
		t.Skip("set OCAP_MAPTOOL_FIXTURE_ZIP to a grad_meh export to run this test")
	}
	if _, err := os.Stat(fixtureZip); err != nil {
		t.Skipf("fixture %s not available: %v", fixtureZip, err)
	}

	tools := maptool.DetectTools()
	if missing := tools.MissingRequired(); len(missing) > 0 {
		names := make([]string, 0, len(missing))
		for _, m := range missing {
			names = append(names, m.Name)
		}
		t.Skipf("missing tools: %v", names)
	}

	out := t.TempDir()
	partial := filepath.Join(out, ".partial")
	fm := newJSONFormatter(io.Discard)

	world, err := realRender(tools)(context.Background(), fixtureZip, partial, fm)
	require.NoError(t, err)
	assert.NotEmpty(t, world)

	_, err = os.Stat(filepath.Join(partial, "map.json"))
	require.NoError(t, err, "pipeline must produce map.json")
}
