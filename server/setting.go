package server

import (
	"fmt"
	"strings"

	"github.com/spf13/viper"
)

// Setting server
type Setting struct {
	Listen string `json:"listen" yaml:"listen"`
	Secret string `json:"secret" yaml:"secret"`
	DB     string `json:"db" yaml:"db"`
	Marker string `json:"marker" yaml:"marker"`
	Map    string `json:"map" yaml:"map"`
	Data   string `json:"data" yaml:"data"`
	Static string `json:"static" yaml:"static"`
	Logger bool   `json:"logger" yaml:"logger"`
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
	viper.SetDefault("db", "data.db")
	viper.SetDefault("marker", "marker")
	viper.SetDefault("map", "map")
	viper.SetDefault("data", "data")
	viper.SetDefault("static", "static")
	viper.SetDefault("logger", true)

	// workaround for https://github.com/spf13/viper/issues/761
	envKeys := []string{"listen", "secret", "db", "marker", "map", "data", "static"}
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
