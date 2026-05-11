package maptoolcli

import (
	"bytes"
	"encoding/json"
	"io"
	"os"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTextFormatter_EmitsLifecycleLines(t *testing.T) {
	var buf bytes.Buffer
	f := newTextFormatter(&buf, false /* no color */)

	f.MapStart("altis", "/in/altis.zip")
	f.Stage("altis", "satellite", 3, 9)
	f.MapDone("altis", "/out/altis")
	f.MapFailed("livonia", "/in/livonia.zip", assertErr("gdalwarp boom"))
	f.MapSkipped("chernarus", "already exists")
	f.Summary(summary{OK: []string{"altis"}, Skipped: []string{"chernarus"}, Failed: map[string]string{"livonia": "gdalwarp boom"}})

	out := buf.String()
	assert.Contains(t, out, "altis")
	assert.Contains(t, out, "satellite")
	assert.Contains(t, out, "livonia")
	assert.Contains(t, out, "gdalwarp boom")
	assert.Contains(t, out, "1 ok / 1 skipped / 1 failed")
}

func TestJSONFormatter_EmitsValidJSONLines(t *testing.T) {
	var buf bytes.Buffer
	f := newJSONFormatter(&buf)

	f.MapStart("altis", "/in/altis.zip")
	f.Stage("altis", "satellite", 3, 9)
	f.MapDone("altis", "/out/altis")
	f.Summary(summary{OK: []string{"altis"}})

	lines := strings.Split(strings.TrimRight(buf.String(), "\n"), "\n")
	require.Len(t, lines, 4)
	for _, line := range lines {
		var v map[string]any
		require.NoError(t, json.Unmarshal([]byte(line), &v), "line: %s", line)
		assert.NotEmpty(t, v["event"])
	}
}

type assertErr string

func (e assertErr) Error() string { return string(e) }

func TestTextFormatter_SummaryMultipleNames(t *testing.T) {
	var buf bytes.Buffer
	f := newTextFormatter(&buf, false)
	f.Summary(summary{
		OK:      []string{"altis", "stratis"},
		Skipped: []string{"chernarus", "livonia"},
		Failed:  map[string]string{},
	})
	out := buf.String()
	assert.Contains(t, out, "altis")
	assert.Contains(t, out, "stratis")
	assert.Contains(t, out, "2 ok / 2 skipped / 0 failed")
}

// ---------------------------------------------------------------------------
// chooseFormatter tests
// ---------------------------------------------------------------------------

func TestChooseFormatter_JSON(t *testing.T) {
	var buf bytes.Buffer
	f := chooseFormatter("json", &buf)
	_, ok := f.(*jsonFormatter)
	assert.True(t, ok, "mode=json must return *jsonFormatter")
}

func TestChooseFormatter_Text(t *testing.T) {
	var buf bytes.Buffer
	f := chooseFormatter("text", &buf)
	_, ok := f.(*textFormatter)
	assert.True(t, ok, "mode=text must return *textFormatter")
}

func TestChooseFormatter_TextWithFile(t *testing.T) {
	// Pass a real *os.File (non-TTY) to exercise the *os.File type assertion in text mode.
	tmpFile, err := os.CreateTemp(t.TempDir(), "chooseFormatter-*.txt")
	require.NoError(t, err)
	defer tmpFile.Close()
	f := chooseFormatter("text", tmpFile)
	_, ok := f.(*textFormatter)
	assert.True(t, ok, "mode=text with *os.File non-TTY must return *textFormatter")
}

func TestChooseFormatter_AutoWithNonTTY(t *testing.T) {
	// bytes.Buffer is not *os.File, so auto falls back to json.
	f := chooseFormatter("auto", io.Discard)
	_, ok := f.(*jsonFormatter)
	assert.True(t, ok, "mode=auto with non-TTY writer must return *jsonFormatter")
}
