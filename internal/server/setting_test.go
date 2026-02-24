package server

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/spf13/viper"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewSetting_ConfigFile(t *testing.T) {
	// Reset viper between tests
	defer viper.Reset()

	t.Run("valid config with proper secret", func(t *testing.T) {
		dir := t.TempDir()
		configPath := filepath.Join(dir, "setting.json")
		configContent := `{
			"listen": "0.0.0.0:8080",
			"secret": "my-secure-secret-123",
			"prefixURL": "/sub/",
			"db": "custom.db",
			"logger": true
		}`
		err := os.WriteFile(configPath, []byte(configContent), 0644)
		require.NoError(t, err)

		viper.Reset()
		viper.AddConfigPath(dir)

		setting, err := NewSetting()
		require.NoError(t, err)

		assert.Equal(t, "0.0.0.0:8080", setting.Listen)
		assert.Equal(t, "my-secure-secret-123", setting.Secret)
		assert.Equal(t, "/sub/", setting.PrefixURL)
		assert.Equal(t, "custom.db", setting.DB)
		assert.True(t, setting.Logger)
	})

	t.Run("empty secret fails", func(t *testing.T) {
		dir := t.TempDir()
		configPath := filepath.Join(dir, "setting.json")
		configContent := `{
			"listen": "127.0.0.1:5000",
			"secret": ""
		}`
		err := os.WriteFile(configPath, []byte(configContent), 0644)
		require.NoError(t, err)

		viper.Reset()
		viper.AddConfigPath(dir)

		_, err = NewSetting()
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "secret")
	})

	t.Run("same-secret placeholder fails", func(t *testing.T) {
		dir := t.TempDir()
		configPath := filepath.Join(dir, "setting.json")
		configContent := `{
			"listen": "127.0.0.1:5000",
			"secret": "same-secret"
		}`
		err := os.WriteFile(configPath, []byte(configContent), 0644)
		require.NoError(t, err)

		viper.Reset()
		viper.AddConfigPath(dir)

		_, err = NewSetting()
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "secret")
	})

	t.Run("default values applied", func(t *testing.T) {
		dir := t.TempDir()
		configPath := filepath.Join(dir, "setting.json")
		// Minimal config with only required secret
		configContent := `{
			"secret": "valid-secret-value"
		}`
		err := os.WriteFile(configPath, []byte(configContent), 0644)
		require.NoError(t, err)

		viper.Reset()
		viper.AddConfigPath(dir)

		setting, err := NewSetting()
		require.NoError(t, err)

		// Check defaults
		assert.Equal(t, "127.0.0.1:5000", setting.Listen)
		assert.Equal(t, "", setting.PrefixURL)
		assert.Equal(t, "data.db", setting.DB)
		assert.Equal(t, "assets/markers", setting.Markers)
		assert.Equal(t, "assets/ammo", setting.Ammo)
		assert.Equal(t, "maps", setting.Maps)
		assert.Equal(t, "data", setting.Data)
		assert.Equal(t, "", setting.Static)
		assert.False(t, setting.Logger)
	})

	t.Run("conversion defaults", func(t *testing.T) {
		dir := t.TempDir()
		configPath := filepath.Join(dir, "setting.json")
		configContent := `{
			"secret": "valid-secret-value"
		}`
		err := os.WriteFile(configPath, []byte(configContent), 0644)
		require.NoError(t, err)

		viper.Reset()
		viper.AddConfigPath(dir)

		setting, err := NewSetting()
		require.NoError(t, err)

		assert.False(t, setting.Conversion.Enabled)
		assert.Equal(t, "5m", setting.Conversion.Interval)
		assert.Equal(t, 1, setting.Conversion.BatchSize)
		assert.Equal(t, uint32(300), setting.Conversion.ChunkSize)
	})

	t.Run("customize defaults", func(t *testing.T) {
		dir := t.TempDir()
		configPath := filepath.Join(dir, "setting.json")
		configContent := `{
			"secret": "valid-secret-value"
		}`
		err := os.WriteFile(configPath, []byte(configContent), 0644)
		require.NoError(t, err)

		viper.Reset()
		viper.AddConfigPath(dir)

		setting, err := NewSetting()
		require.NoError(t, err)

		assert.Equal(t, "32px", setting.Customize.WebsiteLogoSize)
		assert.Empty(t, setting.Customize.WebsiteURL)
		assert.Empty(t, setting.Customize.WebsiteLogo)
		assert.False(t, setting.Customize.DisableKillCount)
	})

	t.Run("customize values from config", func(t *testing.T) {
		dir := t.TempDir()
		configPath := filepath.Join(dir, "setting.json")
		configContent := `{
			"secret": "valid-secret-value",
			"customize": {
				"websiteURL": "https://example.com",
				"websiteLogo": "/logo.png",
				"websiteLogoSize": "64px",
				"disableKillCount": true,
				"headerTitle": "My Community",
				"headerSubtitle": "After Action Reviews"
			}
		}`
		err := os.WriteFile(configPath, []byte(configContent), 0644)
		require.NoError(t, err)

		viper.Reset()
		viper.AddConfigPath(dir)

		setting, err := NewSetting()
		require.NoError(t, err)

		assert.Equal(t, "https://example.com", setting.Customize.WebsiteURL)
		assert.Equal(t, "/logo.png", setting.Customize.WebsiteLogo)
		assert.Equal(t, "64px", setting.Customize.WebsiteLogoSize)
		assert.True(t, setting.Customize.DisableKillCount)
		assert.Equal(t, "My Community", setting.Customize.HeaderTitle)
		assert.Equal(t, "After Action Reviews", setting.Customize.HeaderSubtitle)
	})

	t.Run("conversion values from config", func(t *testing.T) {
		dir := t.TempDir()
		configPath := filepath.Join(dir, "setting.json")
		configContent := `{
			"secret": "valid-secret-value",
			"conversion": {
				"enabled": true,
				"interval": "10m",
				"batchSize": 5,
				"chunkSize": 500
			}
		}`
		err := os.WriteFile(configPath, []byte(configContent), 0644)
		require.NoError(t, err)

		viper.Reset()
		viper.AddConfigPath(dir)

		setting, err := NewSetting()
		require.NoError(t, err)

		assert.True(t, setting.Conversion.Enabled)
		assert.Equal(t, "10m", setting.Conversion.Interval)
		assert.Equal(t, 5, setting.Conversion.BatchSize)
		assert.Equal(t, uint32(500), setting.Conversion.ChunkSize)
	})

	t.Run("YAML config format", func(t *testing.T) {
		dir := t.TempDir()
		configPath := filepath.Join(dir, "setting.yaml")
		configContent := `
listen: "0.0.0.0:9000"
secret: "yaml-secret-value"
prefixURL: "/replay/"
logger: true
`
		err := os.WriteFile(configPath, []byte(configContent), 0644)
		require.NoError(t, err)

		viper.Reset()
		viper.AddConfigPath(dir)

		setting, err := NewSetting()
		require.NoError(t, err)

		assert.Equal(t, "0.0.0.0:9000", setting.Listen)
		assert.Equal(t, "yaml-secret-value", setting.Secret)
		assert.Equal(t, "/replay/", setting.PrefixURL)
		assert.True(t, setting.Logger)
	})
}

