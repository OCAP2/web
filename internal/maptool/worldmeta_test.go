package maptool

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestWorldNameFromDir(t *testing.T) {
	assert.Equal(t, "altis", WorldNameFromDir("/tmp/exports/Altis"))
	assert.Equal(t, "stratis", WorldNameFromDir("/some/path/Stratis"))
	assert.Equal(t, "tanoa", WorldNameFromDir("tanoa"))
	assert.Equal(t, "vr", WorldNameFromDir("/maps/VR"))
}

func TestValidateGradMehDir_Valid(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "meta.json"), []byte(`{}`), 0644)
	os.MkdirAll(filepath.Join(dir, "sat"), 0755)

	assert.NoError(t, ValidateGradMehDir(dir))
}

func TestValidateGradMehDir_MissingMeta(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "sat"), 0755)

	err := ValidateGradMehDir(dir)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "meta.json")
}

func TestValidateGradMehDir_MissingSat(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "meta.json"), []byte(`{}`), 0644)

	err := ValidateGradMehDir(dir)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "sat/")
}

func TestValidateGradMehDir_NotADirectory(t *testing.T) {
	f, _ := os.CreateTemp("", "not-a-dir")
	f.Close()
	defer os.Remove(f.Name())

	err := ValidateGradMehDir(f.Name())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not a directory")
}

func TestValidateGradMehDir_NonExistent(t *testing.T) {
	err := ValidateGradMehDir("/nonexistent/path")
	require.Error(t, err)
}

func TestReadGradMehMeta_Valid(t *testing.T) {
	dir := t.TempDir()
	data := `{"worldName":"Altis","worldSize":30720,"displayName":"Altis","author":"BIS","version":"1.0"}`
	os.WriteFile(filepath.Join(dir, "meta.json"), []byte(data), 0644)

	meta, err := ReadGradMehMeta(dir)
	require.NoError(t, err)
	assert.Equal(t, "altis", meta.WorldName) // lowercased
	assert.Equal(t, 30720.0, meta.WorldSize)
	assert.Equal(t, "Altis", meta.DisplayName)
	assert.Equal(t, "BIS", meta.Author)
}

func TestReadGradMehMeta_EmptyWorldName(t *testing.T) {
	dir := t.TempDir()
	data := `{"worldName":"","worldSize":30720}`
	os.WriteFile(filepath.Join(dir, "meta.json"), []byte(data), 0644)

	_, err := ReadGradMehMeta(dir)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "worldName is empty")
}

func TestReadGradMehMeta_ZeroWorldSize(t *testing.T) {
	dir := t.TempDir()
	data := `{"worldName":"test","worldSize":0}`
	os.WriteFile(filepath.Join(dir, "meta.json"), []byte(data), 0644)

	_, err := ReadGradMehMeta(dir)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "worldSize must be positive")
}

func TestReadGradMehMeta_InvalidJSON(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "meta.json"), []byte(`{invalid`), 0644)

	_, err := ReadGradMehMeta(dir)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "parse meta.json")
}

func TestReadGradMehMeta_MissingFile(t *testing.T) {
	_, err := ReadGradMehMeta(t.TempDir())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "read meta.json")
}

func TestNewParseGradMehStage_Valid(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "meta.json"), []byte(`{"worldName":"Altis","worldSize":30720,"displayName":"Altis","author":"BIS"}`), 0644)
	os.MkdirAll(filepath.Join(dir, "sat"), 0755)

	stage := NewParseGradMehStage()
	job := &Job{InputPath: dir}
	err := stage.Run(context.Background(), job)
	require.NoError(t, err)
	assert.Equal(t, "altis", job.WorldName)
	assert.Equal(t, 30720, job.WorldSize)
	assert.NotNil(t, job.GradMehMeta)
}

func TestNewParseGradMehStage_InvalidDir(t *testing.T) {
	stage := NewParseGradMehStage()
	job := &Job{InputPath: t.TempDir()}
	err := stage.Run(context.Background(), job)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "validate grad_meh dir")
}

func TestNewParseGradMehStage_InvalidMeta(t *testing.T) {
	// Directory passes validation (meta.json + sat/ exist) but meta.json is invalid
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "meta.json"), []byte(`{invalid json}`), 0644)
	os.MkdirAll(filepath.Join(dir, "sat"), 0755)

	stage := NewParseGradMehStage()
	job := &Job{InputPath: dir}
	err := stage.Run(context.Background(), job)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "parse meta.json")
}
