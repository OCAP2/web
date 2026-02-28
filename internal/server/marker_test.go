package server

import (
	"context"
	"image"
	"image/color"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// createTestMarkerDir creates a temporary directory with test marker assets
func createTestMarkerDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()

	// Create an SVG marker with template placeholder
	createTestSVG(t, dir, "man")

	// Create a PNG marker
	createTestPNG(t, dir, "unknown")

	// Create subdirectory with markers
	subdir := filepath.Join(dir, "vehicles")
	err := os.MkdirAll(subdir, 0755)
	require.NoError(t, err)
	createTestPNG(t, subdir, "car")

	return dir
}

// createTestSVG creates a minimal SVG file with template placeholder
func createTestSVG(t *testing.T, dir, name string) string {
	t.Helper()
	path := filepath.Join(dir, name+".svg")
	content := `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="40" fill="#{{.}}"/>
</svg>`
	err := os.WriteFile(path, []byte(content), 0644)
	require.NoError(t, err)
	return path
}

// createTestPNG creates a 4x4 transparent PNG file
func createTestPNG(t *testing.T, dir, name string) string {
	t.Helper()
	path := filepath.Join(dir, name+".png")

	img := image.NewNRGBA(image.Rect(0, 0, 4, 4))
	// Fill with semi-transparent white
	for x := 0; x < 4; x++ {
		for y := 0; y < 4; y++ {
			img.Set(x, y, color.NRGBA{255, 255, 255, 128})
		}
	}

	f, err := os.Create(path)
	require.NoError(t, err)
	defer f.Close()

	err = png.Encode(f, img)
	require.NoError(t, err)
	return path
}

func TestNewRepoMarker(t *testing.T) {
	t.Run("successful initialization", func(t *testing.T) {
		dir := createTestMarkerDir(t)
		repo, err := NewRepoMarker(dir)
		require.NoError(t, err)
		assert.NotNil(t, repo)
		assert.Equal(t, dir, repo.root)
		assert.NotEmpty(t, repo.markers)
	})

	t.Run("sets unknown as default marker", func(t *testing.T) {
		dir := createTestMarkerDir(t)
		repo, err := NewRepoMarker(dir)
		require.NoError(t, err)
		assert.NotEmpty(t, repo.defaultMarker)
		assert.True(t, strings.HasSuffix(repo.defaultMarker, "unknown.png"))
	})

	t.Run("scans subdirectories", func(t *testing.T) {
		dir := createTestMarkerDir(t)
		repo, err := NewRepoMarker(dir)
		require.NoError(t, err)
		// "car" is in the vehicles subdirectory
		_, ok := repo.markers["car"]
		assert.True(t, ok)
	})

	t.Run("non-existent directory", func(t *testing.T) {
		_, err := NewRepoMarker("/nonexistent/path")
		assert.Error(t, err)
	})

	t.Run("empty directory (no unknown marker)", func(t *testing.T) {
		dir := t.TempDir()
		repo, err := NewRepoMarker(dir)
		require.NoError(t, err)
		assert.Empty(t, repo.defaultMarker)
	})
}

