package maptoolcli

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"os/exec"
	"runtime"
	"strings"

	"github.com/OCAP2/web/internal/maptool"
)

// ToolReport holds diagnostic information for one external tool.
type ToolReport struct {
	Name     string   `json:"name"`
	Required bool     `json:"required"`
	Found    bool     `json:"found"`
	Path     string   `json:"path,omitempty"`
	Version  string   `json:"version,omitempty"`
	Warnings []string `json:"warnings,omitempty"`
	FixHint  string   `json:"fix_hint,omitempty"`
}

// DoctorReport is the full diagnostic report.
type DoctorReport struct {
	Tools   []ToolReport `json:"tools"`
	Issues  []string     `json:"issues"`
	OS      OSInfo       `json:"os"`
	Summary HealthSummary `json:"summary"`
}

// HealthSummary aggregates findings.
type HealthSummary struct {
	Found           int    `json:"found"`
	Missing         int    `json:"missing"`
	RequiredFound   int    `json:"required_found"`
	RequiredMissing int    `json:"required_missing"`
	Health          string `json:"health"` // "green", "yellow", "red"
}

// OSInfo describes the detected operating system.
type OSInfo struct {
	Platform string `json:"platform"`        // "linux", "darwin", "windows"
	Distro   string `json:"distro,omitempty"` // "debian", "ubuntu", "fedora", "alpine", "nixos", etc.
	Pretty   string `json:"pretty,omitempty"` // "Ubuntu 24.04 LTS"
}

// doctorOptions controls doctor behaviour (injectable for testing).
type doctorOptions struct {
	stdout io.Writer
	stderr io.Writer
}

// runDoctor runs the full diagnostic and prints a report. Returns the exit code.
func runDoctor(args []string, d deps) int {
	_ = args // doctor takes no flags currently; kept for interface consistency.

	tools := d.detectTools()
	report := diagnose(tools)
	printDoctorReport(d.stdout, &report)

	if report.Summary.RequiredMissing > 0 {
		printInstallHelp(d.stdout, report.OS)
		return 1
	}
	return 0
}

// diagnose builds a DoctorReport from a ToolSet.
func diagnose(tools maptool.ToolSet) DoctorReport {
	var reports []ToolReport
	var issues []string
	var found, missing, reqFound, reqMissing int

	for _, t := range tools {
		r := ToolReport{
			Name:     t.Name,
			Required: t.Required,
			Found:    t.Found,
			Path:     t.Path,
		}

		if t.Found {
			found++
			if t.Required {
				reqFound++
			}
			r.Version = probeVersion(t.Name, t.Path)
		} else {
			missing++
			if t.Required {
				reqMissing++
			}
		}

		// Detect known gotchas.
		r.Warnings = append(r.Warnings, diagnoseGotchas(t, tools)...)
		r.FixHint = fixHint(t.Name, t.Required)

		reports = append(reports, r)
	}

	// Cross-tool gotchas: gdal Python scripts missing while C++ tools present.
	issues = append(issues, diagnoseCrossToolIssues(tools)...)

	health := "green"
	if reqMissing > 0 {
		health = "red"
	} else if missing > 0 {
		health = "yellow"
	}

	return DoctorReport{
		Tools:  reports,
		Issues: issues,
		OS:     detectOS(),
		Summary: HealthSummary{
			Found:           found,
			Missing:         missing,
			RequiredFound:   reqFound,
			RequiredMissing: reqMissing,
			Health:          health,
		},
	}
}

// probeVersion tries to get the version of an installed tool.
func probeVersion(name, path string) string {
	// Known flag patterns for each tool.
	var args []string
	switch name {
	case "pmtiles":
		args = []string{"--version"}
	case "tippecanoe", "tile-join":
		args = []string{"--version"}
	case "gdal_translate", "gdaldem", "gdal_contour", "gdaladdo", "gdalbuildvrt":
		args = []string{"--version"}
	default:
		return ""
	}

	cmd := exec.Command(path, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return ""
	}
	// Typically the first line contains the version.
	line := stdout.String()
	if line == "" {
		line = stderr.String()
	}
	line = strings.TrimSpace(line)
	if idx := strings.Index(line, "\n"); idx >= 0 {
		line = line[:idx]
	}
	return line
}

