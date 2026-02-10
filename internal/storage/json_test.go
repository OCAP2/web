// server/storage/json_test.go
package storage

import (
	"compress/gzip"
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestJSONEngineBasics(t *testing.T) {
	engine := NewJSONEngine("/tmp")

	assert.False(t, engine.SupportsStreaming())
}

func TestJSONEngineGetManifest(t *testing.T) {
	dir := t.TempDir()

	// Create test JSON file
	testData := `{
		"worldName": "altis",
		"missionName": "Test Mission",
		"endFrame": 100,
		"captureDelay": 1,
		"entities": [
			{"id": 0, "type": "unit", "name": "Player1", "side": "WEST", "group": "Alpha", "startFrameNum": 0, "isPlayer": 1, "positions": [], "framesFired": []},
			{"id": 1, "type": "vehicle", "name": "Truck", "class": "B_Truck_01_transport_F", "startFrameNum": 0, "positions": []}
		],
		"events": [],
		"Markers": []
	}`

	err := os.WriteFile(filepath.Join(dir, "test.json"), []byte(testData), 0644)
	require.NoError(t, err)

	engine := NewJSONEngine(dir)
	ctx := context.Background()

	manifest, err := engine.GetManifest(ctx, "test")
	require.NoError(t, err)
	assert.Equal(t, "altis", manifest.WorldName)
	assert.Equal(t, "Test Mission", manifest.MissionName)
	assert.Equal(t, uint32(100), manifest.FrameCount)
	assert.Equal(t, uint32(1000), manifest.CaptureDelayMs)
	assert.Len(t, manifest.Entities, 2)

	// Check unit
	assert.Equal(t, "unit", manifest.Entities[0].Type)
	assert.Equal(t, "Player1", manifest.Entities[0].Name)
	assert.Equal(t, "WEST", manifest.Entities[0].Side)
	assert.True(t, manifest.Entities[0].IsPlayer)

	// Check vehicle
	assert.Equal(t, "vehicle", manifest.Entities[1].Type)
	assert.Equal(t, "Truck", manifest.Entities[1].Name)
	assert.Equal(t, "B_Truck_01_transport_F", manifest.Entities[1].VehicleClass)
}

func TestJSONEngineGetManifestGzipped(t *testing.T) {
	dir := t.TempDir()

	// Create gzipped test JSON file
	testData := `{
		"worldName": "tanoa",
		"missionName": "Gzipped Mission",
		"endFrame": 500,
		"captureDelay": 0.5,
		"entities": [
			{"id": 0, "type": "unit", "name": "Operator", "side": "GUER", "group": "Bravo", "startFrameNum": 10, "isPlayer": 0}
		]
	}`

	gzPath := filepath.Join(dir, "gztest.json.gz")
	f, err := os.Create(gzPath)
	require.NoError(t, err)

	gw := gzip.NewWriter(f)
	_, err = gw.Write([]byte(testData))
	require.NoError(t, err)
	require.NoError(t, gw.Close())
	require.NoError(t, f.Close())

	engine := NewJSONEngine(dir)
	ctx := context.Background()

	manifest, err := engine.GetManifest(ctx, "gztest")
	require.NoError(t, err)
	assert.Equal(t, "tanoa", manifest.WorldName)
	assert.Equal(t, "Gzipped Mission", manifest.MissionName)
	assert.Equal(t, uint32(500), manifest.FrameCount)
	assert.Equal(t, uint32(500), manifest.CaptureDelayMs) // 0.5 * 1000
	assert.Len(t, manifest.Entities, 1)

	// Check entity
	assert.Equal(t, "Operator", manifest.Entities[0].Name)
	assert.Equal(t, "GUER", manifest.Entities[0].Side)
	assert.Equal(t, uint32(10), manifest.Entities[0].StartFrame)
	assert.False(t, manifest.Entities[0].IsPlayer)
}

func TestJSONEngineNotFound(t *testing.T) {
	engine := NewJSONEngine(t.TempDir())

	_, err := engine.GetManifest(context.Background(), "nonexistent")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "recording not found")
}

func TestJSONEngineChunkedNotSupported(t *testing.T) {
	engine := NewJSONEngine(t.TempDir())
	ctx := context.Background()

	_, err := engine.GetChunk(ctx, "test", 0)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "does not support")

	_, err = engine.GetChunkReader(ctx, "test", 0)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "does not support")

	err = engine.Convert(ctx, "input", "output")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "does not support")
}