func TestRepoMarker_scanColor(t *testing.T) {
	dir := createTestMarkerDir(t)
	repo, err := NewRepoMarker(dir)
	require.NoError(t, err)

	tests := []struct {
		name      string
		input     string
		wantRGBA  color.RGBA
		wantError bool
	}{
		// 6-character hex codes
		{"6-hex red", "ff0000", color.RGBA{255, 0, 0, 255}, false},
		{"6-hex green", "00ff00", color.RGBA{0, 255, 0, 255}, false},
		{"6-hex blue", "0000ff", color.RGBA{0, 0, 255, 255}, false},
		{"6-hex white", "ffffff", color.RGBA{255, 255, 255, 255}, false},
		{"6-hex black", "000000", color.RGBA{0, 0, 0, 255}, false},
		{"6-hex mixed", "a1b2c3", color.RGBA{161, 178, 195, 255}, false},

		// 3-character hex codes (expanded: each digit * 17)
		{"3-hex white", "fff", color.RGBA{255, 255, 255, 255}, false},
		{"3-hex black", "000", color.RGBA{0, 0, 0, 255}, false},
		{"3-hex red", "f00", color.RGBA{255, 0, 0, 255}, false},
		{"3-hex abc", "abc", color.RGBA{170, 187, 204, 255}, false}, // a=10*17=170, b=11*17=187, c=12*17=204

		// Named colors
		{"follow", "follow", color.RGBA{255, 168, 26, 255}, false},
		{"hit", "hit", color.RGBA{255, 0, 0, 255}, false},
		{"dead", "dead", color.RGBA{0, 0, 0, 255}, false},
		{"default", "default", color.RGBA{0, 0, 0, 0}, false},
		{"black", "black", color.RGBA{0, 0, 0, 255}, false},
		{"grey", "grey", color.RGBA{127, 127, 127, 255}, false},
		{"red", "red", color.RGBA{255, 0, 0, 255}, false},
		{"brown", "brown", color.RGBA{127, 63, 0, 255}, false},
		{"orange", "orange", color.RGBA{216, 102, 0, 255}, false},
		{"yellow", "yellow", color.RGBA{217, 217, 0, 255}, false},
		{"khaki", "khaki", color.RGBA{127, 153, 102, 255}, false},
		{"green", "green", color.RGBA{0, 204, 0, 255}, false},
		{"blue", "blue", color.RGBA{0, 0, 255, 255}, false},
		{"pink", "pink", color.RGBA{255, 76, 102, 255}, false},
		{"white", "white", color.RGBA{255, 255, 255, 255}, false},
		{"unknown", "unknown", color.RGBA{178, 153, 0, 255}, false},
		{"unconscious", "unconscious", color.RGBA{255, 168, 26, 255}, false},

		// Side colors
		{"blufor", "blufor", color.RGBA{0, 76, 153, 255}, false},
		{"west (alias for blufor)", "west", color.RGBA{0, 76, 153, 255}, false},
		{"opfor", "opfor", color.RGBA{127, 0, 0, 255}, false},
		{"east (alias for opfor)", "east", color.RGBA{127, 0, 0, 255}, false},
		{"ind", "ind", color.RGBA{0, 127, 0, 255}, false},
		{"independent (alias for ind)", "independent", color.RGBA{0, 127, 0, 255}, false},
		{"guer (alias for ind)", "guer", color.RGBA{0, 127, 0, 255}, false},
		{"civ", "civ", color.RGBA{102, 0, 127, 255}, false},
		{"civilian (alias for civ)", "civilian", color.RGBA{102, 0, 127, 255}, false},

		// Case insensitivity for named colors
		{"BLUFOR uppercase", "BLUFOR", color.RGBA{0, 76, 153, 255}, false},
		{"Opfor mixed case", "Opfor", color.RGBA{127, 0, 0, 255}, false},
		{"DEAD uppercase", "DEAD", color.RGBA{0, 0, 0, 255}, false},

		// Arma 3 Color* prefix (e.g. ColorRed → red)
		{"ColorRed", "ColorRed", color.RGBA{255, 0, 0, 255}, false},
		{"ColorWhite", "ColorWhite", color.RGBA{255, 255, 255, 255}, false},
		{"ColorBlue", "ColorBlue", color.RGBA{0, 0, 255, 255}, false},
		{"ColorWEST", "ColorWEST", color.RGBA{0, 76, 153, 255}, false},
		{"ColorEAST", "ColorEAST", color.RGBA{127, 0, 0, 255}, false},
		{"ColorGUER", "ColorGUER", color.RGBA{0, 127, 0, 255}, false},
		{"ColorBlack", "ColorBlack", color.RGBA{0, 0, 0, 255}, false},

		// Invalid inputs
		{"invalid name", "notacolor", color.RGBA{}, true},
		{"4-char (invalid)", "abcd", color.RGBA{}, true},
		{"5-char (invalid)", "abcde", color.RGBA{}, true},
		{"empty string", "", color.RGBA{}, true},
		{"7-char (invalid)", "abcdefg", color.RGBA{}, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := repo.scanColor(tt.input)

			if tt.wantError {
				assert.Error(t, err)
				assert.ErrorIs(t, err, ErrNotFound)
				return
			}

			require.NoError(t, err)
			rgba, ok := got.(color.RGBA)
			require.True(t, ok, "expected color.RGBA, got %T", got)
			assert.Equal(t, tt.wantRGBA, rgba)
		})
	}
}

