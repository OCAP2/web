package server

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image/png"
	"io"
	"math"
	"os"
	"path"
	"sync"
	"time"

	"github.com/h2non/bimg"
)

const TitleSize = 256
const CleanDuration = 5 * time.Minute

type RepoMap struct {
	dir  string
	maps map[string]*Map
	mu   sync.RWMutex
	pool chan struct{}
}

func NewRepoMap(dir string, max int) (*RepoMap, error) {
	info, err := os.Lstat(dir)
	if err != nil {
		return nil, err
	}

	if !info.IsDir() {
		return nil, errors.New("maps dir should be directory")
	}

	pool := make(chan struct{}, max)
	for i := 0; i < max; i++ {
		pool <- struct{}{}
	}

	return &RepoMap{
		dir:  dir,
		pool: pool,
	}, nil
}

func (t *RepoMap) TitleMap(ctx context.Context, name string, z, x, y int) (img io.ReadCloser, err error) {
	name = path.Base(name)
	upath := path.Join(
		t.dir,
		name,
		fmt.Sprintf("%v/%v/%v.png", z, x, y),
	)

	f, err := os.Open(upath)
	if err == nil {
		return f, nil
	}

	t.mu.RLock()
	defer t.mu.RUnlock()

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-t.pool:
		defer func() { t.pool <- struct{}{} }()
	}

	title, ok := t.maps[name]
	if !ok {
		title, err = NewTitle(
			path.Join(t.dir, name, name+".png"),
			t.cleanMap(name),
		)
		if err != nil {
			return nil, err
		}
	}

	buf, err := title.Title(z, x, y)
	if err != nil {
		return nil, err
	}

	// Ignore error
	if os.MkdirAll(path.Dir(upath), os.ModeDevice) == nil {
		_ = os.WriteFile(upath, buf, os.ModeDevice)
	}

	img = io.NopCloser(bytes.NewBuffer(buf))
	return img, nil
}

func (t *RepoMap) cleanMap(name string) func() {
	return func() {
		t.mu.Lock()
		defer t.mu.Unlock()

		delete(t.maps, name)
	}
}

type Map struct {
	img   *bimg.Image
	clean *time.Timer
	size  int
}

func NewTitle(name string, clean func()) (*Map, error) {
	img, err := os.ReadFile(name)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("map: %w", ErrNotFound)
		}
		return nil, err
	}

	config, err := png.DecodeConfig(bytes.NewBuffer(img))
	if err != nil {
		return nil, err
	}

	size := config.Width
	if size < config.Height {
		size = config.Height
	}

	return &Map{
		img:   bimg.NewImage(img),
		clean: time.AfterFunc(CleanDuration, clean),
		size:  size,
	}, nil
}

func (t *Map) Title(z, x, y int) (img []byte, err error) {
	var (
		step = t.size / int(math.Pow(2, float64(z)))
		top  = y * step
		left = x * step
	)

	if top >= t.size || top < 0 {
		return nil, errors.New("position x outside the map")
	}

	if left >= t.size || left < 0 {
		return nil, errors.New("position y outside the map")
	}

	t.clean.Reset(CleanDuration)

	img, err = t.img.Extract(top, left, step, step)
	if err != nil {
		return nil, err
	}

	img, err = bimg.NewImage(img).Resize(TitleSize, TitleSize)
	if err != nil {
		return nil, err
	}

	return img, nil
}
