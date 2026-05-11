package maptoolcli

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"syscall"

	"github.com/OCAP2/web/internal/maptool"
	"github.com/OCAP2/web/internal/server"
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

// Run executes the `maptool` CLI subcommand.
func Run(args []string) error {
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
	opts, err := parseMaptoolRenderFlags(args)
	if err != nil {
		printMaptoolUsage(os.Stderr)
		return err
	}

	if opts.Out == "" {
		setting, err := server.NewSetting()
		if err != nil {
			return fmt.Errorf("settings: %w", err)
		}
		opts.Out = setting.Maps
	}

	tools := maptool.DetectTools()
	if err := preflight(tools); err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	code := orchestrate(ctx, opts, realRender(tools), os.Stdout)
	if code != 0 {
		os.Exit(code)
	}
	return nil
}

// orchestrate is the testable core of `maptool render`. It returns the exit code.
func orchestrate(ctx context.Context, opts maptoolOptions, render renderFunc, out io.Writer) int {
	fm := chooseFormatter(opts.LogFormat, out)

	inputs, err := enumerateInputs(opts)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 2
	}

	if err := os.MkdirAll(opts.Out, 0755); err != nil {
		fmt.Fprintln(os.Stderr, "error: create out dir:", err)
		return 2
	}

	type result struct {
		input   string
		world   string
		err     error
		skipped string
	}

	sem := make(chan struct{}, opts.Jobs)
	results := make(chan result, len(inputs))
	var wg sync.WaitGroup

	for _, in := range inputs {
		in := in
		wg.Add(1)
		sem <- struct{}{}
		go func() {
			defer wg.Done()
			defer func() { <-sem }()

			world, decision, err := resolveForInput(in, opts)
			if err != nil {
				results <- result{input: in, err: err}
				return
			}
			if decision.Action == targetDecisionSkip {
				results <- result{input: in, world: world, skipped: "already exists; use --force to re-render"}
				fm.MapSkipped(world, "already exists")
				return
			}
			fm.MapStart(world, in)
			renderedWorld, rerr := render(ctx, in, decision.PartialDir, fm)
			if rerr != nil {
				fm.MapFailed(world, in, rerr)
				results <- result{input: in, world: world, err: rerr}
				return
			}
			// The renderer reads meta.json and reports the real world name.
			// The filename-guessed dir name may differ — recompute the final
			// path to match the real world, and re-check for skip-on-collision.
			finalDir := decision.FinalDir
			if renderedWorld != "" && renderedWorld != world {
				world = renderedWorld
				finalDir = filepath.Join(opts.Out, world)
				if _, err := os.Stat(finalDir); err == nil && !opts.Force {
					_ = os.RemoveAll(decision.PartialDir)
					fm.MapSkipped(world, "already exists (renamed from input filename)")
					results <- result{input: in, world: world, skipped: "already exists"}
					return
				}
			}
			if err := publishPartial(decision.PartialDir, finalDir); err != nil {
				fm.MapFailed(world, in, err)
				results <- result{input: in, world: world, err: err}
				return
			}
			fm.MapDone(world, finalDir)
			results <- result{input: in, world: world}
		}()
	}
	wg.Wait()
	close(results)

	s := summary{Failed: map[string]string{}}
	for r := range results {
		switch {
		case r.err != nil:
			name := r.world
			if name == "" {
				name = filepath.Base(r.input)
			}
			s.Failed[name] = r.err.Error()
		case r.skipped != "":
			s.Skipped = append(s.Skipped, r.world)
		default:
			s.OK = append(s.OK, r.world)
		}
	}
	fm.Summary(s)

	if len(s.Failed) > 0 {
		return 1
	}
	return 0
}

// resolveForInput maps an input zip path to (worldGuess, decision).
// The world is later replaced by the real meta.WorldName inside orchestrate.
func resolveForInput(inputZip string, opts maptoolOptions) (string, targetDecision, error) {
	world := strings.ToLower(strings.TrimSuffix(filepath.Base(inputZip), filepath.Ext(inputZip)))
	if world == "" {
		return "", targetDecision{}, fmt.Errorf("cannot derive world name from %q", inputZip)
	}
	d, err := resolveTarget(opts.Out, world, opts.Force)
	return world, d, err
}