func TestRepoMarker_Get(t *testing.T) {
	dir := createTestMarkerDir(t)
	repo, err := NewRepoMarker(dir)
	require.NoError(t, err)

	ctx := context.Background()

	t.Run("get SVG marker with named color", func(t *testing.T) {
		reader, contentType, err := repo.Get(ctx, "man", "blufor")
		require.NoError(t, err)
		assert.Equal(t, "image/svg+xml", contentType)

		content, err := io.ReadAll(reader)
		require.NoError(t, err)
		// Should contain the hex color for blufor
		assert.Contains(t, string(content), "004c99ff")
	})

	t.Run("get SVG marker with hex color", func(t *testing.T) {
		reader, contentType, err := repo.Get(ctx, "man", "ff0000")
		require.NoError(t, err)
		assert.Equal(t, "image/svg+xml", contentType)

		content, err := io.ReadAll(reader)
		require.NoError(t, err)
		assert.Contains(t, string(content), "ff0000ff")
	})

	t.Run("get PNG marker with color", func(t *testing.T) {
		reader, contentType, err := repo.Get(ctx, "unknown", "opfor")
		require.NoError(t, err)
		assert.Equal(t, "image/png", contentType)

		// Verify it's valid PNG data
		img, err := png.Decode(reader)
		require.NoError(t, err)
		assert.NotNil(t, img)
	})

	t.Run("get marker from subdirectory", func(t *testing.T) {
		reader, contentType, err := repo.Get(ctx, "car", "blufor")
		require.NoError(t, err)
		assert.Equal(t, "image/png", contentType)
		assert.NotNil(t, reader)
	})

	t.Run("fallback to unknown marker", func(t *testing.T) {
		reader, contentType, err := repo.Get(ctx, "nonexistent", "blufor")
		require.NoError(t, err)
		// Should fallback to unknown.png
		assert.Equal(t, "image/png", contentType)
		assert.NotNil(t, reader)
	})

	t.Run("case insensitive marker lookup", func(t *testing.T) {
		reader, contentType, err := repo.Get(ctx, "MAN", "blufor")
		require.NoError(t, err)
		assert.Equal(t, "image/svg+xml", contentType)
		assert.NotNil(t, reader)
	})

	t.Run("invalid color returns error", func(t *testing.T) {
		_, _, err := repo.Get(ctx, "man", "invalidcolor")
		assert.Error(t, err)
		assert.ErrorIs(t, err, ErrNotFound)
	})
}

func TestPaintSVG(t *testing.T) {
	dir := t.TempDir()
	svgPath := createTestSVG(t, dir, "test")

	t.Run("substitutes color correctly", func(t *testing.T) {
		c := color.RGBA{255, 0, 0, 255}
		reader, err := paintSVG(svgPath, c)
		require.NoError(t, err)

		content, err := io.ReadAll(reader)
		require.NoError(t, err)
		assert.Contains(t, string(content), "ff0000ff")
	})

	t.Run("different color values", func(t *testing.T) {
		c := color.RGBA{0, 127, 255, 128}
		reader, err := paintSVG(svgPath, c)
		require.NoError(t, err)

		content, err := io.ReadAll(reader)
		require.NoError(t, err)
		assert.Contains(t, string(content), "007fff80")
	})

	t.Run("non-existent file", func(t *testing.T) {
		c := color.RGBA{255, 0, 0, 255}
		_, err := paintSVG("/nonexistent/file.svg", c)
		assert.Error(t, err)
	})
}

