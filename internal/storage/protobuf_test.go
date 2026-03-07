// server/storage/protobuf_test.go
package storage

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/proto"

	pbv1 "github.com/OCAP2/web/pkg/schemas/protobuf/v1"
)

func TestProtobufEngineGetManifest(t *testing.T) {
	dir := t.TempDir()
	missionDir := filepath.Join(dir, "test_mission")
	require.NoError(t, os.MkdirAll(missionDir, 0755))

	// Create test manifest
	pbManifest := &pbv1.Manifest{
		Version:        1,
		WorldName:      "altis",
		MissionName:    "Test Mission",
		EndFrame:       1000,
		ChunkSize:      300,
		CaptureDelayMs: 1000,
		ChunkCount:     4,
		Entities: []*pbv1.EntityDef{
			{Id: 0, Type: pbv1.EntityType_ENTITY_TYPE_UNIT, Name: "Player1", Side: pbv1.Side_SIDE_WEST, IsPlayer: true},
			{Id: 1, Type: pbv1.EntityType_ENTITY_TYPE_VEHICLE, Name: "Truck", VehicleClass: "B_Truck_01"},
		},
	}

	data, err := proto.Marshal(pbManifest)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(missionDir, "manifest.pb"), data, 0644))

	engine := NewProtobufEngine(dir)
	ctx := context.Background()

	manifest, err := engine.GetManifest(ctx, "test_mission")
	require.NoError(t, err)

	assert.Equal(t, "altis", manifest.WorldName)
	assert.Equal(t, "Test Mission", manifest.MissionName)
	assert.Equal(t, uint32(1000), manifest.EndFrame)
	assert.Equal(t, uint32(4), manifest.ChunkCount)
	assert.Len(t, manifest.Entities, 2)

	// Check unit
	assert.Equal(t, "unit", manifest.Entities[0].Type)
	assert.Equal(t, "Player1", manifest.Entities[0].Name)
	assert.Equal(t, "WEST", manifest.Entities[0].Side)
	assert.True(t, manifest.Entities[0].IsPlayer)

	// Check vehicle
	assert.Equal(t, "vehicle", manifest.Entities[1].Type)
	assert.Equal(t, "B_Truck_01", manifest.Entities[1].VehicleClass)
}

func TestProtobufEngineGetManifestMissingFile(t *testing.T) {
	dir := t.TempDir()
	engine := NewProtobufEngine(dir)

	_, err := engine.GetManifest(context.Background(), "nonexistent")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "read manifest")
}

func TestProtobufEngineGetManifestInvalidData(t *testing.T) {
	dir := t.TempDir()
	missionDir := filepath.Join(dir, "test_mission")
	require.NoError(t, os.MkdirAll(missionDir, 0755))

	// Write invalid protobuf data
	require.NoError(t, os.WriteFile(filepath.Join(missionDir, "manifest.pb"), []byte("invalid data"), 0644))

	engine := NewProtobufEngine(dir)
	_, err := engine.GetManifest(context.Background(), "test_mission")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unmarshal manifest")
}

func TestProtobufEngineConvert(t *testing.T) {
	dir := t.TempDir()
	engine := NewProtobufEngine(dir)

	// Test with missing input file - should fail
	err := engine.Convert(context.Background(), "nonexistent.json", "output")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "open JSON")
}

func TestEntityTypeToString(t *testing.T) {
	tests := []struct {
		input    pbv1.EntityType
		expected string
	}{
		{pbv1.EntityType_ENTITY_TYPE_UNIT, "unit"},
		{pbv1.EntityType_ENTITY_TYPE_VEHICLE, "vehicle"},
		{pbv1.EntityType_ENTITY_TYPE_UNKNOWN, "unknown"},
	}

	for _, tt := range tests {
		t.Run(tt.expected, func(t *testing.T) {
			result := entityTypeToString(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestSideToString(t *testing.T) {
	tests := []struct {
		input    pbv1.Side
		expected string
	}{
		{pbv1.Side_SIDE_WEST, "WEST"},
		{pbv1.Side_SIDE_EAST, "EAST"},
		{pbv1.Side_SIDE_GUER, "GUER"},
		{pbv1.Side_SIDE_CIV, "CIV"},
		{pbv1.Side_SIDE_GLOBAL, "GLOBAL"},
		{pbv1.Side_SIDE_UNKNOWN, "UNKNOWN"},
	}

	for _, tt := range tests {
		t.Run(tt.expected, func(t *testing.T) {
			result := sideToString(tt.input)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestProtobufEngineFullEntityDef(t *testing.T) {
	dir := t.TempDir()
	missionDir := filepath.Join(dir, "test_mission")
	require.NoError(t, os.MkdirAll(missionDir, 0755))

	// Create manifest with fully populated entity definition
	pbManifest := &pbv1.Manifest{
		Version:     1,
		WorldName:   "stratis",
		MissionName: "Full Test",
		EndFrame:    500,
		ChunkSize:   100,
		ChunkCount:  5,
		Entities: []*pbv1.EntityDef{
			{
				Id:           42,
				Type:         pbv1.EntityType_ENTITY_TYPE_UNIT,
				Name:         "Squad Leader",
				Side:         pbv1.Side_SIDE_GUER,
				GroupName:    "Alpha",
				Role:         "Leader",
				StartFrame:   10,
				EndFrame:     450,
				IsPlayer:     true,
				VehicleClass: "",
			},
		},
	}

	data, err := proto.Marshal(pbManifest)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(missionDir, "manifest.pb"), data, 0644))

	engine := NewProtobufEngine(dir)
	manifest, err := engine.GetManifest(context.Background(), "test_mission")
	require.NoError(t, err)

	require.Len(t, manifest.Entities, 1)
	ent := manifest.Entities[0]

	assert.Equal(t, uint32(42), ent.ID)
	assert.Equal(t, "unit", ent.Type)
	assert.Equal(t, "Squad Leader", ent.Name)
	assert.Equal(t, "GUER", ent.Side)
	assert.Equal(t, "Alpha", ent.Group)
	assert.Equal(t, "Leader", ent.Role)
	assert.Equal(t, uint32(10), ent.StartFrame)
	assert.Equal(t, uint32(450), ent.EndFrame)
	assert.True(t, ent.IsPlayer)
	assert.Empty(t, ent.VehicleClass)
}

