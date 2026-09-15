package storage

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/proto"

	pbv1 "github.com/OCAP2/web/pkg/schemas/protobuf/v1"
)

func snapshotEvent(frame uint32, eventType, message string) *pbv1.Event {
	return &pbv1.Event{FrameNum: frame, Type: eventType, Message: message}
}

func TestSplitPlayerSnapshots(t *testing.T) {
	events := []*pbv1.Event{
		snapshotEvent(1, "serverFps", `{"fps":48}`),
		snapshotEvent(1, "weather", `{"overcast":0.4,"moonPhase":0.8}`),
		snapshotEvent(5, "inventorySnapshot", `{"unitId":7,"massUnits":695}`),
		snapshotEvent(6, "killed", ""),
		snapshotEvent(9, "medicalSnapshot", `{"unitId":12,"ace":{"heartRate":80}}`),
		snapshotEvent(20, "inventorySnapshot", `{"unitId":7,"diffOf":5,"set":{"massUnits":700}}`),
		snapshotEvent(30, "tfarSettings", `{"terrainInterceptionCoefficient":7}`),
		snapshotEvent(12, "zeusEntity", `{"curatorId":90,"name":"Danny"}`),
		snapshotEvent(13, "zeusCamera", `{"curatorId":90,"x":1,"y":2,"dir":90,"fov":0.75}`),
	}

	manifest, byUnit := SplitPlayerSnapshots(events)

	// Global events stay where every reader already looks for them.
	require.Len(t, manifest, 6)
	require.Equal(t, "serverFps", manifest[0].Type)
	require.Equal(t, "weather", manifest[1].Type)
	require.Equal(t, "killed", manifest[2].Type)
	require.Equal(t, "tfarSettings", manifest[3].Type)
	require.Equal(t, "zeusEntity", manifest[4].Type)
	require.Equal(t, "zeusCamera", manifest[5].Type)

	require.Equal(t, []uint32{7, 12}, SortedUnitIDs(byUnit))
	require.Len(t, byUnit[7], 2)
	require.Len(t, byUnit[12], 1)

	// Recorded order is preserved so the diff chain still rebuilds.
	require.Equal(t, uint32(5), byUnit[7][0].FrameNum)
	require.Equal(t, uint32(20), byUnit[7][1].FrameNum)
}

// A snapshot the server never stamped with a unitId cannot be filed under a
// player, so it stays in the manifest where the decoders still reach it.
func TestSplitPlayerSnapshotsKeepsUnattributedInManifest(t *testing.T) {
	events := []*pbv1.Event{
		snapshotEvent(5, "inventorySnapshot", `{"massUnits":695}`),
		snapshotEvent(6, "staminaSnapshot", `not json`),
		snapshotEvent(7, "radioSnapshot", ""),
		snapshotEvent(8, "medicalSnapshot", `{"unitId":3}`),
	}

	manifest, byUnit := SplitPlayerSnapshots(events)

	require.Len(t, manifest, 3)
	require.Equal(t, []uint32{3}, SortedUnitIDs(byUnit))
}

func TestWritePlayerSnapshotsRoundTrip(t *testing.T) {
	dir := t.TempDir()
	byUnit := map[uint32][]*pbv1.Event{
		7: {
			snapshotEvent(5, "inventorySnapshot", `{"unitId":7,"massUnits":695}`),
			snapshotEvent(20, "inventorySnapshot", `{"unitId":7,"diffOf":5,"set":{"massUnits":700}}`),
		},
		12: {snapshotEvent(9, "medicalSnapshot", `{"unitId":12}`)},
	}

	require.NoError(t, WritePlayerSnapshots(dir, byUnit))

	data, err := os.ReadFile(filepath.Join(dir, SnapshotsDirName, "7.pb"))
	require.NoError(t, err)

	var series pbv1.PlayerSnapshotSeries
	require.NoError(t, proto.Unmarshal(data, &series))
	require.Equal(t, uint32(7), series.UnitId)
	require.Len(t, series.Events, 2)
	require.Equal(t, `{"unitId":7,"massUnits":695}`, series.Events[0].Message)
	require.Equal(t, uint32(20), series.Events[1].FrameNum)

	require.FileExists(t, filepath.Join(dir, SnapshotsDirName, "12.pb"))
}

