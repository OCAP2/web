// Package precompresscli implements `ocap-webserver precompress`, the backfill
// that gives recordings converted before precompression existed the same
// sidecars a fresh conversion writes.
//
// Without it the feature would only ever apply to new uploads: an existing
// library keeps being compressed on every request by whatever sits in front of
// the server, and never benefits from the higher offline compression level.
package precompresscli

import (
	"flag"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/OCAP2/web/internal/server"
	"github.com/OCAP2/web/internal/storage"
)

// Run is the entry point for `ocap-webserver precompress ...`. Returns the
// process exit code.
func Run(args []string) int {
	return run(args, defaultDeps())
}

// deps bundles injectable dependencies for the precompress CLI.
type deps struct {
	loadSettings func() (server.Setting, error)
	stdout       io.Writer
	stderr       io.Writer
}

func defaultDeps() deps {
	return deps{
		loadSettings: server.NewSetting,
		stdout:       os.Stdout,
		stderr:       os.Stderr,
	}
}

// Stats is the tally reported at the end of a run.
type Stats struct {
	Scanned     int
	Written     int
	Skipped     int
	Failed      int
	RawBytes    int64
	BestBytes   int64
	SidecarSeen int64
}

func run(args []string, d deps) int {
	fs := flag.NewFlagSet("precompress", flag.ContinueOnError)
	fs.SetOutput(d.stderr)

	dataDir := fs.String("data", "", "Recording data directory (default: the configured OCAP_DATA)")
	dryRun := fs.Bool("dry-run", false, "Report what would be written without touching the disk")
	force := fs.Bool("force", false, "Rewrite sidecars even when an up-to-date one already exists")
	quiet := fs.Bool("quiet", false, "Only print the summary")

	fs.Usage = func() {
		fmt.Fprintf(d.stderr, "Usage: precompress [options]\n\n")
		fmt.Fprintf(d.stderr, "Writes .zst and .gz sidecars next to every .pb artifact under the data\n")
		fmt.Fprintf(d.stderr, "directory, so recordings converted before precompression existed are served\n")
		fmt.Fprintf(d.stderr, "the same way new ones are. Safe to run against a live server.\n\n")
		fmt.Fprintf(d.stderr, "Options:\n")
		fs.PrintDefaults()
		fmt.Fprintf(d.stderr, "\nExamples:\n")
		fmt.Fprintf(d.stderr, "  precompress --dry-run       Show what is missing\n")
		fmt.Fprintf(d.stderr, "  precompress                 Backfill everything missing\n")
		fmt.Fprintf(d.stderr, "  precompress --force         Rebuild every sidecar\n")
	}

	if err := fs.Parse(args); err != nil {
		return 2
	}

	root := *dataDir
	if root == "" {
		setting, err := d.loadSettings()
		if err != nil {
			fmt.Fprintf(d.stderr, "precompress: load settings: %v\n", err)
			return 1
		}
		root = setting.Data
	}
	if root == "" {
		fmt.Fprintln(d.stderr, "precompress: no data directory configured; pass --data")
		return 1
	}
	if info, err := os.Stat(root); err != nil || !info.IsDir() {
		fmt.Fprintf(d.stderr, "precompress: %s is not a directory\n", root)
		return 1
	}

	stats, err := walk(root, *dryRun, *force, *quiet, d.stdout, d.stderr)
	if err != nil {
		fmt.Fprintf(d.stderr, "precompress: %v\n", err)
		return 1
	}

	printSummary(d.stdout, root, stats, *dryRun)
	if stats.Failed > 0 {
		return 1
	}
	return 0
}

// isArtifact reports whether a path is a protobuf artifact rather than one of
// the sidecars written next to it.
func isArtifact(path string) bool {
	return strings.EqualFold(filepath.Ext(path), ".pb")
}

