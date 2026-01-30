package server

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// createTestAmmoDir creates a temporary directory with test ammo assets
func createTestAmmoDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()

	// Create a basic ammo icon
	path := filepath.Join(dir, "grenade.png")
	err := os.WriteFile(path, []byte("fake png data"), 0644)
	require.NoError(t, err)

	// Create subdirectory with ammo (simulating mod folders)
	aceDir := filepath.Join(dir, "ace")
	err = os.MkdirAll(aceDir, 0755)
	require.NoError(t, err)

	acePath := filepath.Join(aceDir, "ace_m84_x_ca.png")
	err = os.WriteFile(acePath, []byte("fake png data"), 0644)
	require.NoError(t, err)

	return dir
}

func TestNewRepoAmmo(t *testing.T) {
	t.Run("successful initialization", func(t *testing.T) {
		dir := createTestAmmoDir(t)
		repo, err := NewRepoAmmo(dir)
		require.NoError(t, err)
		assert.NotNil(t, repo)
		assert.Equal(t, dir, repo.root)
		assert.NotEmpty(t, repo.ammo)
	})

	t.Run("scans subdirectories", func(t *testing.T) {
		dir := createTestAmmoDir(t)
		repo, err := NewRepoAmmo(dir)
		require.NoError(t, err)

		// Should find ace_m84_x_ca in the ace subdirectory
		_, ok := repo.ammo["ace_m84_x_ca"]
		assert.True(t, ok)
	})

	t.Run("non-existent directory", func(t *testing.T) {
		_, err := NewRepoAmmo("/nonexistent/path")
		assert.Error(t, err)
	})

	t.Run("empty directory", func(t *testing.T) {
		dir := t.TempDir()
		repo, err := NewRepoAmmo(dir)
		require.NoError(t, err)
		assert.Empty(t, repo.ammo)
	})
}

func TestRepoAmmo_GetPath(t *testing.T) {
	dir := createTestAmmoDir(t)
	repo, err := NewRepoAmmo(dir)
	require.NoError(t, err)

	ctx := context.Background()

	t.Run("get existing ammo", func(t *testing.T) {
		path, err := repo.GetPath(ctx, "grenade")
		require.NoError(t, err)
		assert.True(t, strings.HasSuffix(path, "grenade.png"))
	})

	t.Run("get ammo from subdirectory", func(t *testing.T) {
		path, err := repo.GetPath(ctx, "ace_m84_x_ca")
		require.NoError(t, err)
		assert.Contains(t, path, "ace")
		assert.True(t, strings.HasSuffix(path, "ace_m84_x_ca.png"))
	})

	t.Run("case insensitive lookup", func(t *testing.T) {
		path, err := repo.GetPath(ctx, "GRENADE")
		require.NoError(t, err)
		assert.True(t, strings.HasSuffix(path, "grenade.png"))
	})

	t.Run("mixed case lookup", func(t *testing.T) {
		path, err := repo.GetPath(ctx, "ACE_M84_X_CA")
		require.NoError(t, err)
		assert.True(t, strings.HasSuffix(path, "ace_m84_x_ca.png"))
	})

	t.Run("non-existent ammo", func(t *testing.T) {
		_, err := repo.GetPath(ctx, "nonexistent")
		assert.Error(t, err)
		assert.ErrorIs(t, err, ErrNotFound)
	})

	t.Run("empty name", func(t *testing.T) {
		_, err := repo.GetPath(ctx, "")
		assert.Error(t, err)
		assert.ErrorIs(t, err, ErrNotFound)
	})
}
