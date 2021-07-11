package server

import (
	"context"
	"strings"
	"sync"
)

type RepoAmmo struct {
	root string
	ammo map[string]string
	mu   sync.RWMutex
}

func NewRepoAmmo(root string) (*RepoAmmo, error) {
	r := &RepoAmmo{
		root: root,
		ammo: make(map[string]string),
	}

	if err := scanDir(root, r.ammo); err != nil {
		return nil, err
	}

	return r, nil
}

func (r *RepoAmmo) GetPath(ctx context.Context, name string) (string, error) {
	name = strings.ToLower(name)

	r.mu.RLock()
	upath, ok := r.ammo[name]
	r.mu.RUnlock()
	if !ok {
		return "", ErrNotFound
	}

	return upath, nil
}
