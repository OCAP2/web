package main

import (
	"bytes"
	"testing"

	"github.com/OCAP2/web/internal/server"
	"github.com/stretchr/testify/assert"
)

// fakeServe returns a serve function that records whether it was called.
// Use the returned closure as the serve argument to runRoot.
func fakeServe(called *bool) func() int {
	return func() int {
		*called = true
		return 0
	}
}

func TestRunRoot_NoArgsStartsServer(t *testing.T) {
	var serveCalled bool
	var stdout, stderr bytes.Buffer
	code := runRoot(nil, &stdout, &stderr, fakeServe(&serveCalled))
	assert.Equal(t, 0, code)
	assert.True(t, serveCalled, "bare invocation must start the server")
	assert.Empty(t, stderr.String())
}

func TestRunRoot_ServeSubcommandStartsServer(t *testing.T) {
	var serveCalled bool
	var stdout, stderr bytes.Buffer
	code := runRoot([]string{"serve"}, &stdout, &stderr, fakeServe(&serveCalled))
	assert.Equal(t, 0, code)
	assert.True(t, serveCalled)
}

func TestRunRoot_HelpFlagPrintsUsage(t *testing.T) {
	for _, arg := range []string{"-h", "--help", "help"} {
		t.Run(arg, func(t *testing.T) {
			var serveCalled bool
			var stdout, stderr bytes.Buffer
			code := runRoot([]string{arg}, &stdout, &stderr, fakeServe(&serveCalled))
			assert.Equal(t, 0, code)
			assert.False(t, serveCalled, "help must not invoke serve")
			assert.Contains(t, stdout.String(), "Usage:")
			assert.Contains(t, stdout.String(), "convert")
			assert.Contains(t, stdout.String(), "maptool")
			assert.Contains(t, stdout.String(), "serve")
		})
	}
}

func TestRunRoot_VersionFlagPrintsVersion(t *testing.T) {
	originalCommit, originalDate := server.BuildCommit, server.BuildDate
	server.BuildCommit, server.BuildDate = "abc1234", "2026-05-12"
	t.Cleanup(func() { server.BuildCommit, server.BuildDate = originalCommit, originalDate })

	for _, arg := range []string{"-v", "--version", "version"} {
		t.Run(arg, func(t *testing.T) {
			var serveCalled bool
			var stdout, stderr bytes.Buffer
			code := runRoot([]string{arg}, &stdout, &stderr, fakeServe(&serveCalled))
			assert.Equal(t, 0, code)
			assert.False(t, serveCalled)
			assert.Contains(t, stdout.String(), "abc1234")
			assert.Contains(t, stdout.String(), "2026-05-12")
		})
	}
}

func TestRunRoot_UnknownCommandReturnsExit2(t *testing.T) {
	var serveCalled bool
	var stdout, stderr bytes.Buffer
	code := runRoot([]string{"nope"}, &stdout, &stderr, fakeServe(&serveCalled))
	assert.Equal(t, 2, code)
	assert.False(t, serveCalled)
	assert.Contains(t, stderr.String(), `unknown command "nope"`)
	assert.Contains(t, stderr.String(), "Usage:")
}

func TestRunRoot_DispatchesSubcommands(t *testing.T) {
	// convert and maptool dispatch to their respective Run functions. We can't
	// trivially fake those without rewiring main, but invoking them with --help
	// is harmless (returns 0 and prints usage to their own writer/stdout).
	for _, sub := range []string{"convert", "maptool"} {
		t.Run(sub, func(t *testing.T) {
			var serveCalled bool
			var stdout, stderr bytes.Buffer
			// Calling with no subcommand args triggers each Run's own usage path.
			// convert prints its usage and returns 0; maptool returns 2 with usage.
			// We only need to verify that serve was NOT called and runRoot didn't crash.
			code := runRoot([]string{sub, "--help"}, &stdout, &stderr, fakeServe(&serveCalled))
			assert.False(t, serveCalled, "subcommand dispatch must not invoke serve")
			assert.Contains(t, []int{0, 2}, code, "subcommand --help should return 0 or 2")
		})
	}
}
