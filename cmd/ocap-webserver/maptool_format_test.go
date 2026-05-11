package main

import (
	"bytes"
	"encoding/json"
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
