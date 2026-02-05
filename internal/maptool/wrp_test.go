package maptool

import (
	"bytes"
	"encoding/binary"
	"math"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func buildWRPHeader(version, appID, layerSizeX, layerSizeY, mapSizeX, mapSizeY uint32, cellSize float32) []byte {
	var buf bytes.Buffer
	buf.WriteString("OPRW")
	binary.Write(&buf, binary.LittleEndian, version)
	binary.Write(&buf, binary.LittleEndian, appID)
	binary.Write(&buf, binary.LittleEndian, layerSizeX)
	binary.Write(&buf, binary.LittleEndian, layerSizeY)
	binary.Write(&buf, binary.LittleEndian, mapSizeX)
	binary.Write(&buf, binary.LittleEndian, mapSizeY)
	binary.Write(&buf, binary.LittleEndian, cellSize)
	return buf.Bytes()
}

func TestReadWRPHeader_Altis(t *testing.T) {
	// Altis: layerSize=1024, cellSize=30.0 → worldSize=30720
	data := buildWRPHeader(25, 0x01A392, 1024, 1024, 4096, 4096, 30.0)
	hdr, err := ReadWRPHeader(bytes.NewReader(data))
	require.NoError(t, err)

	assert.Equal(t, uint32(25), hdr.Version)
	assert.Equal(t, uint32(1024), hdr.LayerSizeX)
	assert.Equal(t, uint32(1024), hdr.LayerSizeY)
	assert.Equal(t, float32(30.0), hdr.LayerCellSize)
	assert.Equal(t, 30720, hdr.WorldSize())
}

func TestReadWRPHeader_Stratis(t *testing.T) {
	// Stratis: layerSize=256, cellSize=30.0 → worldSize=7680
	data := buildWRPHeader(25, 0x01A392, 256, 256, 1024, 1024, 30.0)
	hdr, err := ReadWRPHeader(bytes.NewReader(data))
	require.NoError(t, err)

	assert.Equal(t, 7680, hdr.WorldSize())
}

func TestReadWRPHeader_InvalidMagic(t *testing.T) {
	data := []byte("NOTW" + "\x00\x00\x00\x00" + "\x00\x00\x00\x00")
	_, err := ReadWRPHeader(bytes.NewReader(data))
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid WRP magic")
}

func TestReadWRPHeader_ShortFile(t *testing.T) {
	_, err := ReadWRPHeader(bytes.NewReader([]byte("OPR")))
	assert.Error(t, err)
}

func TestReadWRPHeader_InvalidCellSize(t *testing.T) {
	data := buildWRPHeader(25, 0, 1024, 1024, 4096, 4096, float32(math.NaN()))
	_, err := ReadWRPHeader(bytes.NewReader(data))
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "invalid layer cell size")
}

func TestReadWRPHeader_RealAltisFile(t *testing.T) {
	const path = "/tmp/altis-explore/a3/map_altis/Altis.wrp"
	hdr, err := ReadWRPMeta(path)
	if err != nil {
		t.Skipf("skipping (file not available): %v", err)
	}

	assert.Equal(t, uint32(25), hdr.Version)
	assert.Equal(t, uint32(1024), hdr.LayerSizeX)
	assert.Equal(t, float32(30.0), hdr.LayerCellSize)
	assert.Equal(t, 30720, hdr.WorldSize())
}