func TestNewSetting_EnvVars(t *testing.T) {
	// Create a minimal config file (required for viper.ReadInConfig)
	dir := t.TempDir()
	configPath := filepath.Join(dir, "setting.json")
	configContent := `{"secret": "base-secret"}`
	err := os.WriteFile(configPath, []byte(configContent), 0644)
	require.NoError(t, err)

	t.Run("OCAP_SECRET env var", func(t *testing.T) {
		viper.Reset()
		viper.AddConfigPath(dir)

		os.Setenv("OCAP_SECRET", "env-secret-value")
		defer os.Unsetenv("OCAP_SECRET")

		setting, err := NewSetting()
		require.NoError(t, err)
		assert.Equal(t, "env-secret-value", setting.Secret)
	})

	t.Run("OCAP_LISTEN env var", func(t *testing.T) {
		viper.Reset()
		viper.AddConfigPath(dir)

		os.Setenv("OCAP_SECRET", "env-secret")
		os.Setenv("OCAP_LISTEN", "0.0.0.0:3000")
		defer os.Unsetenv("OCAP_SECRET")
		defer os.Unsetenv("OCAP_LISTEN")

		setting, err := NewSetting()
		require.NoError(t, err)
		assert.Equal(t, "0.0.0.0:3000", setting.Listen)
	})

	t.Run("OCAP_DB env var", func(t *testing.T) {
		viper.Reset()
		viper.AddConfigPath(dir)

		os.Setenv("OCAP_SECRET", "env-secret")
		os.Setenv("OCAP_DB", "/data/custom.db")
		defer os.Unsetenv("OCAP_SECRET")
		defer os.Unsetenv("OCAP_DB")

		setting, err := NewSetting()
		require.NoError(t, err)
		assert.Equal(t, "/data/custom.db", setting.DB)
	})

	t.Run("nested env vars with underscore", func(t *testing.T) {
		viper.Reset()
		viper.AddConfigPath(dir)

		os.Setenv("OCAP_SECRET", "env-secret")
		os.Setenv("CONVERSION_ENABLED", "true")
		os.Setenv("CONVERSION_CHUNKSIZE", "600")
		defer os.Unsetenv("OCAP_SECRET")
		defer os.Unsetenv("CONVERSION_ENABLED")
		defer os.Unsetenv("CONVERSION_CHUNKSIZE")

		setting, err := NewSetting()
		require.NoError(t, err)
		assert.True(t, setting.Conversion.Enabled)
		assert.Equal(t, uint32(600), setting.Conversion.ChunkSize)
	})
}

