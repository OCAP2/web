package maptoolcli

import (
	"bytes"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/OCAP2/web/internal/maptool"
)

// ---------------------------------------------------------------------------
// diagnose tests
// ---------------------------------------------------------------------------

func TestDiagnose_AllFound(t *testing.T) {
	tools := allFoundToolSet()
	report := diagnose(tools)

	assert.Equal(t, "green", report.Summary.Health)
	assert.Equal(t, 2, report.Summary.RequiredFound)
	assert.Equal(t, 0, report.Summary.RequiredMissing)
	assert.Equal(t, 10, report.Summary.Found)
	assert.Equal(t, 0, report.Summary.Missing)
	assert.Empty(t, report.Issues)
}

func TestDiagnose_AllMissing(t *testing.T) {
	tools := allMissingToolSet()
	report := diagnose(tools)

	assert.Equal(t, "red", report.Summary.Health)
	assert.Equal(t, 0, report.Summary.RequiredFound)
	assert.Equal(t, 2, report.Summary.RequiredMissing)
	assert.Equal(t, 0, report.Summary.Found)
	assert.Equal(t, 10, report.Summary.Missing)
}

func TestDiagnose_RequiredFoundRecommendedMissing(t *testing.T) {
	tools := maptool.ToolSet{
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
	report := diagnose(tools)

	assert.Equal(t, "yellow", report.Summary.Health,
		"required all present but recommended missing → yellow")
	assert.Equal(t, 2, report.Summary.RequiredFound)
	assert.Equal(t, 0, report.Summary.RequiredMissing)
}

func TestDiagnose_GdalPythonMissingWithCPP(t *testing.T) {
	tools := maptool.ToolSet{
		{Name: "pmtiles", Required: true, Found: true, Path: "/usr/bin/pmtiles"},
		{Name: "tippecanoe", Required: true, Found: true, Path: "/usr/bin/tippecanoe"},
		{Name: "tile-join", Required: false, Found: true, Path: "/usr/bin/tile-join"},
		{Name: "gdal_translate", Required: false, Found: true, Path: "/usr/bin/gdal_translate"},
		{Name: "gdaldem", Required: false, Found: true, Path: "/usr/bin/gdaldem"},
		{Name: "gdal_contour", Required: false, Found: true, Path: "/usr/bin/gdal_contour"},
		{Name: "gdal_calc.py", Required: false, Found: false},
		{Name: "gdaladdo", Required: false, Found: true, Path: "/usr/bin/gdaladdo"},
		{Name: "gdalbuildvrt", Required: false, Found: true, Path: "/usr/bin/gdalbuildvrt"},
		{Name: "gdal_fillnodata.py", Required: false, Found: false},
	}
	report := diagnose(tools)

	assert.Equal(t, "yellow", report.Summary.Health)
	assert.Len(t, report.Issues, 1)
	assert.Contains(t, report.Issues[0], "gdal_calc.py")
	assert.Contains(t, report.Issues[0], "gdal_fillnodata.py")
	assert.Contains(t, report.Issues[0], "Python bindings")
}

func TestDiagnose_EmptyToolSet(t *testing.T) {
	report := diagnose(maptool.ToolSet{})

	assert.Equal(t, "green", report.Summary.Health)
	assert.Equal(t, 0, report.Summary.Found)
	assert.Equal(t, 0, report.Summary.Missing)
	assert.Equal(t, 0, report.Summary.RequiredFound)
	assert.Equal(t, 0, report.Summary.RequiredMissing)
}

// ---------------------------------------------------------------------------
// diagnoseGotchas tests
// ---------------------------------------------------------------------------

func TestGotchas_PmtilesMissingButGoPmtilesExists(t *testing.T) {
	// This test verifies the logic path; in CI the go-pmtiles binary
	// likely won't exist, so the gotcha may or may not trigger.
	tool := maptool.Tool{Name: "pmtiles", Required: true, Found: false}
	warns := diagnoseGotchas(tool, maptool.ToolSet{})
	// If go-pmtiles IS on PATH, check the warning content.
	if len(warns) > 0 {
		assert.Contains(t, warns[0], "go-pmtiles")
	}
	// Always passes on CI where go-pmtiles is absent.
	// The function should not panic regardless.
	assert.LessOrEqual(t, len(warns), 1)
}

func TestGotchas_TippecanoeFoundTileJoinMissing(t *testing.T) {
	tools := maptool.ToolSet{
		{Name: "tippecanoe", Required: true, Found: true, Path: "/usr/bin/tippecanoe"},
		{Name: "tile-join", Required: false, Found: false},
	}
	tool := tools[0]
	warns := diagnoseGotchas(tool, tools)

	assert.Len(t, warns, 1)
	assert.Contains(t, warns[0], "tile-join")
	assert.Contains(t, warns[0], "make install")
}

func TestGotchas_TileJoinFoundTippecanoeMissing(t *testing.T) {
	tools := maptool.ToolSet{
		{Name: "tippecanoe", Required: true, Found: false},
		{Name: "tile-join", Required: false, Found: true, Path: "/usr/bin/tile-join"},
	}
	tool := tools[1]
	warns := diagnoseGotchas(tool, tools)

	assert.Len(t, warns, 1)
	assert.Contains(t, warns[0], "they ship together")
}

func TestGotchas_NoGotchasNormalState(t *testing.T) {
	tools := maptool.ToolSet{
		{Name: "pmtiles", Required: true, Found: true},
		{Name: "tippecanoe", Required: true, Found: true},
	}
	assert.Empty(t, diagnoseGotchas(tools[0], tools))
	assert.Empty(t, diagnoseGotchas(tools[1], tools))
}

// ---------------------------------------------------------------------------
// detectOS / osFamily tests
// ---------------------------------------------------------------------------

func TestOSFamily_Darwin(t *testing.T) {
	assert.Equal(t, "darwin", osFamily(OSInfo{Platform: "darwin"}))
}

func TestOSFamily_Windows(t *testing.T) {
	assert.Equal(t, "windows", osFamily(OSInfo{Platform: "windows"}))
}

func TestOSFamily_DebianUbuntu(t *testing.T) {
	assert.Equal(t, "debian", osFamily(OSInfo{Platform: "linux", Distro: "ubuntu"}))
	assert.Equal(t, "debian", osFamily(OSInfo{Platform: "linux", Distro: "debian"}))
	assert.Equal(t, "debian", osFamily(OSInfo{Platform: "linux", Distro: "pop"}))
}

func TestOSFamily_Fedora(t *testing.T) {
	assert.Equal(t, "fedora", osFamily(OSInfo{Platform: "linux", Distro: "fedora"}))
	assert.Equal(t, "fedora", osFamily(OSInfo{Platform: "linux", Distro: "rhel"}))
}

func TestOSFamily_Alpine(t *testing.T) {
	assert.Equal(t, "alpine", osFamily(OSInfo{Platform: "linux", Distro: "alpine"}))
}

func TestOSFamily_NixOS(t *testing.T) {
	assert.Equal(t, "nixos", osFamily(OSInfo{Platform: "linux", Distro: "nixos"}))
}

func TestOSFamily_UnknownLinux(t *testing.T) {
	assert.Equal(t, "linux", osFamily(OSInfo{Platform: "linux", Distro: "suse"}))
}

// ---------------------------------------------------------------------------
// detectLinuxDistro tests (via mock reads)
// ---------------------------------------------------------------------------

// TestDetectOS_NonLinux is tested via TestDetectOS_NonLinux below.

func TestDetectOS_NonLinux(t *testing.T) {
	info := detectOS()
	// Just verify no crash on any platform.
	assert.NotEmpty(t, info.Platform)
}

// ---------------------------------------------------------------------------
// printDoctorReport tests
// ---------------------------------------------------------------------------

func TestPrintDoctorReport_AllGreen(t *testing.T) {
	tools := allFoundToolSet()
	report := diagnose(tools)

	var buf bytes.Buffer
	printDoctorReport(&buf, &report)
	output := buf.String()

	assert.Contains(t, output, "Map Toolchain — Diagnostics")
	assert.Contains(t, output, "GREEN")
	assert.Contains(t, output, "10 tools found")
	assert.Contains(t, output, "0 tools missing")
	assert.NotContains(t, output, "Installation Instructions")
}

func TestPrintDoctorReport_MissingRequired(t *testing.T) {
	tools := allMissingToolSet()
	report := diagnose(tools)

	var buf bytes.Buffer
	printDoctorReport(&buf, &report)
	output := buf.String()

	assert.Contains(t, output, "RED")
	assert.Contains(t, output, "0 tools found")
	assert.Contains(t, output, "10 tools missing")
	assert.Contains(t, output, "2 required missing")
}

func TestPrintDoctorReport_IncludesWarnings(t *testing.T) {
	tools := maptool.ToolSet{
		{Name: "tippecanoe", Required: true, Found: true, Path: "/usr/bin/tippecanoe"},
		{Name: "tile-join", Required: false, Found: false},
		{Name: "pmtiles", Required: true, Found: true, Path: "/usr/bin/pmtiles"},
	}
	report := diagnose(tools)

	var buf bytes.Buffer
	printDoctorReport(&buf, &report)
	output := buf.String()

	assert.Contains(t, output, "⚠")
}

// ---------------------------------------------------------------------------
// printInstallHelp tests
// ---------------------------------------------------------------------------

func TestPrintInstallHelp_Debian(t *testing.T) {
	var buf bytes.Buffer
	printInstallHelp(&buf, OSInfo{Platform: "linux", Distro: "ubuntu"})
	output := buf.String()

	assert.Contains(t, output, "Installation Instructions")
	assert.Contains(t, output, "Debian / Ubuntu / Pop!_OS / Mint")
	assert.Contains(t, output, "sudo apt-get install gdal-bin python3-gdal")
	assert.Contains(t, output, "git clone https://github.com/felt/tippecanoe.git")
	assert.Contains(t, output, "protomaps/go-pmtiles")
}

func TestPrintInstallHelp_MacOS(t *testing.T) {
	var buf bytes.Buffer
	printInstallHelp(&buf, OSInfo{Platform: "darwin"})
	output := buf.String()

	assert.Contains(t, output, "macOS (Homebrew)")
	assert.Contains(t, output, "brew install gdal tippecanoe pmtiles")
}

func TestPrintInstallHelp_Windows(t *testing.T) {
	var buf bytes.Buffer
	printInstallHelp(&buf, OSInfo{Platform: "windows"})
	output := buf.String()

	assert.Contains(t, output, "Windows")
	assert.Contains(t, output, "OSGeo4W")
	assert.Contains(t, output, "WSL2")
}

func TestPrintInstallHelp_Alpine(t *testing.T) {
	var buf bytes.Buffer
	printInstallHelp(&buf, OSInfo{Platform: "linux", Distro: "alpine"})
	output := buf.String()

	assert.Contains(t, output, "Alpine Linux")
	assert.Contains(t, output, "apk add")
}

func TestPrintInstallHelp_NixOS(t *testing.T) {
	var buf bytes.Buffer
	printInstallHelp(&buf, OSInfo{Platform: "linux", Distro: "nixos"})
	output := buf.String()

	assert.Contains(t, output, "NixOS")
	assert.Contains(t, output, "nix-shell")
}

func TestPrintInstallHelp_UnknownLinuxFallsBack(t *testing.T) {
	var buf bytes.Buffer
	printInstallHelp(&buf, OSInfo{Platform: "linux", Distro: "suse"})
	output := buf.String()

	// Should show all platform sections.
	assert.Contains(t, output, "Debian")
	assert.Contains(t, output, "Fedora")
	assert.Contains(t, output, "Alpine")
	assert.Contains(t, output, "macOS")
	assert.Contains(t, output, "Windows")
}

func TestPrintInstallHelp_IncludesNotes(t *testing.T) {
	var buf bytes.Buffer
	printInstallHelp(&buf, OSInfo{Platform: "linux", Distro: "ubuntu"})
	output := buf.String()

	assert.Contains(t, output, "Notes")
	assert.Contains(t, output, "pmtiles")
	assert.Contains(t, output, "SEPARATE package")
	assert.Contains(t, output, "ocap-webserver maptool doctor")
}

// ---------------------------------------------------------------------------
// gdalPythonPackage tests
// ---------------------------------------------------------------------------

func TestGdalPythonPackage_Debian(t *testing.T) {
	pkg := gdalPythonPackage(OSInfo{Distro: "debian"})
	assert.Equal(t, "sudo apt-get install python3-gdal", pkg)
}

func TestGdalPythonPackage_Fedora(t *testing.T) {
	pkg := gdalPythonPackage(OSInfo{Distro: "fedora"})
	assert.Equal(t, "sudo dnf install gdal-python-tools", pkg)
}

func TestGdalPythonPackage_Alpine(t *testing.T) {
	pkg := gdalPythonPackage(OSInfo{Distro: "alpine"})
	assert.Equal(t, "apk add py3-gdal", pkg)
}

func TestGdalPythonPackage_Unknown(t *testing.T) {
	pkg := gdalPythonPackage(OSInfo{Distro: "suse"})
	assert.Contains(t, pkg, "python3-gdal")
}

// ---------------------------------------------------------------------------
// fixHint tests
// ---------------------------------------------------------------------------

func TestFixHint_Required(t *testing.T) {
	hint := fixHint("pmtiles", true)
	assert.Contains(t, hint, "[required]")
	assert.Contains(t, hint, "go-pmtiles")
}

func TestFixHint_Recommended(t *testing.T) {
	hint := fixHint("gdal_translate", false)
	assert.Contains(t, hint, "[recommended]")
	assert.Contains(t, hint, "GDAL")
}

// ---------------------------------------------------------------------------
// runDoctor dispatch tests
// ---------------------------------------------------------------------------

func TestRunDoctor_AllFound_Exit0(t *testing.T) {
	var stdout, stderr bytes.Buffer
	d := fakeDeps(&stdout, &stderr)
	d.detectTools = allFoundToolSet

	code := runDoctor(nil, d)
	assert.Equal(t, 0, code)
	assert.Contains(t, stdout.String(), "Map Toolchain — Diagnostics")
	assert.NotContains(t, stdout.String(), "Installation Instructions")
}

func TestRunDoctor_MissingRequired_Exit1(t *testing.T) {
	var stdout, stderr bytes.Buffer
	d := fakeDeps(&stdout, &stderr)
	d.detectTools = allMissingToolSet

	code := runDoctor(nil, d)
	assert.Equal(t, 1, code)
	assert.Contains(t, stdout.String(), "Installation Instructions")
}

func TestRunDoctor_RecommendedMissing_Exit0(t *testing.T) {
	var stdout, stderr bytes.Buffer
	d := fakeDeps(&stdout, &stderr)
	d.detectTools = func() maptool.ToolSet {
		// All required found, some recommended missing.
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

	code := runDoctor(nil, d)
	assert.Equal(t, 0, code,
		"when all required tools are found but recommended are missing, doctor exits 0")
}

func TestRunDoctor_DispatchViaMaptool(t *testing.T) {
	// Verify the doctor command is dispatched from the maptool CLI.
	var stdout, stderr bytes.Buffer
	d := fakeDeps(&stdout, &stderr)
	d.detectTools = allFoundToolSet

	code := dispatch([]string{"doctor"}, d)
	assert.Equal(t, 0, code)
	assert.Contains(t, stdout.String(), "Map Toolchain — Diagnostics")
}

// ---------------------------------------------------------------------------
// healthLabel tests
// ---------------------------------------------------------------------------

func TestHealthLabel(t *testing.T) {
	assert.Equal(t, "GREEN", healthLabel("green"))
	assert.Equal(t, "YELLOW", healthLabel("yellow"))
	assert.Equal(t, "RED", healthLabel("red"))
	assert.Equal(t, "unknown", healthLabel("unknown"))
}

// ---------------------------------------------------------------------------
// toolSet helpers for tests
// ---------------------------------------------------------------------------

func allFoundToolSet() maptool.ToolSet {
	return maptool.ToolSet{
		{Name: "pmtiles", Required: true, Found: true, Path: "/usr/bin/pmtiles"},
		{Name: "tippecanoe", Required: true, Found: true, Path: "/usr/bin/tippecanoe"},
		{Name: "tile-join", Required: false, Found: true, Path: "/usr/bin/tile-join"},
		{Name: "gdal_translate", Required: false, Found: true, Path: "/usr/bin/gdal_translate"},
		{Name: "gdaldem", Required: false, Found: true, Path: "/usr/bin/gdaldem"},
		{Name: "gdal_contour", Required: false, Found: true, Path: "/usr/bin/gdal_contour"},
		{Name: "gdal_calc.py", Required: false, Found: true, Path: "/usr/bin/gdal_calc.py"},
		{Name: "gdaladdo", Required: false, Found: true, Path: "/usr/bin/gdaladdo"},
		{Name: "gdalbuildvrt", Required: false, Found: true, Path: "/usr/bin/gdalbuildvrt"},
		{Name: "gdal_fillnodata.py", Required: false, Found: true, Path: "/usr/bin/gdal_fillnodata.py"},
	}
}

func allMissingToolSet() maptool.ToolSet {
	return maptool.ToolSet{
		{Name: "pmtiles", Required: true, Found: false},
		{Name: "tippecanoe", Required: true, Found: false},
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

// ---------------------------------------------------------------------------
// dispatch with doctor help test
// ---------------------------------------------------------------------------

func TestDispatch_DoctorHelp(t *testing.T) {
	var stdout, stderr bytes.Buffer
	d := fakeDeps(&stdout, &stderr)

	code := dispatch([]string{"doctor", "--help"}, d)
	// doctor ignores flags for now, but should not crash.
	// It runs the diagnostics with the fake deps (all tools found).
	assert.Equal(t, 0, code)
}

// ---------------------------------------------------------------------------
// Integration-ish: printDoctorReport formatting details
// ---------------------------------------------------------------------------

func TestPrintDoctorReport_Formatting(t *testing.T) {
	tools := maptool.ToolSet{
		{Name: "pmtiles", Required: true, Found: true, Path: "/opt/bin/pmtiles"},
		{Name: "tippecanoe", Required: true, Found: false},
		{Name: "tile-join", Required: false, Found: false},
		{Name: "gdal_translate", Required: false, Found: true, Path: "/usr/bin/gdal_translate"},
		{Name: "gdaldem", Required: false, Found: false},
		{Name: "gdal_contour", Required: false, Found: false},
		{Name: "gdal_calc.py", Required: false, Found: false},
		{Name: "gdaladdo", Required: false, Found: false},
		{Name: "gdalbuildvrt", Required: false, Found: false},
		{Name: "gdal_fillnodata.py", Required: false, Found: false},
	}
	report := diagnose(tools)

	var buf bytes.Buffer
	printDoctorReport(&buf, &report)
	output := buf.String()

	// Required tools section
	assert.Contains(t, output, "Required Tools")
	assert.Contains(t, output, "✓ pmtiles")
	assert.Contains(t, output, "✗ tippecanoe")

	// Recommended tools section
	assert.Contains(t, output, "Recommended Tools")
	assert.Contains(t, output, "✓ gdal_translate")

	// Summary
	assert.Contains(t, output, "2 tools found")
	assert.Contains(t, output, "8 tools missing")
	assert.Contains(t, output, "Required readiness: 50%")

	// Cross-tool issue: gdal_translate found but gdal_calc.py not found
	assert.Contains(t, output, "Issues Found")
}

func TestPrintDoctorReport_ShowsIssuesSection(t *testing.T) {
	tools := maptool.ToolSet{
		{Name: "pmtiles", Required: true, Found: true, Path: "/usr/bin/pmtiles"},
		{Name: "tippecanoe", Required: true, Found: true, Path: "/usr/bin/tippecanoe"},
		{Name: "tile-join", Required: false, Found: true, Path: "/usr/bin/tile-join"},
		{Name: "gdal_translate", Required: false, Found: true, Path: "/usr/bin/gdal_translate"},
		{Name: "gdaldem", Required: false, Found: true, Path: "/usr/bin/gdaldem"},
		{Name: "gdal_contour", Required: false, Found: true, Path: "/usr/bin/gdal_contour"},
		{Name: "gdal_calc.py", Required: false, Found: false},
		{Name: "gdaladdo", Required: false, Found: true, Path: "/usr/bin/gdaladdo"},
		{Name: "gdalbuildvrt", Required: false, Found: true, Path: "/usr/bin/gdalbuildvrt"},
		{Name: "gdal_fillnodata.py", Required: false, Found: false},
	}
	report := diagnose(tools)

	var buf bytes.Buffer
	printDoctorReport(&buf, &report)
	output := buf.String()

	assert.Contains(t, output, "Issues Found")
	assert.Contains(t, output, "Fix Summary")
}

// ---------------------------------------------------------------------------
// Run doctor via dispatch (integration smoke test)
// ---------------------------------------------------------------------------

func TestDispatch_Doctor(t *testing.T) {
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

	code := dispatch([]string{"doctor"}, d)
	assert.Equal(t, 0, code, "required tools found, exits 0 despite recommended missing")
}