// diagnoseGotchas returns warnings specific to a single tool.
func diagnoseGotchas(t maptool.Tool, all maptool.ToolSet) []string {
	var warns []string

	// pmtiles: binary named "go-pmtiles" instead of "pmtiles".
	if t.Name == "pmtiles" && !t.Found {
		if _, err := exec.LookPath("go-pmtiles"); err == nil {
			warns = append(warns, "binary found as 'go-pmtiles' instead of 'pmtiles' — create a symlink: ln -s $(which go-pmtiles) /usr/local/bin/pmtiles")
		}
	}

	// tippecanoe and tile-join are siblings.
	// Use lookupInSet instead of FindTool: FindTool's bool return is t.Found,
	// but we need to check if a tool is registered in the set regardless of
	// whether it was found on PATH.
	tileJoin := lookupInSet("tile-join", all)
	tippecanoe := lookupInSet("tippecanoe", all)

	if t.Name == "tippecanoe" && t.Found && tileJoin != nil && !tileJoin.Found {
		warns = append(warns, "tippecanoe found but tile-join missing — re-run 'make install' from the tippecanoe source")
	}
	if t.Name == "tile-join" && t.Found && tippecanoe != nil && !tippecanoe.Found {
		warns = append(warns, "tile-join found but tippecanoe not on PATH — they ship together")
	}

	return warns
}

// lookupInSet finds a tool by name in the set, returning nil if not present.
func lookupInSet(name string, tools maptool.ToolSet) *maptool.Tool {
	for i := range tools {
		if tools[i].Name == name {
			return &tools[i]
		}
	}
	return nil
}

// diagnoseCrossToolIssues detects issues that span multiple tools.
func diagnoseCrossToolIssues(tools maptool.ToolSet) []string {
	var issues []string

	// GDAL Python scripts missing while GDAL C++ tools present.
	hasCPP := false
	hasPyCalc := false
	hasPyFill := false
	for _, t := range tools {
		switch t.Name {
		case "gdal_translate", "gdaldem", "gdal_contour", "gdaladdo", "gdalbuildvrt":
			if t.Found {
				hasCPP = true
			}
		case "gdal_calc.py":
			hasPyCalc = t.Found
		case "gdal_fillnodata.py":
			hasPyFill = t.Found
		}
	}

	if hasCPP && (!hasPyCalc || !hasPyFill) {
		missing := []string{}
		if !hasPyCalc {
			missing = append(missing, "gdal_calc.py")
		}
		if !hasPyFill {
			missing = append(missing, "gdal_fillnodata.py")
		}
		distro := detectOS()
		pkg := gdalPythonPackage(distro)
		issues = append(issues, fmt.Sprintf(
			"%s are missing although GDAL C++ tools are installed.\n"+
				"  → GDAL Python bindings are required for these scripts.\n"+
				"  → Install the separate package: %s",
			strings.Join(missing, " and "), pkg))
	}

	return issues
}

// fixHint returns a brief fix hint for a missing tool.
func fixHint(name string, required bool) string {
	prefix := "recommended"
	if required {
		prefix = "required"
	}
	switch name {
	case "pmtiles":
		return fmt.Sprintf("[%s] Install go-pmtiles: download from https://github.com/protomaps/go-pmtiles/releases, or run 'brew install pmtiles' (macOS)", prefix)
	case "tippecanoe":
		return fmt.Sprintf("[%s] Build from source: git clone https://github.com/felt/tippecanoe.git && cd tippecanoe && make && sudo make install", prefix)
	case "tile-join":
		return fmt.Sprintf("[%s] Ships with tippecanoe — re-run 'sudo make install' in the tippecanoe source directory", prefix)
	case "gdal_translate", "gdaldem", "gdal_contour", "gdaladdo", "gdalbuildvrt":
		return fmt.Sprintf("[%s] Install GDAL tools via your package manager (see install instructions below)", prefix)
	case "gdal_calc.py", "gdal_fillnodata.py":
		return fmt.Sprintf("[%s] Install GDAL Python bindings (separate package, see install instructions below)", prefix)
	default:
		return ""
	}
}

// gdalPythonPackage returns the distro-specific package name for GDAL Python bindings.
func gdalPythonPackage(os OSInfo) string {
	switch os.Distro {
	case "debian", "ubuntu", "pop", "mint", "kali":
		return "sudo apt-get install python3-gdal"
	case "fedora", "rhel", "centos", "rocky", "alma":
		return "sudo dnf install gdal-python-tools"
	case "alpine":
		return "apk add py3-gdal"
	default:
		return "install the GDAL Python bindings package for your distribution (e.g. python3-gdal on Debian, gdal-python-tools on Fedora, py3-gdal on Alpine)"
	}
}

// detectOS detects the current platform and Linux distribution.
func detectOS() OSInfo {
	info := OSInfo{Platform: runtime.GOOS}
	switch runtime.GOOS {
	case "darwin":
		info.Pretty = "macOS"
	case "windows":
		info.Pretty = "Windows"
	case "linux":
		info.Distro, info.Pretty = detectLinuxDistro()
	default:
		info.Pretty = runtime.GOOS
	}
	return info
}

