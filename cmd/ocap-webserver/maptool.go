package main

import (
	"errors"
	"flag"
	"fmt"
	"os"
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

func runMaptoolRender(args []string) error {
	_, err := parseMaptoolRenderFlags(args)
	if err != nil {
		printMaptoolUsage(os.Stderr)
		return err
	}
	return errors.New("not implemented")
}