func TestPaintPNG(t *testing.T) {
	dir := t.TempDir()
	pngPath := createTestPNG(t, dir, "test")

	t.Run("applies color overlay", func(t *testing.T) {
		c := color.RGBA{255, 0, 0, 255}
		reader, err := paintPNG(pngPath, c)
		require.NoError(t, err)

		img, err := png.Decode(reader)
		require.NoError(t, err)
		assert.NotNil(t, img)
		// Image should be 4x4 as created
		assert.Equal(t, 4, img.Bounds().Dx())
		assert.Equal(t, 4, img.Bounds().Dy())
	})

	t.Run("preserves transparency", func(t *testing.T) {
		// Create a PNG with transparent pixels
		transparentDir := t.TempDir()
		transparentPath := filepath.Join(transparentDir, "transparent.png")
		img := image.NewNRGBA(image.Rect(0, 0, 4, 4))
		// Set one pixel to fully transparent
		img.Set(0, 0, color.NRGBA{0, 0, 0, 0})
		// Set another to semi-transparent
		img.Set(1, 0, color.NRGBA{255, 255, 255, 128})

		f, err := os.Create(transparentPath)
		require.NoError(t, err)
		err = png.Encode(f, img)
		require.NoError(t, f.Close())
		require.NoError(t, err)

		c := color.RGBA{255, 0, 0, 255}
		reader, err := paintPNG(transparentPath, c)
		require.NoError(t, err)

		resultImg, err := png.Decode(reader)
		require.NoError(t, err)

		// Check that transparency is preserved
		_, _, _, a := resultImg.At(0, 0).RGBA()
		assert.Equal(t, uint32(0), a, "fully transparent pixel should remain transparent")
	})

	t.Run("non-existent file", func(t *testing.T) {
		c := color.RGBA{255, 0, 0, 255}
		_, err := paintPNG("/nonexistent/file.png", c)
		assert.Error(t, err)
	})
}

func TestScanDir(t *testing.T) {
	t.Run("scans files in directory", func(t *testing.T) {
		dir := t.TempDir()
		createTestSVG(t, dir, "marker1")
		createTestPNG(t, dir, "marker2")

		files := make(map[string]string)
		err := scanDir(dir, files)
		require.NoError(t, err)

		assert.Contains(t, files, "marker1")
		assert.Contains(t, files, "marker2")
		assert.True(t, strings.HasSuffix(files["marker1"], "marker1.svg"))
		assert.True(t, strings.HasSuffix(files["marker2"], "marker2.png"))
	})

	t.Run("recursively scans subdirectories", func(t *testing.T) {
		dir := t.TempDir()
		subdir := filepath.Join(dir, "subdir")
		err := os.MkdirAll(subdir, 0755)
		require.NoError(t, err)

		createTestSVG(t, dir, "root")
		createTestPNG(t, subdir, "nested")

		files := make(map[string]string)
		err = scanDir(dir, files)
		require.NoError(t, err)

		assert.Contains(t, files, "root")
		assert.Contains(t, files, "nested")
	})

	t.Run("case insensitive mapping", func(t *testing.T) {
		dir := t.TempDir()
		// Create file with mixed case
		path := filepath.Join(dir, "MixedCase.svg")
		err := os.WriteFile(path, []byte("<svg></svg>"), 0644)
		require.NoError(t, err)

		files := make(map[string]string)
		err = scanDir(dir, files)
		require.NoError(t, err)

		// Should be stored as lowercase
		assert.Contains(t, files, "mixedcase")
		assert.NotContains(t, files, "MixedCase")
	})

	t.Run("ignores files without extension", func(t *testing.T) {
		dir := t.TempDir()
		path := filepath.Join(dir, "noextension")
		err := os.WriteFile(path, []byte("data"), 0644)
		require.NoError(t, err)

		files := make(map[string]string)
		err = scanDir(dir, files)
		require.NoError(t, err)

		// File without extension should not be in map
		assert.NotContains(t, files, "noextension")
	})

	t.Run("non-existent directory", func(t *testing.T) {
		files := make(map[string]string)
		err := scanDir("/nonexistent/path", files)
		assert.Error(t, err)
	})

	t.Run("empty directory", func(t *testing.T) {
		dir := t.TempDir()
		files := make(map[string]string)
		err := scanDir(dir, files)
		require.NoError(t, err)
		assert.Empty(t, files)
	})
}

