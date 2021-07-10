package server

import (
	"context"
	"sync"
)

type RepoMagazine struct {
	root      string
	magazines map[string]string
	mu        sync.RWMutex
}

func NewRepoMagazine(root string) (*RepoMagazine, error) {
	r := &RepoMagazine{
		root:      root,
		magazines: make(map[string]string),
	}

	if err := scanDir(root, r.magazines); err != nil {
		return nil, err
	}

	return r, nil
}

func (r *RepoMagazine) GetPath(ctx context.Context, name string) (string, error) {
	r.mu.RLock()
	upath, ok := r.magazines[name]
	r.mu.RUnlock()
	if !ok {
		return "", ErrNotFound
	}

	return upath, nil
}
