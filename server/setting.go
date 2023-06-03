package server

import (
	"fmt"
	"strings"

	"github.com/spf13/viper"
)

type Setting struct {
	Listen    string    `json:"listen" yaml:"listen"`
	PrefixURL string    `json:"prefixURL" yaml:"prefixURL"`
	Secret    string    `json:"secret" yaml:"secret"`
	DB        string    `json:"db" yaml:"db"`
	Markers   string    `json:"markers" yaml:"markers"`
	Ammo      string    `json:"ammo" yaml:"ammo"`
	Maps      string    `json:"maps" yaml:"maps"`
	Data      string    `json:"data" yaml:"data"`
	Static    string    `json:"static" yaml:"static"`
	Logger    bool      `json:"logger" yaml:"logger"`
	Customize Customize `json:"customize" yaml:"customize"`
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
	viper.SetDefault("markers", "markers")
	viper.SetDefault("ammo", "ammo")
	viper.SetDefault("maps", "maps")
	viper.SetDefault("data", "data")
	viper.SetDefault("static", "static")
	viper.SetDefault("logger", false)
	viper.SetDefault("customize.websiteLogoSize", "32px")

	// workaround for https://github.com/spf13/viper/issues/761
	envKeys := []string{"listen", "prefixURL", "secret", "db", "markers", "ammo", "maps", "data", "static", "customize.websiteurl", "customize.websitelogo", "customize.websitelogosize", "customize.disableKillCount"}
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
