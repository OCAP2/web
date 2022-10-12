package server

import (
	"bytes"
	"context"
	"fmt"
	"image/color"
	"image/draw"
	"image/png"
	"io"
	"os"
	"path"
	"strings"
	"sync"
	"text/template"
)

type RepoMarker struct {
	root          string
	markers       map[string]string
	defaultMarker string
	mu            sync.RWMutex
}

func NewRepoMarker(root string) (*RepoMarker, error) {
	r := &RepoMarker{
		root:    root,
		markers: make(map[string]string),
	}

	if err := scanDir(root, r.markers); err != nil {
		return nil, err
	}

	if defaultMarker, ok := r.markers["unknown"]; ok {
		r.defaultMarker = defaultMarker
	}

	return r, nil
}

func (r *RepoMarker) Get(ctx context.Context, name, scolor string) (io.Reader, string, error) {
	name = strings.ToLower(name)
	r.mu.RLock()
	upath, ok := r.markers[name]
	r.mu.RUnlock()
	if !ok {
		upath = r.defaultMarker
	}

	color, err := r.scanColor(scolor)
	if err != nil {
		return nil, "", err
	}

	switch path.Ext(upath) {
	case ".png":
		r, err := paintPNG(upath, color)
		return r, "image/png", err
	case ".svg":
		r, err := paintSVG(upath, color)
		return r, "image/svg+xml", err
	default:
		return nil, "", ErrNotFound
	}
}

func paintPNG(upath string, c color.Color) (io.Reader, error) {
	f, err := os.Open(upath)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	img, err := png.Decode(f)
	if err != nil {
		return nil, err
	}

	dst := img.(draw.Image)

	size := img.Bounds().Size()
	var ca = color.CMYKModel.Convert(c).(color.CMYK)
	for x := 0; x < size.X; x++ {
		for y := 0; y < size.Y; y++ {
			c := img.At(x, y)

			cb := color.CMYKModel.Convert(c).(color.CMYK)

			cb.C = max(ca.C, cb.C)
			cb.M = max(ca.M, cb.M)
			cb.Y = max(ca.Y, cb.Y)
			cb.K = max(ca.K, cb.K)

			r, g, b, _ := cb.RGBA()
			_, _, _, a := c.RGBA()
			dst.Set(x, y, color.NRGBA{
				uint8(r >> 8),
				uint8(g >> 8),
				uint8(b >> 8),
				uint8(a >> 8),
			})
		}
	}

	w := &bytes.Buffer{}
	if err := png.Encode(w, img); err != nil {
		return nil, err
	}

	return w, nil
}

func paintSVG(upath string, c color.Color) (io.Reader, error) {
	data, err := os.ReadFile(upath)
	if err != nil {
		return nil, err
	}

	tpl, err := template.New("image").Parse(string(data))
	if err != nil {
		return nil, err
	}

	r, g, b, a := c.RGBA()
	hex := fmt.Sprintf(
		"%02x%02x%02x%02x",
		r>>8,
		g>>8,
		b>>8,
		a>>8,
	)

	var w = &bytes.Buffer{}
	if err := tpl.Execute(w, hex); err != nil {
		return nil, err
	}

	return w, nil
}

func (r *RepoMarker) scanColor(scolor string) (color.Color, error) {
	var (
		c = color.RGBA{
			A: 255,
		}
		err error
	)

	if len(scolor) == 6 {
		_, err = fmt.Sscanf(scolor, "%02x%02x%02x", &c.R, &c.G, &c.B)
		if err == nil {
			return c, nil
		}
	}

	// fix "dead" it is invalid hex
	if len(scolor) == 3 {
		_, err = fmt.Sscanf(scolor, "%01x%01x%01x", &c.R, &c.G, &c.B)
		if err == nil {
			c.R *= 17
			c.G *= 17
			c.B *= 17
			return c, nil
		}
	}

	switch strings.ToLower(scolor) {
	case "follow":
		c = color.RGBA{255, 168, 26, 255}
	case "hit":
		c = color.RGBA{255, 0, 0, 255}
	case "dead":
		c = color.RGBA{0, 0, 0, 255}
	case "default":
		c = color.RGBA{0, 0, 0, 0}
	case "black":
		c = color.RGBA{0, 0, 0, 255}
	case "grey":
		c = color.RGBA{127, 127, 127, 255}
	case "red":
		c = color.RGBA{255, 0, 0, 255}
	case "brown":
		c = color.RGBA{127, 63, 0, 255}
	case "orange":
		c = color.RGBA{216, 102, 0, 255}
	case "yellow":
		c = color.RGBA{217, 217, 0, 255}
	case "khaki":
		c = color.RGBA{127, 153, 102, 255}
	case "green":
		c = color.RGBA{0, 204, 0, 255}
	case "blue":
		c = color.RGBA{0, 0, 255, 255}
	case "pink":
		c = color.RGBA{255, 76, 102, 255}
	case "white":
		c = color.RGBA{255, 255, 255, 255}
	case "unknown":
		c = color.RGBA{178, 153, 0, 255}
	case "blufor", "west":
		c = color.RGBA{0, 76, 153, 255}
	case "opfor", "east":
		c = color.RGBA{127, 0, 0, 255}
	case "ind", "independent", "guer":
		c = color.RGBA{0, 127, 0, 255}
	case "civ", "civilian":
		c = color.RGBA{102, 0, 127, 255}
	case "unconscious":
		c = color.RGBA{255, 168, 26, 255}
	default:
		return c, ErrNotFound
	}

	return c, nil
}

func scanDir(dir string, files map[string]string) error {
	entrys, err := os.ReadDir(dir)
	if err != nil {
		return err
	}

	for _, e := range entrys {
		fullname := e.Name()
		if e.IsDir() {
			err = scanDir(path.Join(dir, fullname), files)
			if err != nil {
				return err
			}
		}

		pos := strings.IndexByte(fullname, '.')
		if pos == -1 {
			continue
		}

		name := strings.ToLower(fullname[:pos])

		files[name] = path.Join(dir, fullname)
	}

	return err
}

func max(a uint8, b uint8) uint8 {
	if a < b {
		return b
	}
	return a
}
