package server

import (
	"fmt"
	"strings"

	"github.com/spf13/viper"
)

type Setting struct {
	Listen     string     `json:"listen" yaml:"listen"`
	PrefixURL  string     `json:"prefixURL" yaml:"prefixURL"`
	Secret     string     `json:"secret" yaml:"secret"`
	DB         string     `json:"db" yaml:"db"`
	Markers    string     `json:"markers" yaml:"markers"`
	Ammo       string     `json:"ammo" yaml:"ammo"`
	Maps       string     `json:"maps" yaml:"maps"`
	Data       string     `json:"data" yaml:"data"`
	Static     string     `json:"static" yaml:"static"`
	Logger     bool       `json:"logger" yaml:"logger"`
	Customize  Customize  `json:"customize" yaml:"customize"`
	Conversion Conversion `json:"conversion" yaml:"conversion"`
}

type Conversion struct {
	Enabled       bool   `json:"enabled" yaml:"enabled"`
	Interval      string `json:"interval" yaml:"interval"`
	BatchSize     int    `json:"batchSize" yaml:"batchSize"`
	ChunkSize     uint32 `json:"chunkSize" yaml:"chunkSize"`
	StorageEngine string `json:"storageEngine" yaml:"storageEngine"` // "protobuf" or "flatbuffers"
	RetryFailed   bool   `json:"retryFailed" yaml:"retryFailed"`
}

type Customize struct {
	WebsiteURL       string `json:"websiteURL" yaml:"websiteURL"`
	WebsiteLogo      string `json:"websiteLogo" yaml:"websiteLogo"`
	WebsiteLogoSize  string `json:"websiteLogoSize" yaml:"websiteLogoSize"`
	DisableKillCount bool   `json:"disableKillCount" yaml:"disableKillCount"`
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
	viper.SetDefault("maps", "maps")
	viper.SetDefault("data", "data")
	viper.SetDefault("static", "static")
	viper.SetDefault("logger", false)
	viper.SetDefault("customize.websiteLogoSize", "32px")
	viper.SetDefault("conversion.enabled", false)
	viper.SetDefault("conversion.interval", "5m")
	viper.SetDefault("conversion.batchSize", 1)
	viper.SetDefault("conversion.chunkSize", 300)
	viper.SetDefault("conversion.storageEngine", "protobuf") // "protobuf" or "flatbuffers"
	viper.SetDefault("conversion.retryFailed", false)

	// workaround for https://github.com/spf13/viper/issues/761
	envKeys := []string{"listen", "prefixURL", "secret", "db", "markers", "ammo", "maps", "data", "static", "customize.websiteurl", "customize.websitelogo", "customize.websitelogosize", "customize.disableKillCount", "conversion.enabled", "conversion.interval", "conversion.batchSize", "conversion.chunkSize", "conversion.storageEngine", "conversion.retryFailed"}
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

	if setting.Secret == "" || setting.Secret == "same-secret" {
		return setting, fmt.Errorf("change the `secret` value to your own")
	}

	return
}
