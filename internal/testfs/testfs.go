// Package testfs provides filesystem fixtures that behave the same on every
// supported OS, for tests that need a filesystem operation to fail.
//
// Permission bits are not a portable way to make an operation fail: Windows
// ignores them on directories, and root ignores them on Linux. A regular file
// in place of a directory is not portable either: Linux reports "not a
// directory", while Windows reports "not found".
package testfs

import (
	"path/filepath"
	"testing"
)

// InvalidPath returns a path that every operation rejects with an error that
// is not os.ErrNotExist. A NUL byte is invalid in file names on Linux and
// Windows alike.
func InvalidPath(t testing.TB) string {
	t.Helper()
	return filepath.Join(t.TempDir(), "invalid\x00path")
}
