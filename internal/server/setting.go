package server

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/spf13/viper"
)

type Setting struct {
	Listen     string     `json:"listen" yaml:"listen"`
	PrefixURL  string     `json:"prefixURL" yaml:"prefixURL"`
	Secret     string     `json:"secret" yaml:"secret"`
	DB         string     `json:"db" yaml:"db"`
	Markers    string     `json:"markers" yaml:"markers"`
	Ammo       string     `json:"ammo" yaml:"ammo"`
	Fonts      string     `json:"fonts" yaml:"fonts"`
	Maps       string     `json:"maps" yaml:"maps"`
	Data       string     `json:"data" yaml:"data"`
	Static     string     `json:"static" yaml:"static"`
	Logger     bool       `json:"logger" yaml:"logger"`
	Customize  Customize  `json:"customize" yaml:"customize"`
	Conversion Conversion `json:"conversion" yaml:"conversion"`
	Streaming  Streaming  `json:"streaming" yaml:"streaming"`
	Auth       Auth       `json:"auth" yaml:"auth"`
	HttpServer HttpServer `json:"httpServer" yaml:"httpServer"`
}

type Conversion struct {
	Enabled     bool   `json:"enabled" yaml:"enabled"`
	Interval    string `json:"interval" yaml:"interval"`
	BatchSize   int    `json:"batchSize" yaml:"batchSize"`
	ChunkSize   uint32 `json:"chunkSize" yaml:"chunkSize"`
	RetryFailed bool   `json:"retryFailed" yaml:"retryFailed"`
}

type Customize struct {
	Enabled          bool              `json:"enabled" yaml:"enabled"`
	WebsiteURL       string            `json:"websiteURL" yaml:"websiteURL"`
	WebsiteLogo      string            `json:"websiteLogo" yaml:"websiteLogo"`
	WebsiteLogoSize  string            `json:"websiteLogoSize" yaml:"websiteLogoSize"`
	DisableKillCount bool              `json:"disableKillCount" yaml:"disableKillCount"`
	HeaderTitle      string            `json:"headerTitle" yaml:"headerTitle"`
	HeaderSubtitle   string            `json:"headerSubtitle" yaml:"headerSubtitle"`
	CSSOverrides     map[string]string `json:"cssOverrides,omitempty" yaml:"cssOverrides"`
}

type Auth struct {
	SessionTTL    time.Duration `json:"sessionTTL" yaml:"sessionTTL"`
	AdminSteamIDs []string      `json:"adminSteamIds" yaml:"adminSteamIds"`
	SteamAPIKey   string        `json:"steamApiKey" yaml:"steamApiKey"`
}

type Streaming struct {
	Enabled      bool          `json:"enabled" yaml:"enabled"`
	PingInterval time.Duration `json:"pingInterval" yaml:"pingInterval"`
	PingTimeout  time.Duration `json:"pingTimeout" yaml:"pingTimeout"`
}

type HttpServer struct {
	ReadTimeout       time.Duration `json:"readTimeout" yaml:"readTimeout"`
	ReadHeaderTimeout time.Duration `json:"readHeaderTimeout" yaml:"readHeaderTimeout"`
	WriteTimeout      time.Duration `json:"writeTimeout" yaml:"writeTimeout"`
	IdleTimeout       time.Duration `json:"idleTimeout" yaml:"idleTimeout"`
}

func NewSetting() (setting Setting, err error) {
	viper.AutomaticEnv()
	viper.SetEnvPrefix("ocap")
	viper.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	viper.SetConfigName("option")
	viper.SetConfigName("setting")

	viper.SetConfigType("json")
	viper.SetConfigType("yaml")

	viper.AddConfigPath("/etc/ocap")
	viper.AddConfigPath("$HOME/.ocap")
	viper.AddConfigPath(".")

	viper.SetDefault("listen", "127.0.0.1:5000")
	viper.SetDefault("prefixURL", "")
	viper.SetDefault("secret", "")
	viper.SetDefault("db", "data.db")
	viper.SetDefault("markers", "assets/markers")
	viper.SetDefault("ammo", "assets/ammo")
	viper.SetDefault("fonts", "assets/fonts")
	viper.SetDefault("maps", "maps")
	viper.SetDefault("data", "data")
	viper.SetDefault("static", "")
	viper.SetDefault("logger", false)
	viper.SetDefault("customize.enabled", false)
	viper.SetDefault("customize.websiteURL", "")
	viper.SetDefault("customize.websiteLogo", "")
	viper.SetDefault("customize.websiteLogoSize", "32px")
	viper.SetDefault("customize.disableKillCount", false)
	viper.SetDefault("customize.headerTitle", "")
	viper.SetDefault("customize.headerSubtitle", "")
	viper.SetDefault("conversion.enabled", false)
	viper.SetDefault("conversion.interval", "5m")
	viper.SetDefault("conversion.batchSize", 1)
	viper.SetDefault("conversion.chunkSize", 300)

	viper.SetDefault("conversion.retryFailed", false)
	viper.SetDefault("streaming.enabled", false)
	viper.SetDefault("streaming.pingInterval", "30s")
	viper.SetDefault("streaming.pingTimeout", "10s")
	viper.SetDefault("auth.sessionTTL", "24h")
	viper.SetDefault("auth.adminSteamIds", []string{})
	viper.SetDefault("auth.steamApiKey", "")

	viper.SetDefault("httpServer.readTimeout", "120s")
	viper.SetDefault("httpServer.readHeaderTimeout", "30s")
	viper.SetDefault("httpServer.writeTimeout", "120s")
	viper.SetDefault("httpServer.idleTimeout", "120s")

	if err = viper.ReadInConfig(); err != nil {
		if _, ok := err.(viper.ConfigFileNotFoundError); !ok {
			return
		}
		err = nil
	}

	if err = viper.Unmarshal(&setting); err != nil {
		return
	}

	// Viper doesn't split comma-separated env var strings into slices,
	// so a value like "id1,id2" ends up as ["id1,id2"]. Expand it.
	setting.Auth.AdminSteamIDs = splitCSV(setting.Auth.AdminSteamIDs)

	// Viper can't unmarshal a JSON string env var into map[string]string,
	// so parse OCAP_CUSTOMIZE_CSSOVERRIDES manually if set. Env var takes
	// precedence over config file.
	if raw := os.Getenv("OCAP_CUSTOMIZE_CSSOVERRIDES"); raw != "" {
		var m map[string]string
		if err = json.Unmarshal([]byte(raw), &m); err != nil {
			return setting, fmt.Errorf("parse OCAP_CUSTOMIZE_CSSOVERRIDES: %w", err)
		}
		setting.Customize.CSSOverrides = m
	}

	if err = os.MkdirAll(setting.Data, 0755); err != nil {
		return setting, fmt.Errorf("create data directory: %w", err)
	}
	if err = os.MkdirAll(filepath.Dir(setting.DB), 0755); err != nil {
		return setting, fmt.Errorf("create database directory: %w", err)
	}
	if err = os.MkdirAll(setting.Maps, 0755); err != nil {
		return setting, fmt.Errorf("create maps directory: %w", err)
	}

	if setting.Secret == "" || setting.Secret == "same-secret" {
		return setting, fmt.Errorf("change the `secret` value to your own")
	}

	return
}

// splitCSV expands a []string where one element may contain comma-separated
// values (from an env var) into individual trimmed entries.
func splitCSV(in []string) []string {
	var out []string
	for _, s := range in {
		for _, part := range strings.Split(s, ",") {
			if v := strings.TrimSpace(part); v != "" {
				out = append(out, v)
			}
		}
	}
	return out
}
