package server

import (
	"fmt"
	"os"
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
}

type Conversion struct {
	Enabled     bool   `json:"enabled" yaml:"enabled"`
	Interval    string `json:"interval" yaml:"interval"`
	BatchSize   int    `json:"batchSize" yaml:"batchSize"`
	ChunkSize   uint32 `json:"chunkSize" yaml:"chunkSize"`
	RetryFailed bool   `json:"retryFailed" yaml:"retryFailed"`
}

type Customize struct {
	Enabled          bool   `json:"enabled" yaml:"enabled"`
	WebsiteURL       string `json:"websiteURL" yaml:"websiteURL"`
	WebsiteLogo      string `json:"websiteLogo" yaml:"websiteLogo"`
	WebsiteLogoSize  string `json:"websiteLogoSize" yaml:"websiteLogoSize"`
	DisableKillCount bool   `json:"disableKillCount" yaml:"disableKillCount"`
	HeaderTitle      string `json:"headerTitle" yaml:"headerTitle"`
	HeaderSubtitle   string `json:"headerSubtitle" yaml:"headerSubtitle"`
}

type Streaming struct {
	Enabled      bool          `json:"enabled" yaml:"enabled"`
	PingInterval time.Duration `json:"pingInterval" yaml:"pingInterval"`
	PingTimeout  time.Duration `json:"pingTimeout" yaml:"pingTimeout"`
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
	viper.SetDefault("db", "data.db")
	viper.SetDefault("markers", "assets/markers")
	viper.SetDefault("ammo", "assets/ammo")
	viper.SetDefault("fonts", "assets/fonts")
	viper.SetDefault("maps", "maps")
	viper.SetDefault("data", "data")
	viper.SetDefault("static", "")
	viper.SetDefault("logger", false)
	viper.SetDefault("customize.enabled", false)
	viper.SetDefault("customize.websiteLogoSize", "32px")
	viper.SetDefault("conversion.enabled", false)
	viper.SetDefault("conversion.interval", "5m")
	viper.SetDefault("conversion.batchSize", 1)
	viper.SetDefault("conversion.chunkSize", 300)

	viper.SetDefault("conversion.retryFailed", false)
	viper.SetDefault("streaming.enabled", false)
	viper.SetDefault("streaming.pingInterval", "30s")
	viper.SetDefault("streaming.pingTimeout", "10s")

	// workaround for https://github.com/spf13/viper/issues/761
	envKeys := []string{"listen", "prefixURL", "secret", "db", "markers", "ammo", "fonts", "maps", "data", "static", "customize.enabled", "customize.websiteurl", "customize.websitelogo", "customize.websitelogosize", "customize.disableKillCount", "customize.headertitle", "customize.headersubtitle", "conversion.enabled", "conversion.interval", "conversion.batchSize", "conversion.chunkSize", "conversion.retryFailed", "streaming.enabled", "streaming.pingInterval", "streaming.pingTimeout"}
	for _, key := range envKeys {
		env := strings.ToUpper(strings.ReplaceAll(key, ".", "_"))
		if err = viper.BindEnv(key, env); err != nil {
			return
		}
	}

	if err = viper.ReadInConfig(); err != nil {
		return
	}

	if err = viper.Unmarshal(&setting); err != nil {
		return
	}

	if err = os.MkdirAll(setting.Data, 0755); err != nil {
		return setting, fmt.Errorf("create data directory: %w", err)
	}

	if setting.Secret == "" || setting.Secret == "same-secret" {
		return setting, fmt.Errorf("change the `secret` value to your own")
	}

	return
}