// A recording without the feature must not grow an empty snapshots directory.
func TestWritePlayerSnapshotsNoSnapshots(t *testing.T) {
	dir := t.TempDir()
	require.NoError(t, WritePlayerSnapshots(dir, nil))
	require.NoDirExists(t, filepath.Join(dir, SnapshotsDirName))
}

// End-to-end through the streaming converter: snapshots leave the manifest,
// land in per-unit sidecars, and the manifest indexes exactly those units.
func TestConverterWritesPlayerSnapshotSidecars(t *testing.T) {
	dir := t.TempDir()
	jsonPath := filepath.Join(dir, "mission.json")
	outputPath := filepath.Join(dir, "mission")

	recording := `{
		"worldName": "altis",
		"missionName": "snapshot test",
		"endFrame": 20,
		"captureDelay": 1,
		"entities": [
			{"id": 7, "type": "unit", "name": "Alpha", "side": "WEST", "group": "A",
			 "isPlayer": 1, "startFrameNum": 0, "positions": [[[100,100,0],0,1,[],"Alpha",1]]}
		],
		"events": [
			[1, "serverFps", {"fps": 48}],
			[1, "weather", {"overcast": 0.4, "moonPhase": 0.8, "ace": false}],
			[2, "zeusEntity", {"curatorId": 90, "name": "Danny", "playerUid": "7656", "bodyUnitId": -1}],
			[3, "zeusCamera", {"curatorId": 90, "x": 100, "y": 200, "dir": 90, "fov": 0.75}],
			[4, "zeusRemoteControl", {"curatorId": 90, "unitId": 7, "active": true}],
			[4, "zeusModule", {"curatorId": 90, "curatorName": "Danny", "className": "zen_modules_moduleHeal", "displayName": "Heal", "x": 100, "y": 200}],
			[5, "inventorySnapshot", {"unitId": 7, "massUnits": 695}],
			[6, "killed", [7, 7, "rifle", 10]],
			[9, "medicalSnapshot", {"unitId": 12, "ace": {"heartRate": 80}}],
			[20, "inventorySnapshot", {"unitId": 7, "diffOf": 5, "set": {"massUnits": 700}}]
		],
		"Markers": [],
		"times": []
	}`
	require.NoError(t, os.WriteFile(jsonPath, []byte(recording), 0644))

	require.NoError(t, NewConverter(10).Convert(context.Background(), jsonPath, outputPath))

	data, err := os.ReadFile(filepath.Join(outputPath, "manifest.pb"))
	require.NoError(t, err)
	var manifest pbv1.Manifest
	require.NoError(t, proto.Unmarshal(data, &manifest))

	require.Equal(t, []uint32{7, 12}, manifest.SnapshotUnitIds)
	for _, e := range manifest.Events {
		require.False(t, IsPlayerSnapshotEvent(e.Type), "player snapshot %s left in manifest", e.Type)
	}
	// The global samples are untouched by the split.
	var sawFps, sawWeather bool
	for _, e := range manifest.Events {
		if e.Type == "serverFps" {
			sawFps = true
		}
		if e.Type == "weather" {
			sawWeather = true
		}
	}
	require.True(t, sawFps, "serverFps must stay in the manifest")
	require.True(t, sawWeather, "weather must stay in the manifest")
	var sawZeus int
	for _, e := range manifest.Events {
		if e.Type == "zeusEntity" || e.Type == "zeusCamera" || e.Type == "zeusRemoteControl" || e.Type == "zeusModule" {
			sawZeus++
			require.NotEmpty(t, e.Message, "%s lost its JSON payload", e.Type)
		}
	}
	require.Equal(t, 4, sawZeus, "Zeus events must stay in the protobuf manifest")

	data, err = os.ReadFile(filepath.Join(outputPath, SnapshotsDirName, "7.pb"))
	require.NoError(t, err)
	var series pbv1.PlayerSnapshotSeries
	require.NoError(t, proto.Unmarshal(data, &series))
	require.Equal(t, uint32(7), series.UnitId)
	require.Len(t, series.Events, 2)
	require.Contains(t, series.Events[1].Message, `"diffOf":5`)
}
