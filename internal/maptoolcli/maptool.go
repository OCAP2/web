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

// renderOptions holds parsed CLI flags for `maptool render`.
type renderOptions struct {
	Input     string
	Batch     string
	Out       string
	Jobs      int
	LogFormat string
	Force     bool
}

// deps bundles injectable dependencies for the maptool CLI.
type deps struct {
	loadSettings   func() (server.Setting, error)
	detectTools    func() maptool.ToolSet
	installSignals func(context.Context) (context.Context, context.CancelFunc)
	render         func(maptool.ToolSet) renderFunc
	stdout, stderr io.Writer
}

func defaultDeps() deps {
	return deps{
		loadSettings: server.NewSetting,
		detectTools:  maptool.DetectTools,
		installSignals: func(ctx context.Context) (context.Context, context.CancelFunc) {
			return signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)
		},
		render: realRender,
		stdout: os.Stdout,
		stderr: os.Stderr,
	}
}

// Run is the entry point for `ocap-webserver maptool ...`. Returns the process exit code.
func Run(args []string) int {
	return dispatch(args, defaultDeps())
}

func dispatch(args []string, d deps) int {
	if len(args) == 0 {
		printUsage(d.stderr)
		fmt.Fprintln(d.stderr, "error: missing subcommand: expected 'render'")
		return 2
	}
	switch args[0] {
	case "render":
		return runRender(args[1:], d)
	case "-h", "--help":
		printUsage(d.stdout)
		return 0
	default:
		printUsage(d.stderr)
		fmt.Fprintf(d.stderr, "error: unknown maptool subcommand: %q\n", args[0])
		return 2
	}
}

func printUsage(w io.Writer) {
	fmt.Fprintf(w, "Usage: %s maptool render <input.zip> [flags]\n", os.Args[0])
	fmt.Fprintf(w, "       %s maptool render --batch <dir>  [flags]\n\n", os.Args[0])
	fmt.Fprintf(w, "Flags:\n")
	fmt.Fprintf(w, "  -o, --out <dir>             output directory (default: maps dir from config)\n")
	fmt.Fprintf(w, "      --batch <dir>           render every *.zip in the directory\n")
	fmt.Fprintf(w, "  -j, --jobs <N>              concurrent maps in batch mode (default 1)\n")
	fmt.Fprintf(w, "      --log-format auto|text|json   default: auto (text on TTY, JSON otherwise)\n")
	fmt.Fprintf(w, "      --force                 overwrite an existing <world>/ output directory\n")
}

func parseRenderFlags(args []string) (renderOptions, error) {
	fs := flag.NewFlagSet("render", flag.ContinueOnError)
	var opts renderOptions
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
func enumerateInputs(opts renderOptions) ([]string, error) {
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

func runRender(args []string, d deps) int {
	opts, err := parseRenderFlags(args)
	if err != nil {
		printUsage(d.stderr)
		fmt.Fprintln(d.stderr, "error:", err)
		return 2
	}

	if opts.Out == "" {
		setting, err := d.loadSettings()
		if err != nil {
			fmt.Fprintln(d.stderr, "error: settings:", err)
			return 2
		}
		opts.Out = setting.Maps
	}

	tools := d.detectTools()
	if err := preflight(tools); err != nil {
		fmt.Fprintln(d.stderr, err)
		return 2
	}

	ctx, stop := d.installSignals(context.Background())
	defer stop()

	return orchestrate(ctx, opts, d.render(tools), d.stdout)
}

// errSkippedExists signals a final dir already exists and --force was not set.
var errSkippedExists = errors.New("already exists")

// worldClaim serializes publish operations on output worlds and rejects
// duplicate worlds within the same run (two inputs producing the same world name).
type worldClaim struct {
	mu   sync.Mutex
	seen map[string]bool
}

func newWorldClaim() *worldClaim { return &worldClaim{seen: map[string]bool{}} }

// publish runs the publish callback under a mutex, after asserting:
//   - this world hasn't already been published in this run
//   - the final dir doesn't exist (or --force is set)
//
// Returns errSkippedExists if the final dir is present and force is false.
func (c *worldClaim) publish(world, finalDir string, force bool, publishFn func() error) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.seen[world] {
		return fmt.Errorf("world %q was already produced from another input in this run", world)
	}
	if _, err := os.Stat(finalDir); err == nil {
		if !force {
			return errSkippedExists
		}
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("stat final dir: %w", err)
	}
	if err := publishFn(); err != nil {
		return err
	}
	c.seen[world] = true
	return nil
}

// orchestrate is the testable core of `maptool render`. It returns the exit code.
func orchestrate(ctx context.Context, opts renderOptions, render renderFunc, out io.Writer) int {
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
	claims := newWorldClaim()
	var wg sync.WaitGroup

	for idx, in := range inputs {
		idx, in := idx, in
		wg.Add(1)
		sem <- struct{}{}
		go func() {
			defer wg.Done()
			defer func() { <-sem }()

			guess := worldGuess(in)
			if guess == "" {
				results <- result{input: in, err: fmt.Errorf("cannot derive world name from %q", in)}
				return
			}

			// Best-effort pre-render skip check on the filename guess.
			// The post-render claim is the authoritative check that prevents races.
			finalGuess := filepath.Join(opts.Out, guess)
			if _, statErr := os.Stat(finalGuess); statErr == nil && !opts.Force {
				fm.MapSkipped(guess, "already exists")
				results <- result{input: in, world: guess, skipped: "already exists"}
				return
			}

			// Unique partial dir per input: two inputs that resolve to the same
			// guess (e.g. Altis.zip + altis.zip on a case-sensitive FS) get
			// distinct working dirs and cannot clobber each other.
			partial := filepath.Join(opts.Out, fmt.Sprintf(".%s.partial-%d", guess, idx))
			if err := os.RemoveAll(partial); err != nil {
				results <- result{input: in, world: guess, err: fmt.Errorf("clean partial dir: %w", err)}
				return
			}

			fm.MapStart(guess, in)
			renderedWorld, rerr := render(ctx, in, partial, fm)
			if rerr != nil {
				_ = os.RemoveAll(partial)
				fm.MapFailed(guess, in, rerr)
				results <- result{input: in, world: guess, err: rerr}
				return
			}
			world := renderedWorld
			if world == "" {
				world = guess
			}

			finalDir := filepath.Join(opts.Out, world)
			err := claims.publish(world, finalDir, opts.Force, func() error {
				return publishPartial(partial, finalDir)
			})
			if err != nil {
				_ = os.RemoveAll(partial)
				if errors.Is(err, errSkippedExists) {
					fm.MapSkipped(world, "already exists")
					results <- result{input: in, world: world, skipped: "already exists"}
					return
				}
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

// worldGuess derives a provisional world name from the input zip's basename.
// The real world name is read from grad_meh meta.json by the renderer and
// becomes authoritative for the final output directory.
func worldGuess(inputZip string) string {
	return strings.ToLower(strings.TrimSuffix(filepath.Base(inputZip), filepath.Ext(inputZip)))
}