// detectLinuxDistro reads /etc/os-release to determine the distribution.
func detectLinuxDistro() (string, string) {
	data, err := os.ReadFile("/etc/os-release")
	if err != nil {
		return "", "Linux"
	}
	id := ""
	pretty := ""
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "ID=") {
			id = strings.Trim(strings.TrimPrefix(line, "ID="), "\"'")
		} else if strings.HasPrefix(line, "PRETTY_NAME=") {
			pretty = strings.Trim(strings.TrimPrefix(line, "PRETTY_NAME="), "\"'")
		} else if strings.HasPrefix(line, "ID_LIKE=") {
			// Use ID_LIKE if ID is empty, preferring the first entry.
			if id == "" {
				id = strings.Split(strings.Trim(strings.TrimPrefix(line, "ID_LIKE="), "\"'"), " ")[0]
			}
		}
	}
	return id, pretty
}

// osFamily returns a short, stable tag for selecting install instructions.
func osFamily(info OSInfo) string {
	switch info.Platform {
	case "darwin":
		return "darwin"
	case "windows":
		return "windows"
	case "linux":
		switch info.Distro {
		case "ubuntu", "debian", "pop", "mint", "kali", "elementary", "zorin":
			return "debian"
		case "fedora", "rhel", "centos", "rocky", "alma":
			return "fedora"
		case "alpine":
			return "alpine"
		case "nixos":
			return "nixos"
		default:
			return "linux"
		}
	default:
		return "other"
	}
}

// printDoctorReport formats and writes the diagnostic report.
func printDoctorReport(w io.Writer, r *DoctorReport) {
	// Header
	fmt.Fprintln(w, "Map Toolchain — Diagnostics")
	fmt.Fprintln(w, "════════════════════════════")
	fmt.Fprintln(w)

	// OS Info
	osLine := r.OS.Platform
	if r.OS.Pretty != "" {
		osLine = r.OS.Pretty
	}
	fmt.Fprintf(w, "Platform: %s\n", osLine)
	if r.OS.Distro != "" && r.OS.Platform == "linux" {
		fmt.Fprintf(w, "Distro:   %s\n", r.OS.Distro)
	}
	fmt.Fprintln(w)

	// Tool table: split into required and recommended groups.
	var required, recommended []ToolReport
	for _, t := range r.Tools {
		if t.Required {
			required = append(required, t)
		} else {
			recommended = append(recommended, t)
		}
	}

	if len(required) > 0 {
		fmt.Fprintln(w, "Required Tools")
		fmt.Fprintln(w, "──────────────")
		for _, t := range required {
			printToolLine(w, t)
		}
		fmt.Fprintln(w)
	}

	fmt.Fprintln(w, "Recommended Tools")
	fmt.Fprintln(w, "─────────────────")
	for _, t := range recommended {
		printToolLine(w, t)
	}
	fmt.Fprintln(w)

	// Issues section
	if len(r.Issues) > 0 || hasWarnings(r.Tools) {
		fmt.Fprintln(w, "Issues Found")
		fmt.Fprintln(w, "════════════")
		for _, iss := range r.Issues {
			fmt.Fprintln(w, " •", iss)
			fmt.Fprintln(w)
		}
		for _, t := range r.Tools {
			for _, warn := range t.Warnings {
				fmt.Fprintln(w, " •", t.Name+":", warn)
				fmt.Fprintln(w)
			}
		}
		// Print fix hints for missing tools inline with their status lines.
		fmt.Fprintln(w, "Fix Summary")
		fmt.Fprintln(w, "───────────")
		for _, t := range r.Tools {
			if !t.Found && t.FixHint != "" {
				fmt.Fprintln(w, " •", t.FixHint)
			}
		}
		fmt.Fprintln(w)
	}

	// Health summary
	fmt.Fprintln(w, "Summary")
	fmt.Fprintln(w, "═══════")
	fmt.Fprintf(w, "  %2d tools found\n", r.Summary.Found)
	fmt.Fprintf(w, "  %2d tools missing\n", r.Summary.Missing)
	fmt.Fprintf(w, "  %2d required found, %d required missing\n",
		r.Summary.RequiredFound, r.Summary.RequiredMissing)
	if r.Summary.RequiredFound+r.Summary.RequiredMissing > 0 {
		pct := r.Summary.RequiredFound * 100 / (r.Summary.RequiredFound + r.Summary.RequiredMissing)
		fmt.Fprintf(w, "  Required readiness: %d%% (%s)\n", pct, healthLabel(r.Summary.Health))
	}
	fmt.Fprintln(w)
}