func TestPaintSVG_InvalidTemplate(t *testing.T) {
	dir := t.TempDir()

	// Create SVG with invalid template syntax
	invalidPath := filepath.Join(dir, "invalid.svg")
	err := os.WriteFile(invalidPath, []byte(`<svg>{{ .Unclosed`), 0644)
	require.NoError(t, err)

	c := color.RGBA{255, 0, 0, 255}
	_, err = paintSVG(invalidPath, c)
	assert.Error(t, err)
}

func TestRepoMarker_Get_UnsupportedExtension(t *testing.T) {
	dir := t.TempDir()

	// Create a marker file with an unsupported extension (.txt)
	err := os.WriteFile(filepath.Join(dir, "badext.txt"), []byte("not an image"), 0644)
	require.NoError(t, err)

	repo, err := NewRepoMarker(dir)
	require.NoError(t, err)

	// "badext" should be in the markers map pointing to badext.txt
	_, ok := repo.markers["badext"]
	require.True(t, ok, "scanDir should have indexed badext.txt")

	ctx := context.Background()
	_, _, err = repo.Get(ctx, "badext", "blufor")
	assert.Error(t, err)
	assert.ErrorIs(t, err, ErrNotFound)
}

func TestPaintPNG_InvalidImage(t *testing.T) {
	dir := t.TempDir()

	// Create file with .png extension but invalid image data
	invalidPath := filepath.Join(dir, "invalid.png")
	err := os.WriteFile(invalidPath, []byte("not a valid png"), 0644)
	require.NoError(t, err)

	c := color.RGBA{255, 0, 0, 255}
	_, err = paintPNG(invalidPath, c)
	assert.Error(t, err)
}

func TestScanDir_UnreadableSubdir(t *testing.T) {
	dir := t.TempDir()

	// Create a subdirectory, then make it unreadable
	subdir := filepath.Join(dir, "locked")
	require.NoError(t, os.MkdirAll(subdir, 0755))
	require.NoError(t, os.Chmod(subdir, 0000))
	defer func() { assert.NoError(t, os.Chmod(subdir, 0755)) }()

	files := make(map[string]string)
	err := scanDir(dir, files)
	assert.Error(t, err) // recursive scanDir should fail on locked subdir
}

func TestPaintSVG_TemplateError(t *testing.T) {
	// Create an SVG file with invalid template syntax
	dir := t.TempDir()
	svgPath := filepath.Join(dir, "bad.svg")
	// Unclosed action causes Execute to fail
	require.NoError(t, os.WriteFile(svgPath, []byte(`<svg>{{ .BadField.Nope }}</svg>`), 0644))

	_, err := paintSVG(svgPath, color.RGBA{R: 255, A: 255})
	assert.Error(t, err)
}

func TestMax(t *testing.T) {
	tests := []struct {
		a, b, want uint8
	}{
		{0, 0, 0},
		{255, 0, 255},
		{0, 255, 255},
		{100, 200, 200},
		{200, 100, 200},
		{128, 128, 128},
	}

	for _, tt := range tests {
		got := max(tt.a, tt.b)
		assert.Equal(t, tt.want, got, "max(%d, %d) = %d, want %d", tt.a, tt.b, got, tt.want)
	}
}
