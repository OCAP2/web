package ocap

import (
	"html/template"
	"io"
	"path/filepath"

	"github.com/OCAPv2/OCAP/src/config"

	"github.com/jmoiron/sqlx"
)

type OCAP struct {
	db        *sqlx.DB
	templates *template.Template
}

func New() (*OCAP, error) {
	o := OCAP{}

	// Database
	err := o.connectDB()
	if err != nil {
		return nil, err
	}
	err = o.initDB()
	if err != nil {
		return nil, err
	}

	// Template
	o.templates, err = template.New("template").ParseGlob(filepath.Join("template", "*.html"))
	if err != nil {
		return nil, err
	}

	return &o, nil
}

func (o *OCAP) Close() error {
	return o.db.Close()
}

type index struct {
	Version     string
	Title       string
	Description string
	Author      string
	Language    string
	GameTypes   []gameType
}
type gameType struct {
	Key  string `json:"key" yaml:"key"`
	Name string `json:"name" yaml:"name"`
}

func (o *OCAP) RenderIndex(writer io.Writer) error {
	var types []struct {
		Type string `db:"type"`
	}
	err := o.db.Select(&types, `SELECT DISTINCT type FROM operations ORDER BY type`)
	if err != nil {
		return err
	}

	gameTypes := make([]gameType, len(types)+1)
	gameTypes[0] = gameType{
		Key:  "",
		Name: "All",
	}
	for i, v := range types {
		gameTypes[i+1].Key = v.Type
		gameTypes[i+1].Name = v.Type
	}

	return o.templates.ExecuteTemplate(writer, "index.html", index{
		Version:     config.C.Version,
		Title:       config.C.Title,
		Description: config.C.Description,
		Author:      config.C.Author,
		Language:    config.C.Language,
		GameTypes:   gameTypes,
	})
}