func printToolLine(w io.Writer, t ToolReport) {
	mark := "✓"
	if !t.Found {
		mark = "✗"
	}
	path := "not found"
	if t.Found {
		path = t.Path
	}
	req := ""
	if t.Required {
		req = " (required)"
	}
	ver := ""
	if t.Version != "" {
		ver = "  " + t.Version
	}
	fmt.Fprintf(w, " %s %-20s %s%s%s\n", mark, t.Name, path, ver, req)

	// Print warning badges on indented lines.
	for _, warn := range t.Warnings {
		fmt.Fprintf(w, "   ⚠ %s\n", warn)
	}
}

func hasWarnings(tools []ToolReport) bool {
	for _, t := range tools {
		if len(t.Warnings) > 0 {
			return true
		}
	}
	return false
}

func healthLabel(health string) string {
	switch health {
	case "green":
		return "GREEN"
	case "yellow":
		return "YELLOW"
	case "red":
		return "RED"
	default:
		return health
	}
}

// printInstallHelp writes platform-specific installation instructions.
func printInstallHelp(w io.Writer, osInfo OSInfo) {
	family := osFamily(osInfo)

	fmt.Fprintln(w, "Installation Instructions")
	fmt.Fprintln(w, "═════════════════════════")
	fmt.Fprintln(w)

	switch family {
	case "debian":
		printDebianInstall(w)
	case "fedora":
		printFedoraInstall(w)
	case "alpine":
		printAlpineInstall(w)
	case "darwin":
		printMacOSInstall(w)
	case "windows":
		printWindowsInstall(w)
	case "nixos":
		printNixOSInstall(w)
	default:
		// Fallback: print all.
		printDebianInstall(w)
		fmt.Fprintln(w)
		printFedoraInstall(w)
		fmt.Fprintln(w)
		printAlpineInstall(w)
		fmt.Fprintln(w)
		printMacOSInstall(w)
		fmt.Fprintln(w)
		printWindowsInstall(w)
		fmt.Fprintln(w)
		printNixOSInstall(w)
		fmt.Fprintln(w)
		printCondaInstall(w)
	}
	fmt.Fprintln(w)

	printPerToolNotes(w)
}