func TestSetting_AdminSessionTTL(t *testing.T) {
	defer viper.Reset()

	dir := t.TempDir()
	configPath := filepath.Join(dir, "setting.json")
	err := os.WriteFile(configPath, []byte(`{
		"secret": "test-secret-value",
		"admin": {
			"sessionTTL": "2h"
		}
	}`), 0644)
	require.NoError(t, err)

	viper.Reset()
	viper.AddConfigPath(dir)
	setting, err := NewSetting()
	require.NoError(t, err)

	assert.Equal(t, 2*time.Hour, setting.Admin.SessionTTL)
}

func TestSetting_AdminSessionTTL_Default(t *testing.T) {
	defer viper.Reset()

	dir := t.TempDir()
	configPath := filepath.Join(dir, "setting.json")
	err := os.WriteFile(configPath, []byte(`{"secret": "test-secret-value"}`), 0644)
	require.NoError(t, err)

	viper.Reset()
	viper.AddConfigPath(dir)
	setting, err := NewSetting()
	require.NoError(t, err)

	assert.Equal(t, 24*time.Hour, setting.Admin.SessionTTL)
}

func TestSetting_AdminAllowedSteamIDs(t *testing.T) {
	defer viper.Reset()

	dir := t.TempDir()
	configPath := filepath.Join(dir, "setting.json")
	err := os.WriteFile(configPath, []byte(`{
		"secret": "test-secret-value",
		"admin": {
			"allowedSteamIds": ["76561198012345678", "76561198087654321"]
		}
	}`), 0644)
	require.NoError(t, err)

	viper.Reset()
	viper.AddConfigPath(dir)
	setting, err := NewSetting()
	require.NoError(t, err)

	assert.Equal(t, []string{"76561198012345678", "76561198087654321"}, setting.Admin.AllowedSteamIDs)
}

func TestSetting_AdminSteamAPIKey(t *testing.T) {
	defer viper.Reset()

	dir := t.TempDir()
	configPath := filepath.Join(dir, "setting.json")
	err := os.WriteFile(configPath, []byte(`{
		"secret": "test-secret-value",
		"admin": {
			"steamApiKey": "ABCDEF0123456789"
		}
	}`), 0644)
	require.NoError(t, err)

	viper.Reset()
	viper.AddConfigPath(dir)
	setting, err := NewSetting()
	require.NoError(t, err)

	assert.Equal(t, "ABCDEF0123456789", setting.Admin.SteamAPIKey)
}

func TestSplitCSV(t *testing.T) {
	tests := []struct {
		name string
		in   []string
		want []string
	}{
		{"nil input", nil, nil},
		{"empty slice", []string{}, nil},
		{"single value", []string{"abc"}, []string{"abc"}},
		{"already split", []string{"a", "b"}, []string{"a", "b"}},
		{"comma-separated single element", []string{"a,b,c"}, []string{"a", "b", "c"}},
		{"mixed", []string{"a,b", "c"}, []string{"a", "b", "c"}},
		{"whitespace trimmed", []string{" a , b , c "}, []string{"a", "b", "c"}},
		{"empty parts skipped", []string{"a,,b,"}, []string{"a", "b"}},
		{"all empty", []string{",,"}, nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := splitCSV(tt.in)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestNewSetting_NoConfigFile(t *testing.T) {
	viper.Reset()
	// Use a directory with no config file
	viper.AddConfigPath(t.TempDir())

	_, err := NewSetting()
	assert.Error(t, err)
}