func TestJSONEngineEmptyEntities(t *testing.T) {
	dir := t.TempDir()

	// Create test JSON file with no entities
	testData := `{
		"worldName": "stratis",
		"missionName": "Empty Mission",
		"endFrame": 50,
		"captureDelay": 2
	}`

	err := os.WriteFile(filepath.Join(dir, "empty.json"), []byte(testData), 0644)
	require.NoError(t, err)

	engine := NewJSONEngine(dir)
	ctx := context.Background()

	manifest, err := engine.GetManifest(ctx, "empty")
	require.NoError(t, err)
	assert.Equal(t, "stratis", manifest.WorldName)
	assert.Equal(t, uint32(50), manifest.FrameCount)
	assert.Empty(t, manifest.Entities)
}

func TestJSONEngineGetManifestReader(t *testing.T) {
	engine := NewJSONEngine(t.TempDir())
	ctx := context.Background()

	// JSON engine does not support raw manifest streaming
	reader, err := engine.GetManifestReader(ctx, "test")
	assert.Nil(t, reader)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "does not support")
}

func TestHelperFunctions(t *testing.T) {
	m := map[string]interface{}{
		"stringVal": "hello",
		"floatVal":  42.5,
		"intVal":    100.0, // JSON numbers are float64
	}

	assert.Equal(t, "hello", getString(m, "stringVal"))
	assert.Equal(t, "", getString(m, "missing"))
	assert.Equal(t, "", getString(m, "floatVal")) // wrong type

	assert.Equal(t, 42.5, getFloat64(m, "floatVal"))
	assert.Equal(t, 0.0, getFloat64(m, "missing"))
	assert.Equal(t, 0.0, getFloat64(m, "stringVal")) // wrong type

	assert.Equal(t, uint32(100), getUint32(m, "intVal"))
	assert.Equal(t, uint32(0), getUint32(m, "missing"))
}

func TestJSONEngineInvalidGzip(t *testing.T) {
	dir := t.TempDir()

	// Create a file with .gz extension but invalid gzip data
	invalidGzPath := filepath.Join(dir, "invalid.json.gz")
	err := os.WriteFile(invalidGzPath, []byte("not valid gzip data"), 0644)
	require.NoError(t, err)

	engine := NewJSONEngine(dir)
	_, err = engine.GetManifest(context.Background(), "invalid")
	assert.Error(t, err)
}

func TestJSONEngineInvalidJSONInGzip(t *testing.T) {
	dir := t.TempDir()

	// Create gzipped file with invalid JSON content
	gzPath := filepath.Join(dir, "badjson.json.gz")
	f, err := os.Create(gzPath)
	require.NoError(t, err)

	gw := gzip.NewWriter(f)
	_, err = gw.Write([]byte("{ invalid json }"))
	require.NoError(t, err)
	require.NoError(t, gw.Close())
	require.NoError(t, f.Close())

	engine := NewJSONEngine(dir)
	_, err = engine.GetManifest(context.Background(), "badjson")
	assert.Error(t, err)
}

func TestJSONEngineInvalidJSON(t *testing.T) {
	dir := t.TempDir()

	// Create plain JSON file with invalid content
	jsonPath := filepath.Join(dir, "invalid.json")
	err := os.WriteFile(jsonPath, []byte("{ this is not valid json }"), 0644)
	require.NoError(t, err)

	engine := NewJSONEngine(dir)
	_, err = engine.GetManifest(context.Background(), "invalid")
	assert.Error(t, err)
}

func TestJSONEngineEntityWithNoType(t *testing.T) {
	dir := t.TempDir()

	// Create test JSON with entity that has non-map type in entities array
	testData := `{
		"worldName": "altis",
		"missionName": "Test",
		"endFrame": 10,
		"captureDelay": 1,
		"entities": [
			"not a map",
			{"id": 0, "type": "unit", "name": "Player1"}
		]
	}`

	err := os.WriteFile(filepath.Join(dir, "badentity.json"), []byte(testData), 0644)
	require.NoError(t, err)

	engine := NewJSONEngine(dir)
	manifest, err := engine.GetManifest(context.Background(), "badentity")
	require.NoError(t, err)
	// Only valid entity should be parsed
	assert.Len(t, manifest.Entities, 1)
	assert.Equal(t, "Player1", manifest.Entities[0].Name)
}

func TestJSONEngineEntitiesNotArray(t *testing.T) {
	dir := t.TempDir()

	// Create test JSON with entities not being an array
	testData := `{
		"worldName": "altis",
		"missionName": "Test",
		"endFrame": 10,
		"captureDelay": 1,
		"entities": "not an array"
	}`

	err := os.WriteFile(filepath.Join(dir, "badentities.json"), []byte(testData), 0644)
	require.NoError(t, err)

	engine := NewJSONEngine(dir)
	manifest, err := engine.GetManifest(context.Background(), "badentities")
	require.NoError(t, err)
	// Should have no entities since parsing skips invalid format
	assert.Empty(t, manifest.Entities)
}
