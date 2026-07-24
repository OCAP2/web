package maptoolcli

import (
	"bytes"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/OCAP2/web/internal/maptool"
)

// ---------------------------------------------------------------------------
// tools subcommand tests
// ---------------------------------------------------------------------------

func TestRunTools_AllFound_Exit0(t *testing.T) {
	var stdout, stderr bytes.Buffer
	d := fakeDeps(&stdout, &stderr)
	d.detectTools = allFoundToolSet

	code := runTools(nil, d)
	assert.Equal(t, 0, code)
	assert.Contains(t, stdout.String(), "Tool               Status    Path")
	assert.Contains(t, stdout.String(), "10 found, 0 missing")
}

func TestRunTools_MissingRequired_Exit1(t *testing.T) {
	var stdout, stderr bytes.Buffer
	d := fakeDeps(&stdout, &stderr)
	d.detectTools = allMissingToolSet

	code := runTools(nil, d)
	assert.Equal(t, 1, code)
	assert.Contains(t, stdout.String(), "0 found, 10 missing")
	assert.Contains(t, stdout.String(), "(exit 1)")
}

func TestRunTools_RecommendedMissing_Exit0(t *testing.T) {
	var stdout, stderr bytes.Buffer
	d := fakeDeps(&stdout, &stderr)
	d.detectTools = func() maptool.ToolSet {
		return maptool.ToolSet{
			{Name: "pmtiles", Required: true, Found: true, Path: "/usr/bin/pmtiles"},
			{Name: "tippecanoe", Required: true, Found: true, Path: "/usr/bin/tippecanoe"},
			{Name: "tile-join", Required: false, Found: false},
			{Name: "gdal_translate", Required: false, Found: false},
			{Name: "gdaldem", Required: false, Found: false},
			{Name: "gdal_contour", Required: false, Found: false},
			{Name: "gdal_calc.py", Required: false, Found: false},
			{Name: "gdaladdo", Required: false, Found: false},
			{Name: "gdalbuildvrt", Required: false, Found: false},
			{Name: "gdal_fillnodata.py", Required: false, Found: false},
		}
	}

	code := runTools(nil, d)
	assert.Equal(t, 0, code, "required all found -> exit 0")
}

func TestRunTools_Dispatch(t *testing.T) {
	var stdout, stderr bytes.Buffer
	d := fakeDeps(&stdout, &stderr)
	d.detectTools = allFoundToolSet

	code := dispatch([]string{"tools"}, d)
	assert.Equal(t, 0, code)
	assert.Contains(t, stdout.String(), "Tool               Status    Path")
}

func TestPrintToolsTable_SortsRequiredFirst(t *testing.T) {
	tools := maptool.ToolSet{
		{Name: "gdal_translate", Required: false, Found: true, Path: "/usr/bin/gdal_translate"},
		{Name: "pmtiles", Required: true, Found: true, Path: "/usr/bin/pmtiles"},
	}
	var buf bytes.Buffer
	printToolsTable(&buf, tools)
	out := buf.String()

	pmtilesIdx := stringsIndex(out, "pmtiles")
	gdalIdx := stringsIndex(out, "gdal_translate")
	assert.Less(t, pmtilesIdx, gdalIdx, "required tools should appear first")
}

func TestPrintToolsTable_ShowsAllStatuses(t *testing.T) {
	tools := maptool.ToolSet{
		{Name: "pmtiles", Required: true, Found: true, Path: "/usr/bin/pmtiles"},
		{Name: "tippecanoe", Required: true, Found: false},
	}
	var buf bytes.Buffer
	printToolsTable(&buf, tools)
	out := buf.String()

	assert.Contains(t, out, "ok")
	assert.Contains(t, out, "missing")
	assert.Contains(t, out, "[required]")
}

// ---------------------------------------------------------------------------
// install subcommand tests
// ---------------------------------------------------------------------------

func TestRunInstall_Exit0(t *testing.T) {
	var stdout, stderr bytes.Buffer
	d := fakeDeps(&stdout, &stderr)

	code := runInstall(nil, d)
	assert.Equal(t, 0, code)
	assert.Contains(t, stdout.String(), "Installation Instructions")
}

func TestRunInstall_Dispatch(t *testing.T) {
	var stdout, stderr bytes.Buffer
	d := fakeDeps(&stdout, &stderr)

	code := dispatch([]string{"install"}, d)
	assert.Equal(t, 0, code)
	assert.Contains(t, stdout.String(), "Installation Instructions")
	assert.Contains(t, stdout.String(), "Notes")
}

// ---------------------------------------------------------------------------
// dispatch integration: all subcommands via dispatch
// ---------------------------------------------------------------------------

func TestDispatch_AllSubcommands(t *testing.T) {
	for _, sub := range []string{"tools", "doctor", "install"} {
		t.Run(sub, func(t *testing.T) {
			var stdout, stderr bytes.Buffer
			d := fakeDeps(&stdout, &stderr)
			d.detectTools = allFoundToolSet

			code := dispatch([]string{sub}, d)
			assert.Equal(t, 0, code, "subcommand %q should exit 0", sub)
			assert.NotEmpty(t, stdout.String(), "subcommand %q should produce output", sub)
		})
	}
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// stringsIndex finds the first occurrence of substr in s.
func stringsIndex(s, substr string) int {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return i
		}
	}
	return -1
}
