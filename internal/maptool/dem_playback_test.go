package maptool

import (
	"bytes"
	"compress/gzip"
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDownsampleDEMCapsMaxDimension(t *testing.T) {
	src := &DEMGrid{
		Cols:     20,
		Rows:     10,
		CellSize: 1,
		Data:     make([]float32, 20*10),
	}
	src.Data[19] = 42
	out := downsampleDEM(src, 8)
	assert.LessOrEqual(t, out.Cols, 8)
	assert.LessOrEqual(t, out.Rows, 8)
	assert.Greater(t, out.CellSize, src.CellSize)
}

func TestDownsampleDEMLeavesSmallGridsAlone(t *testing.T) {
	src := &DEMGrid{Cols: 4, Rows: 4, CellSize: 10, Data: make([]float32, 16)}
	out := downsampleDEM(src, 1024)
	assert.Equal(t, src, out)
}

func TestWritePlaybackDEMJob(t *testing.T) {
	dir := t.TempDir()
	data := make([]float32, 4*4)
	data[0] = 12.3
	job := &Job{
		OutputDir: dir,
		SubDirs:   true,
		WorldSize: 1000,
		DEMGrid: &DEMGrid{
			Cols:      4,
			Rows:      4,
			XllCorner: 0,
			YllCorner: 0,
			CellSize:  250,
			Data:      data,
		},
	}

	require.NoError(t, writePlaybackDEMJob(job))
	assert.True(t, job.HasDem)

	raw, err := os.ReadFile(filepath.Join(dir, "tiles", "dem.bin.gz"))
	require.NoError(t, err)

	gz, err := gzip.NewReader(bytes.NewReader(raw))
	require.NoError(t, err)
	defer gz.Close()

	var buf bytes.Buffer
	_, err = buf.ReadFrom(gz)
	require.NoError(t, err)
	decoded := buf.Bytes()
	require.GreaterOrEqual(t, len(decoded), 32)
	assert.Equal(t, []byte("OCAPDEM\x01"), decoded[:8])

	var worldSizeF, cellSize float32
	require.NoError(t, binary.Read(bytes.NewReader(decoded[8:12]), binary.LittleEndian, &worldSizeF))
	require.NoError(t, binary.Read(bytes.NewReader(decoded[20:24]), binary.LittleEndian, &cellSize))
	assert.Equal(t, float32(1000), worldSizeF)
	assert.Equal(t, float32(250), cellSize)
	assert.Equal(t, uint32(4), binary.LittleEndian.Uint32(decoded[24:28]))
	assert.Equal(t, uint32(4), binary.LittleEndian.Uint32(decoded[28:32]))
	height := int16(binary.LittleEndian.Uint16(decoded[32:34]))
	assert.Equal(t, int16(123), height)
}

func TestWritePlaybackDEMJobRequiresGrid(t *testing.T) {
	err := writePlaybackDEMJob(&Job{OutputDir: t.TempDir()})
	require.Error(t, err)
}
