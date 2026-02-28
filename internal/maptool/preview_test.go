package maptool

import (
	"context"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoadPNG_Valid(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.png")
	img := image.NewNRGBA(image.Rect(0, 0, 16, 16))
	img.Set(0, 0, color.NRGBA{R: 255, A: 255})
	f, err := os.Create(path)
	require.NoError(t, err)
	require.NoError(t, png.Encode(f, img))
	require.NoError(t, f.Close())

	loaded, err := loadPNG(path)
	require.NoError(t, err)
	assert.Equal(t, 16, loaded.Bounds().Dx())
	assert.Equal(t, 16, loaded.Bounds().Dy())
}

func TestLoadPNG_MissingFile(t *testing.T) {
	_, err := loadPNG("/nonexistent/file.png")
	require.Error(t, err)
}

func TestLoadPNG_CorruptFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bad.png")
	require.NoError(t, os.WriteFile(path, []byte("not a png"), 0644))

	_, err := loadPNG(path)
	require.Error(t, err)
}

func TestResizeAndSavePNG(t *testing.T) {
	src := image.NewNRGBA(image.Rect(0, 0, 64, 64))
	for y := range 64 {
		for x := range 64 {
			src.SetNRGBA(x, y, color.NRGBA{R: 128, G: 64, B: 32, A: 255})
		}
	}

	outPath := filepath.Join(t.TempDir(), "resized.png")
	err := resizeAndSavePNG(src, outPath, 32)
	require.NoError(t, err)

	// Verify output exists and is valid PNG of correct size
	f, err := os.Open(outPath)
	require.NoError(t, err)
	defer f.Close()
	decoded, err := png.Decode(f)
	require.NoError(t, err)
	assert.Equal(t, 32, decoded.Bounds().Dx())
	assert.Equal(t, 32, decoded.Bounds().Dy())
}

func TestResizeAndSavePNG_InvalidPath(t *testing.T) {
	src := image.NewNRGBA(image.Rect(0, 0, 4, 4))
	err := resizeAndSavePNG(src, "/nonexistent/dir/out.png", 2)
	require.Error(t, err)
}

func TestNewGeneratePreviewStage_Valid(t *testing.T) {
	inputDir := t.TempDir()
	outputDir := t.TempDir()

	// Create a valid preview.png
	previewPath := filepath.Join(inputDir, "preview.png")
	img := image.NewNRGBA(image.Rect(0, 0, 2048, 2048))
	f, err := os.Create(previewPath)
	require.NoError(t, err)
	require.NoError(t, png.Encode(f, img))
	require.NoError(t, f.Close())

	stage := NewGeneratePreviewStage()
	job := &Job{InputPath: inputDir, OutputDir: outputDir}
	err = stage.Run(context.Background(), job)
	require.NoError(t, err)

	// Should have generated all preview sizes
	for _, size := range previewSizes {
		path := filepath.Join(outputDir, fmt.Sprintf("preview_%d.png", size))
		info, err := os.Stat(path)
		require.NoError(t, err, "expected preview_%d.png to exist", size)
		assert.Greater(t, info.Size(), int64(0))
	}
}

func TestNewGeneratePreviewStage_MissingPreview(t *testing.T) {
	stage := NewGeneratePreviewStage()
	job := &Job{InputPath: t.TempDir(), OutputDir: t.TempDir()}
	err := stage.Run(context.Background(), job)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no preview.png")
}

func TestNewGeneratePreviewStage_ResizeError(t *testing.T) {
	inputDir := t.TempDir()
	outputDir := t.TempDir()

	// Create a valid preview.png
	previewPath := filepath.Join(inputDir, "preview.png")
	img := image.NewNRGBA(image.Rect(0, 0, 64, 64))
	f, err := os.Create(previewPath)
	require.NoError(t, err)
	require.NoError(t, png.Encode(f, img))
	require.NoError(t, f.Close())

	// Make output dir read-only so resizeAndSavePNG fails
	require.NoError(t, os.Chmod(outputDir, 0555))
	t.Cleanup(func() { os.Chmod(outputDir, 0755) })

	stage := NewGeneratePreviewStage()
	job := &Job{InputPath: inputDir, OutputDir: outputDir}
	err = stage.Run(context.Background(), job)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "preview")
}

func TestNewGeneratePreviewStage_CorruptPNG(t *testing.T) {
	inputDir := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(inputDir, "preview.png"), []byte("not a png"), 0644))

	stage := NewGeneratePreviewStage()
	job := &Job{InputPath: inputDir, OutputDir: t.TempDir()}
	err := stage.Run(context.Background(), job)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "load preview")
}
