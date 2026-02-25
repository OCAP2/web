package maptool

import (
	"archive/zip"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// ExtractZip extracts a ZIP file to the target directory with zip-slip protection.
func ExtractZip(zipPath, targetDir string) error {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer r.Close()

	for _, f := range r.File {
		destPath := filepath.Join(targetDir, f.Name)
		// Zip-slip protection
		if !strings.HasPrefix(filepath.Clean(destPath)+string(os.PathSeparator), filepath.Clean(targetDir)+string(os.PathSeparator)) &&
			filepath.Clean(destPath) != filepath.Clean(targetDir) {
			return fmt.Errorf("illegal file path: %s", f.Name)
		}

		if f.FileInfo().IsDir() {
			os.MkdirAll(destPath, 0755)
			continue
		}

		if err := os.MkdirAll(filepath.Dir(destPath), 0755); err != nil {
			return err
		}

		outFile, err := os.Create(destPath)
		if err != nil {
			return err
		}

		rc, err := f.Open()
		if err != nil {
			outFile.Close()
			return err
		}

		_, err = io.Copy(outFile, rc)
		rc.Close()
		outFile.Close()
		if err != nil {
			return err
		}
	}
	return nil
}

// FindGradMehDir locates the grad_meh export directory within an extracted ZIP.
// It checks the root first, then one level deep.
func FindGradMehDir(dir string) (string, error) {
	if ValidateGradMehDir(dir) == nil {
		return dir, nil
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", err
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		subDir := filepath.Join(dir, e.Name())
		if ValidateGradMehDir(subDir) == nil {
			return subDir, nil
		}
	}

	return "", fmt.Errorf("no directory with meta.json and sat/ found")
}
