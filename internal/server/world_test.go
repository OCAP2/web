package server

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestScanWorlds(t *testing.T) {
	dir := t.TempDir()

	// World with meta.json displayName (priority 1)
	require.NoError(t, os.Mkdir(filepath.Join(dir, "juju_javory"), 0755))
	require.NoError(t, os.WriteFile(
		filepath.Join(dir, "juju_javory", "meta.json"),
		[]byte(`{"displayName":"Garmanda","worldSize":5120}`), 0644))

	// World with map.json displayName only (priority 2)
	require.NoError(t, os.Mkdir(filepath.Join(dir, "abel"), 0755))
	require.NoError(t, os.WriteFile(
		filepath.Join(dir, "abel", "map.json"),
		[]byte(`{"displayName":"Malden","name":"abel","worldSize":8192}`), 0644))

	// World with no displayName anywhere (priority 3: directory name)
	require.NoError(t, os.Mkdir(filepath.Join(dir, "tanoa"), 0755))

	// World with meta.json AND map.json — meta.json wins
	require.NoError(t, os.Mkdir(filepath.Join(dir, "enoch"), 0755))
	require.NoError(t, os.WriteFile(
		filepath.Join(dir, "enoch", "meta.json"),
		[]byte(`{"displayName":"Livonia"}`), 0644))
	require.NoError(t, os.WriteFile(
		filepath.Join(dir, "enoch", "map.json"),
		[]byte(`{"displayName":"Wrong Name"}`), 0644))

	worlds, err := ScanWorlds(dir)
	require.NoError(t, err)
	assert.Len(t, worlds, 4)

	// Build lookup for easier assertions
	lookup := make(map[string]string)
	for _, w := range worlds {
		lookup[w.Name] = w.DisplayName
	}

	assert.Equal(t, "Garmanda", lookup["juju_javory"])
	assert.Equal(t, "Malden", lookup["abel"])
	assert.Equal(t, "tanoa", lookup["tanoa"])
	assert.Equal(t, "Livonia", lookup["enoch"])
}

func TestScanWorlds_EmptyDir(t *testing.T) {
	dir := t.TempDir()
	worlds, err := ScanWorlds(dir)
	require.NoError(t, err)
	assert.Empty(t, worlds)
}

func TestScanWorlds_NonExistent(t *testing.T) {
	worlds, err := ScanWorlds("/tmp/nonexistent-dir-99999")
	require.NoError(t, err)
	assert.Empty(t, worlds)
}

func TestScanWorlds_MalformedJSON(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.Mkdir(filepath.Join(dir, "broken"), 0755))
	require.NoError(t, os.WriteFile(
		filepath.Join(dir, "broken", "meta.json"),
		[]byte(`{invalid json`), 0644))

	worlds, err := ScanWorlds(dir)
	require.NoError(t, err)
	assert.Len(t, worlds, 1)
	assert.Equal(t, "broken", worlds[0].DisplayName) // falls back to dir name
}

func TestScanWorlds_ReadDirError(t *testing.T) {
	// Use a file (not a directory) as the maps path to trigger a non-IsNotExist error
	f, err := os.CreateTemp(t.TempDir(), "not-a-dir")
	require.NoError(t, err)
	f.Close()

	worlds, err := ScanWorlds(f.Name())
	assert.Error(t, err)
	assert.Nil(t, worlds)
}

func TestScanWorlds_SkipsFiles(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "not-a-dir.txt"), []byte("hi"), 0644))
	require.NoError(t, os.Mkdir(filepath.Join(dir, "altis"), 0755))

	worlds, err := ScanWorlds(dir)
	require.NoError(t, err)
	assert.Len(t, worlds, 1)
	assert.Equal(t, "altis", worlds[0].Name)
}