// needsSidecars reports whether path is missing an up-to-date sidecar for any
// coding. A sidecar older than the artifact is treated as missing, matching the
// staleness rule the server applies when it decides whether to serve one.
func needsSidecars(path string, info os.FileInfo) bool {
	for _, coding := range storage.PrecompressEncodings {
		sidecar, err := os.Stat(path + storage.PrecompressSuffix[coding])
		if err != nil || sidecar.ModTime().Before(info.ModTime()) {
			return true
		}
	}
	return false
}

// sidecarBytes returns the size of the smallest existing sidecar, which is what
// a modern browser would actually download.
func sidecarBytes(path string, fallback int64) int64 {
	best := fallback
	for _, coding := range storage.PrecompressEncodings {
		if info, err := os.Stat(path + storage.PrecompressSuffix[coding]); err == nil {
			if info.Size() < best {
				best = info.Size()
			}
		}
	}
	return best
}

func walk(root string, dryRun, force, quiet bool, stdout, stderr io.Writer) (Stats, error) {
	var stats Stats
	var artifacts []string

	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			fmt.Fprintf(stderr, "  skip %s: %v\n", path, err)
			return nil
		}
		if d.IsDir() || !isArtifact(path) {
			return nil
		}
		artifacts = append(artifacts, path)
		return nil
	})
	if err != nil {
		return stats, fmt.Errorf("walk %s: %w", root, err)
	}

	// Deterministic order keeps a --dry-run diffable against the real run.
	sort.Strings(artifacts)

	for _, path := range artifacts {
		info, err := os.Stat(path)
		if err != nil {
			fmt.Fprintf(stderr, "  skip %s: %v\n", path, err)
			stats.Failed++
			continue
		}
		stats.Scanned++
		stats.RawBytes += info.Size()

		if !force && !needsSidecars(path, info) {
			stats.Skipped++
			stats.BestBytes += sidecarBytes(path, info.Size())
			continue
		}

		rel, relErr := filepath.Rel(root, path)
		if relErr != nil {
			rel = path
		}

		if dryRun {
			stats.Written++
			stats.BestBytes += info.Size() // unknown until written; count raw
			if !quiet {
				fmt.Fprintf(stdout, "  would write sidecars for %s (%s)\n", rel, humanBytes(info.Size()))
			}
			continue
		}

		data, err := os.ReadFile(path)
		if err != nil {
			fmt.Fprintf(stderr, "  read %s: %v\n", rel, err)
			stats.Failed++
			continue
		}
		if err := storage.WriteSidecars(path, data); err != nil {
			fmt.Fprintf(stderr, "  %s: %v\n", rel, err)
			stats.Failed++
			continue
		}

		best := sidecarBytes(path, info.Size())
		stats.Written++
		stats.BestBytes += best
		if !quiet {
			fmt.Fprintf(stdout, "  %s  %s -> %s\n", rel, humanBytes(info.Size()), humanBytes(best))
		}
	}

	return stats, nil
}

func printSummary(w io.Writer, root string, s Stats, dryRun bool) {
	verb := "written"
	if dryRun {
		verb = "would write"
	}
	fmt.Fprintf(w, "\n%s\n", root)
	fmt.Fprintf(w, "  artifacts scanned : %d\n", s.Scanned)
	fmt.Fprintf(w, "  sidecars %-9s: %d\n", verb, s.Written)
	fmt.Fprintf(w, "  already current   : %d\n", s.Skipped)
	if s.Failed > 0 {
		fmt.Fprintf(w, "  failed            : %d\n", s.Failed)
	}
	if !dryRun && s.RawBytes > 0 {
		fmt.Fprintf(w, "  raw total         : %s\n", humanBytes(s.RawBytes))
		fmt.Fprintf(w, "  best-coding total : %s (%.1fx smaller)\n",
			humanBytes(s.BestBytes), float64(s.RawBytes)/float64(max64(s.BestBytes, 1)))
	}
}

func max64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}

func humanBytes(n int64) string {
	const unit = 1024
	if n < unit {
		return fmt.Sprintf("%d B", n)
	}
	div, exp := int64(unit), 0
	for v := n / unit; v >= unit && exp < 3; v /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(n)/float64(div), "KMGT"[exp])
}