func printDebianInstall(w io.Writer) {
	fmt.Fprintln(w, "Debian / Ubuntu / Pop!_OS / Mint")
	fmt.Fprintln(w, "─────────────────────────────────")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "# 1. GDAL (command-line tools + Python bindings)")
	fmt.Fprintln(w, "sudo apt-get update")
	fmt.Fprintln(w, "sudo apt-get install gdal-bin python3-gdal")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "# 2. tippecanoe — build from source (needs C++17 compiler)")
	fmt.Fprintln(w, "sudo apt-get install build-essential libsqlite3-dev zlib1g-dev git")
	fmt.Fprintln(w, "git clone https://github.com/felt/tippecanoe.git")
	fmt.Fprintln(w, "cd tippecanoe")
	fmt.Fprintln(w, `make -j"$(nproc)"`)
	fmt.Fprintln(w, "sudo make install")
	fmt.Fprintln(w, "cd .. && rm -rf tippecanoe")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "# 3. pmtiles — download the release binary")
	fmt.Fprintln(w, "#    Find the latest version at:")
	fmt.Fprintln(w, "#    https://github.com/protomaps/go-pmtiles/releases")
	fmt.Fprintln(w, `curl -L -o pmtiles.tar.gz \`)
	fmt.Fprintln(w, "  https://github.com/protomaps/go-pmtiles/releases/download/v1.30.0/go-pmtiles_1.30.0_Linux_x86_64.tar.gz")
	fmt.Fprintln(w, "tar -xzf pmtiles.tar.gz pmtiles")
	fmt.Fprintln(w, "sudo install pmtiles /usr/local/bin/pmtiles")
	fmt.Fprintln(w, "rm pmtiles pmtiles.tar.gz")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "For ARM64, replace x86_64 with arm64 in the URL above.")
}

func printFedoraInstall(w io.Writer) {
	fmt.Fprintln(w, "Fedora / RHEL / Rocky / Alma")
	fmt.Fprintln(w, "────────────────────────────")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "# 1. GDAL (tools + Python tools)")
	fmt.Fprintln(w, "sudo dnf install gdal gdal-python-tools")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "# 2. tippecanoe — build from source")
	fmt.Fprintln(w, "sudo dnf install gcc-c++ make sqlite-devel zlib-devel git")
	fmt.Fprintln(w, "git clone https://github.com/felt/tippecanoe.git")
	fmt.Fprintln(w, `cd tippecanoe && make -j"$(nproc)" && sudo make install`)
	fmt.Fprintln(w, "cd .. && rm -rf tippecanoe")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "# 3. pmtiles — see Debian/Ubuntu step 3 (same Linux release binary)")
}

func printAlpineInstall(w io.Writer) {
	fmt.Fprintln(w, "Alpine Linux")
	fmt.Fprintln(w, "────────────")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "# 1. GDAL (tools + drivers + Python bindings)")
	fmt.Fprintln(w, "apk add --no-cache gdal-tools gdal-driver-jpeg gdal-driver-png py3-gdal sqlite-libs zlib")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "# 2. tippecanoe — build from source")
	fmt.Fprintln(w, "apk add --no-cache --virtual .build-deps build-base bash git sqlite-dev zlib-dev")
	fmt.Fprintln(w, "git clone https://github.com/felt/tippecanoe.git")
	fmt.Fprintln(w, "cd tippecanoe && make -j\"$(nproc)\" && make install")
	fmt.Fprintln(w, "cd .. && rm -rf tippecanoe")
	fmt.Fprintln(w, "apk del .build-deps")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "# 3. pmtiles — download the musl/Linux release binary")
	fmt.Fprintln(w, "#    from https://github.com/protomaps/go-pmtiles/releases")
}

func printMacOSInstall(w io.Writer) {
	fmt.Fprintln(w, "macOS (Homebrew)")
	fmt.Fprintln(w, "────────────────")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "# All three are available via Homebrew:")
	fmt.Fprintln(w, "brew install gdal tippecanoe pmtiles")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "This installs go-pmtiles with the binary correctly named 'pmtiles'.")
}

func printWindowsInstall(w io.Writer) {
	fmt.Fprintln(w, "Windows")
	fmt.Fprintln(w, "───────")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "# 1. GDAL — install via OSGeo4W (https://trac.osgeo.org/osgeo4w/)")
	fmt.Fprintln(w, "#    or via conda (see cross-platform section below)")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "# 2. tippecanoe — no native Windows build.")
	fmt.Fprintln(w, "#    Options:")
	fmt.Fprintln(w, "#    • WSL2 (recommended): run OCAP inside WSL and follow the")
	fmt.Fprintln(w, "#      Debian/Ubuntu instructions")
	fmt.Fprintln(w, "#    • conda: see cross-platform instructions below")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "# 3. pmtiles — download the Windows release:")
	fmt.Fprintln(w, "#    https://github.com/protomaps/go-pmtiles/releases")
	fmt.Fprintln(w, "#    Extract pmtiles.exe and place it on your PATH")
}

func printNixOSInstall(w io.Writer) {
	fmt.Fprintln(w, "NixOS")
	fmt.Fprintln(w, "─────")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "# Add to environment.systemPackages:")
	fmt.Fprintln(w, "#   pkgs.gdal")
	fmt.Fprintln(w, "#   pkgs.tippecanoe")
	fmt.Fprintln(w, "#   pkgs.pmtiles")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "# Or enter a shell:")
	fmt.Fprintln(w, "nix-shell -p gdal tippecanoe pmtiles")
}

func printCondaInstall(w io.Writer) {
	fmt.Fprintln(w, "Cross-platform: conda / micromamba")
	fmt.Fprintln(w, "───────────────────────────────────")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "# Works on Linux and macOS (tippecanoe not available for Windows via conda)")
	fmt.Fprintln(w, "conda install -c conda-forge gdal tippecanoe pmtiles")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "The gdal conda package bundles the Python utility scripts.")
}

func printPerToolNotes(w io.Writer) {
	fmt.Fprintln(w, "Notes")
	fmt.Fprintln(w, "─────")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "• pmtiles: The pipeline needs a binary named exactly 'pmtiles'.")
	fmt.Fprintln(w, "  'go install' produces 'go-pmtiles' — symlink it if needed.")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "• tippecanoe 'make install' gives you both 'tippecanoe' and 'tile-join'.")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "• GDAL Python scripts (gdal_calc.py, gdal_fillnodata.py) are in a")
	fmt.Fprintln(w, "  SEPARATE package on most distros (python3-gdal, gdal-python-tools, py3-gdal).")
	fmt.Fprintln(w, "  Without them you lose hillshade, color-relief, and contour layers.")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "• After installing, restart the server so it re-detects the toolchain.")
	fmt.Fprintln(w, "  Or run 'ocap-webserver maptool doctor' to verify.")
}
