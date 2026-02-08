package maptool

import (
	"context"
	"fmt"
	"image"
	"image/png"
	"log"
	"os"
	"path/filepath"

	"golang.org/x/image/draw"
)

// previewSizes are the thumbnail sizes to generate from the source preview image.
var previewSizes = []int{256, 512, 1024}

// NewGeneratePreviewStage creates a pipeline stage that copies the grad_meh
// preview.png and generates resized thumbnails (256, 512, 1024 pixels).
func NewGeneratePreviewStage() Stage {
	return Stage{
		Name:     "generate_preview",
		Optional: true,
		Run: func(ctx context.Context, job *Job) error {
			srcPath := filepath.Join(job.InputPath, "preview.png")
			if _, err := os.Stat(srcPath); err != nil {
				return fmt.Errorf("no preview.png in input: %w", err)
			}

			src, err := loadPNG(srcPath)
			if err != nil {
				return fmt.Errorf("load preview: %w", err)
			}
			log.Printf("Loaded preview image: %dx%d", src.Bounds().Dx(), src.Bounds().Dy())

			for _, size := range previewSizes {
				outPath := filepath.Join(job.OutputDir, fmt.Sprintf("preview_%d.png", size))
				if err := resizeAndSavePNG(src, outPath, size); err != nil {
					return fmt.Errorf("generate %dpx preview: %w", size, err)
				}
			}

			log.Printf("Generated preview images: %v", previewSizes)
			return nil
		},
	}
}

// loadPNG reads and decodes a PNG file.
func loadPNG(path string) (image.Image, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return png.Decode(f)
}

// resizeAndSavePNG scales src to size×size pixels and writes a PNG.
func resizeAndSavePNG(src image.Image, outPath string, size int) error {
	dst := image.NewNRGBA(image.Rect(0, 0, size, size))
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, src.Bounds(), draw.Over, nil)

	f, err := os.Create(outPath)
	if err != nil {
		return err
	}
	defer f.Close()
	return png.Encode(f, dst)
}
