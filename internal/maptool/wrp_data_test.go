package maptool

import (
	"encoding/binary"
	"math"
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSkipQuadTree_Leaf(t *testing.T) {
	// Root flag=0 (leaf) + 4 bytes leaf data
	data := []byte{0, 0, 0, 0, 0}
	off, err := skipQuadTree(data, 0)
	require.NoError(t, err)
	assert.Equal(t, 5, off) // 1 flag + 4 leaf
}

func TestSkipQuadTree_AllLeaves(t *testing.T) {
	// Root flag=1 (node) + u16 bitmask=0x0000 (all children are leaves) + 16 × 4 bytes
	var data []byte
	data = append(data, 1)    // root flag = node
	data = append(data, 0, 0) // bitmask = 0 (all leaves)
	for range 16 {
		data = append(data, 0, 0, 0, 0) // 4-byte leaf
	}

	off, err := skipQuadTree(data, 0)
	require.NoError(t, err)
	assert.Equal(t, len(data), off) // consumed everything
}

func TestSkipQuadTree_MixedChildren(t *testing.T) {
	// Root flag=1 (node), bitmask=0x0001 (child 0 is a node, rest are leaves)
	// Child 0 (node): bitmask=0x0000 (all 16 grandchildren are leaves)
	var data []byte
	data = append(data, 1)    // root flag = node
	data = append(data, 1, 0) // bitmask = 0x0001 (bit 0 set = child 0 is node)

	// Child 0: a node with all-leaf children
	data = append(data, 0, 0) // child 0 bitmask = 0 (all leaves)
	for range 16 {
		data = append(data, 0, 0, 0, 0) // grandchild leaf
	}

	// Children 1-15: leaves
	for range 15 {
		data = append(data, 0, 0, 0, 0) // leaf
	}

	off, err := skipQuadTree(data, 0)
	require.NoError(t, err)
	assert.Equal(t, len(data), off)
}

func TestReadASCIIZAt(t *testing.T) {
	data := append([]byte("hello"), 0, 0xFF)
	s, off, err := readASCIIZAt(data, 0)
	require.NoError(t, err)
	assert.Equal(t, "hello", s)
	assert.Equal(t, 6, off) // past null terminator
}

func TestReadASCIIZAt_Empty(t *testing.T) {
	data := []byte{0, 0xFF}
	s, off, err := readASCIIZAt(data, 0)
	require.NoError(t, err)
	assert.Equal(t, "", s)
	assert.Equal(t, 1, off)
}

func TestReadStringArrayAt(t *testing.T) {
	var data []byte
	// u32 count = 2
	data = binary.LittleEndian.AppendUint32(data, 2)
	data = append(data, []byte("model_a.p3d")...)
	data = append(data, 0) // null terminator
	data = append(data, []byte("model_b.p3d")...)
	data = append(data, 0) // null terminator

	off, strs, err := readStringArrayAt(data, 0)
	require.NoError(t, err)
	assert.Equal(t, []string{"model_a.p3d", "model_b.p3d"}, strs)
	assert.Equal(t, len(data), off)
}

func TestClassifyModel(t *testing.T) {
	tests := []struct {
		path     string
		expected string
	}{
		{"a3\\structures_f\\mil\\cargo_tower.p3d", "building"},
		{"a3\\structures_f\\houses\\house_small.p3d", "building"},
		{"a3\\vegetation_f\\tree_oak.p3d", "vegetation"},
		{"a3\\rocks_f\\stone_big.p3d", "rock"},
		{"a3\\roads_f\\road_asphalt_8m.p3d", "road"},
		{"a3\\misc\\unknown.p3d", ""},
		{"Land_Cargo_Tower_V1.p3d", "building"},
		{"bush_green_medium.p3d", "vegetation"},
	}

	for _, tc := range tests {
		t.Run(tc.path, func(t *testing.T) {
			assert.Equal(t, tc.expected, ClassifyModel(tc.path))
		})
	}
}

func TestWRPObject_Position(t *testing.T) {
	obj := WRPObject{
		Transform: [12]float32{
			1, 0, 0,
			0, 1, 0,
			0, 0, 1,
			100, 50, 200,
		},
	}
	pos := obj.Position()
	assert.Equal(t, float32(100), pos[0])
	assert.Equal(t, float32(50), pos[1])
	assert.Equal(t, float32(200), pos[2])
}

func TestDecompressLZO_Raw(t *testing.T) {
	// expectedSize < 1024: raw data, no LZO compression
	data := []byte{1, 2, 3, 4, 5, 6, 7, 8, 0xFF}
	off, out, err := decompressLZO(data, 0, 8)
	require.NoError(t, err)
	assert.Equal(t, 8, off)
	assert.Equal(t, []byte{1, 2, 3, 4, 5, 6, 7, 8}, out)
}

func TestReadWRPData_VersionCheck(t *testing.T) {
	data := buildWRPHeader(20, 0, 256, 256, 1024, 1024, 30.0)
	path := t.TempDir() + "/test.wrp"
	require.NoError(t, os.WriteFile(path, data, 0644))

	_, err := ReadWRPData(path)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unsupported WRP version")
}

func TestReadObjectsAt(t *testing.T) {
	// v25 format: objectId(4) + modelIndex(4) + transform(48) + shapeParams(4) = 60 bytes
	var data []byte
	for i := range 2 {
		data = binary.LittleEndian.AppendUint32(data, uint32(i*10))   // objectId
		data = binary.LittleEndian.AppendUint32(data, uint32(i))      // modelIndex
		transform := [12]float32{0, 0, 0, 0, 0, 0, 0, 0, 0, float32(i * 100), 0, float32(i * 200)}
		for _, f := range transform {
			data = binary.LittleEndian.AppendUint32(data, math.Float32bits(f))
		}
		data = binary.LittleEndian.AppendUint32(data, 2) // shapeParams
	}

	objects := readObjectsAt(data, 0, 2, 25)
	require.Len(t, objects, 2)

	assert.Equal(t, uint32(0), objects[0].ModelIndex)
	assert.Equal(t, float32(0), objects[0].Position()[0])
	assert.Equal(t, uint32(1), objects[1].ModelIndex)
	assert.Equal(t, float32(100), objects[1].Position()[0])
	assert.Equal(t, float32(200), objects[1].Position()[2])
}

func TestSkipTextures(t *testing.T) {
	var data []byte
	// count = 2
	data = binary.LittleEndian.AppendUint32(data, 2)
	// texture 0: filename + flag
	data = append(data, []byte("tex_0.rvmat")...)
	data = append(data, 0) // null
	data = append(data, 0) // empty flag
	// texture 1: filename + flag
	data = append(data, []byte("tex_1.rvmat")...)
	data = append(data, 0) // null
	data = append(data, 0) // empty flag
	data = append(data, 0xFF) // sentinel

	off, err := skipTextures(data, 0)
	require.NoError(t, err)
	assert.Equal(t, len(data)-1, off) // before sentinel
}

func TestSkipClassedModelsAt(t *testing.T) {
	var data []byte
	// count = 1
	data = binary.LittleEndian.AppendUint32(data, 1)
	data = append(data, []byte("Land_House")...)
	data = append(data, 0) // null
	data = append(data, []byte("house.p3d")...)
	data = append(data, 0) // null
	// [3]float32 position + u32 obj_id = 16 bytes
	for range 4 {
		data = binary.LittleEndian.AppendUint32(data, 0)
	}
	data = append(data, 0xFF) // sentinel

	off, err := skipClassedModelsAt(data, 0)
	require.NoError(t, err)
	assert.Equal(t, len(data)-1, off)
}

func TestClassifyRoad(t *testing.T) {
	roadType, width := classifyRoad("road_asphalt_8m.p3d")
	assert.Equal(t, "paved", roadType)
	assert.Equal(t, 8, width)

	roadType, width = classifyRoad("road_gravel_4m.p3d")
	assert.Equal(t, "gravel", roadType)
	assert.Equal(t, 4, width)

	roadType, width = classifyRoad("road_dirt_track.p3d")
	assert.Equal(t, "track", roadType)
	assert.Equal(t, 3, width)

	roadType, width = classifyRoad("unknown_path.p3d")
	assert.Equal(t, "road", roadType)
	assert.Equal(t, 4, width)
}
