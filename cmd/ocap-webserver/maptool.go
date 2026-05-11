package main

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// maptoolOptions holds parsed CLI flags for `maptool render`.
type maptoolOptions struct {
	Input     string
	Batch     string
	Out       string
	Jobs      int
	LogFormat string
	Force     bool
}

func runMaptool(args []string) error {
	if len(args) == 0 {
		printMaptoolUsage(os.Stderr)
		return errors.New("missing subcommand: expected 'render'")
	}
	switch args[0] {
	case "render":
		return runMaptoolRender(args[1:])
	case "-h", "--help":
		printMaptoolUsage(os.Stdout)
		return nil
	default:
		printMaptoolUsage(os.Stderr)
		return fmt.Errorf("unknown maptool subcommand: %q", args[0])
	}
}

func printMaptoolUsage(w *os.File) {
	fmt.Fprintf(w, "Usage: %s maptool render <input.zip> [flags]\n", os.Args[0])
	fmt.Fprintf(w, "       %s maptool render --batch <dir>  [flags]\n\n", os.Args[0])
	fmt.Fprintf(w, "Flags:\n")
	fmt.Fprintf(w, "  -o, --out <dir>             output directory (default: maps dir from config)\n")
	fmt.Fprintf(w, "      --batch <dir>           render every *.zip in the directory\n")
	fmt.Fprintf(w, "  -j, --jobs <N>              concurrent maps in batch mode (default 1)\n")
	fmt.Fprintf(w, "      --log-format auto|text|json   default: auto (text on TTY, JSON otherwise)\n")
	fmt.Fprintf(w, "      --force                 overwrite an existing <world>/ output directory\n")
}

func parseMaptoolRenderFlags(args []string) (maptoolOptions, error) {
	fs := flag.NewFlagSet("render", flag.ContinueOnError)
	var opts maptoolOptions
	fs.StringVar(&opts.Out, "o", "", "output directory")
	fs.StringVar(&opts.Out, "out", "", "output directory")
	fs.StringVar(&opts.Batch, "batch", "", "directory of *.zip files")
	fs.IntVar(&opts.Jobs, "j", 1, "concurrent maps")
	fs.IntVar(&opts.Jobs, "jobs", 1, "concurrent maps")
	fs.StringVar(&opts.LogFormat, "log-format", "auto", "auto|text|json")
	fs.BoolVar(&opts.Force, "force", false, "overwrite existing output")
	if err := fs.Parse(args); err != nil {
		return opts, err
	}
	rest := fs.Args()

	if opts.Batch != "" && len(rest) > 0 {
		return opts, errors.New("--batch cannot be combined with a positional input")
	}
	if opts.Batch == "" && len(rest) == 0 {
		return opts, errors.New("either provide <input.zip> or --batch <dir>")
	}
	if len(rest) > 1 {
		return opts, errors.New("only one positional input is allowed")
	}
	if len(rest) == 1 {
		opts.Input = rest[0]
	}
	if opts.Jobs < 1 {
		return opts, errors.New("--jobs must be >= 1")
	}
	switch opts.LogFormat {
	case "auto", "text", "json":
	default:
		return opts, fmt.Errorf("--log-format must be auto|text|json, got %q", opts.LogFormat)
	}
	return opts, nil
}

// enumerateInputs returns the absolute paths of all zip files to render, in deterministic order.
func enumerateInputs(opts maptoolOptions) ([]string, error) {
	if opts.Batch != "" {
		entries, err := os.ReadDir(opts.Batch)
		if err != nil {
			return nil, fmt.Errorf("read batch dir: %w", err)
		}
		var inputs []string
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			if !strings.EqualFold(filepath.Ext(e.Name()), ".zip") {
				continue
			}
			inputs = append(inputs, filepath.Join(opts.Batch, e.Name()))
		}
		if len(inputs) == 0 {
			return nil, fmt.Errorf("no .zip files in %s", opts.Batch)
		}
		sort.Strings(inputs)
		return inputs, nil
	}

	if _, err := os.Stat(opts.Input); err != nil {
		return nil, fmt.Errorf("input: %w", err)
	}
	return []string{opts.Input}, nil
}

type targetAction int

const (
	targetDecisionProceed targetAction = iota
	targetDecisionSkip
)

type targetDecision struct {
	Action     targetAction
	FinalDir   string
	PartialDir string
}

// resolveTarget computes output paths and decides whether to render or skip.
// It also removes any stale .partial dir from a previous interrupted run, so the
// render stage starts with a clean slate.
func resolveTarget(outDir, world string, force bool) (targetDecision, error) {
	final := filepath.Join(outDir, world)
	partial := filepath.Join(outDir, "."+world+".partial")

	if _, err := os.Stat(final); err == nil {
		if !force {
			return targetDecision{Action: targetDecisionSkip, FinalDir: final, PartialDir: partial}, nil
		}
	} else if !os.IsNotExist(err) {
		return targetDecision{}, fmt.Errorf("stat final dir: %w", err)
	}

	if err := os.RemoveAll(partial); err != nil {
		return targetDecision{}, fmt.Errorf("clean partial dir: %w", err)
	}
	return targetDecision{Action: targetDecisionProceed, FinalDir: final, PartialDir: partial}, nil
}

func runMaptoolRender(args []string) error {
	_, err := parseMaptoolRenderFlags(args)
	if err != nil {
		printMaptoolUsage(os.Stderr)
		return err
	}
	return errors.New("not implemented")
}
