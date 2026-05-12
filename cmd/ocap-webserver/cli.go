package main

import (
	"fmt"
	"io"

	"github.com/OCAP2/web/internal/convertcli"
	"github.com/OCAP2/web/internal/maptoolcli"
	"github.com/OCAP2/web/internal/server"
)

// runRoot is the top-level CLI dispatcher. It returns the process exit code.
// Bare invocation (no args) falls through to serve, preserving the historical
// "no args starts the webserver" contract used by Docker images, Pelican egg
// startup commands, and existing operator install scripts.
func runRoot(args []string, stdout, stderr io.Writer, serve func() int) int {
	if len(args) == 0 {
		return serve()
	}
	switch args[0] {
	case "convert":
		return convertcli.Run(args[1:])
	case "maptool":
		return maptoolcli.Run(args[1:])
	case "serve":
		return serve()
	case "-h", "--help", "help":
		printRootUsage(stdout)
		return 0
	case "-v", "--version", "version":
		printVersion(stdout)
		return 0
	default:
		fmt.Fprintf(stderr, "ocap-webserver: unknown command %q\n\n", args[0])
		printRootUsage(stderr)
		return 2
	}
}

func printRootUsage(w io.Writer) {
	fmt.Fprintln(w, "ocap-webserver — OCAP2 web server and tooling")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "Usage:")
	fmt.Fprintln(w, "  ocap-webserver                    Start the web server (default)")
	fmt.Fprintln(w, "  ocap-webserver <command> [flags]  Run a subcommand")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "Commands:")
	fmt.Fprintln(w, "  serve      Start the web server")
	fmt.Fprintln(w, "  convert    Convert mission JSON to protobuf storage")
	fmt.Fprintln(w, "  maptool    Render grad_meh map exports to tile bundles")
	fmt.Fprintln(w, "  help       Show this help")
	fmt.Fprintln(w, "  version    Show build version")
	fmt.Fprintln(w)
	fmt.Fprintln(w, "Run 'ocap-webserver <command> --help' for command-specific options.")
}

func printVersion(w io.Writer) {
	fmt.Fprintf(w, "ocap-webserver %s (built %s)\n", server.BuildCommit, server.BuildDate)
}
