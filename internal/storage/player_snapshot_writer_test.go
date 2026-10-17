package storage

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/proto"

	pbv1 "github.com/OCAP2/web/pkg/schemas/protobuf/v1"
)

// The manifest writer and the sidecars have to agree: whatever leaves the
// manifest must be indexed by snapshot_unit_ids and exist on disk, or the UI
// asks for a file that was never written when a profile card opens.
func TestProtobufWriterV1MovesPlayerSnapshotsToSidecars(t *testing.T) {
	dir := t.TempDir()

	w := &ProtobufWriterV1{}
	result := &ParseResult{
		WorldName: "altis", MissionName: "snapshot writer", EndFrame: 99, ChunkSize: 50,
		Events: []Event{
			{FrameNum: 1, Type: "serverFps", Message: `{"fps":48}`},
			{FrameNum: 1, Type: "weather", Message: `{"overcast":0.4,"rain":0,"fog":0.1,"moonPhase":0.8}`},
			{FrameNum: 1, Type: "tfarSettings", Message: `{"terrainInterceptionCoefficient":7,"globalRadioRangeCoef":1}`},
			{FrameNum: 1, Type: "acreSettings", Message: `{"terrainLoss":1,"signalModel":2}`},
			{FrameNum: 5, Type: "inventorySnapshot", Message: `{"unitId":7,"massUnits":695}`},
			{FrameNum: 9, Type: "medicalSnapshot", Message: `{"unitId":12,"ace":{"heartRate":80}}`},
			{FrameNum: 20, Type: "killed", Message: "killed by explosion"},
			{FrameNum: 40, Type: "radioSnapshot", Message: `{"unitId":7,"radios":[{"class":"TFAR_anprc152","rangeMeters":5000}]}`},
			{FrameNum: 60, Type: "inventorySnapshot", Message: `{"unitId":7,"diffOf":5,"set":{"massUnits":700}}`},
			{FrameNum: 80, Type: "staminaSnapshot", Message: `{"unitId":7,"vanilla":{"stance":3}}`},
		},
	}

	require.NoError(t, w.WriteManifest(context.Background(), dir, result))

	data, err := os.ReadFile(filepath.Join(dir, "manifest.pb"))
	require.NoError(t, err)
	var manifest pbv1.Manifest
	require.NoError(t, proto.Unmarshal(data, &manifest))

	// The four per-player kinds are gone from the manifest; the global samples
	// and the ordinary events every reader needs are still there.
	kept := map[string]int{}
	for _, e := range manifest.Events {
		assert.False(t, IsPlayerSnapshotEvent(e.Type), "player snapshot %s left in manifest", e.Type)
		kept[e.Type]++
	}
	assert.Equal(t, map[string]int{"serverFps": 1, "weather": 1, "tfarSettings": 1, "acreSettings": 1, "killed": 1}, kept)

	require.Equal(t, []uint32{7, 12}, manifest.SnapshotUnitIds)
	for _, unitID := range manifest.SnapshotUnitIds {
		assert.FileExists(t, filepath.Join(dir, SnapshotsDirName, snapshotFileName(unitID)))
	}

	series := readSnapshotSeries(t, dir, 7)
	assert.Equal(t, uint32(7), series.UnitId)
	require.Len(t, series.Events, 4)
	// Recorded order is preserved within a unit so the diff chain rebuilds.
	assert.Equal(t, []uint32{5, 40, 60, 80}, []uint32{
		series.Events[0].FrameNum, series.Events[1].FrameNum,
		series.Events[2].FrameNum, series.Events[3].FrameNum,
	})
	assert.Equal(t, `{"unitId":7,"diffOf":5,"set":{"massUnits":700}}`, series.Events[2].Message)

	single := readSnapshotSeries(t, dir, 12)
	assert.Equal(t, uint32(12), single.UnitId)
	require.Len(t, single.Events, 1)
	assert.Equal(t, "medicalSnapshot", single.Events[0].Type)
}

// A recording made before this feature, or by a server with the trackers off,
// must produce exactly the manifest it always did: no index, no sidecar
// directory, nothing an older reader would trip over.
func TestProtobufWriterV1WithoutSnapshotsIsUnchanged(t *testing.T) {
	dir := t.TempDir()

	w := &ProtobufWriterV1{}
	result := &ParseResult{
		WorldName: "altis", MissionName: "no snapshots", EndFrame: 99, ChunkSize: 50,
		Events: []Event{
			{FrameNum: 10, Type: "hit", SourceID: 0, TargetID: 1, Weapon: "rifle"},
			{FrameNum: 20, Type: "killed", SourceID: 0, TargetID: 1},
		},
	}

	require.NoError(t, w.WriteManifest(context.Background(), dir, result))

	data, err := os.ReadFile(filepath.Join(dir, "manifest.pb"))
	require.NoError(t, err)
	var manifest pbv1.Manifest
	require.NoError(t, proto.Unmarshal(data, &manifest))

	require.Len(t, manifest.Events, 2)
	assert.Empty(t, manifest.SnapshotUnitIds)
	assert.NoDirExists(t, filepath.Join(dir, SnapshotsDirName))
}

// A snapshot the server never stamped with a unitId has no sidecar to live in,
// so it stays in the manifest rather than being dropped from the recording.
func TestProtobufWriterV1KeepsUnattributedSnapshotsInManifest(t *testing.T) {
	dir := t.TempDir()

	w := &ProtobufWriterV1{}
	result := &ParseResult{
		WorldName: "altis", MissionName: "unattributed", EndFrame: 9, ChunkSize: 10,
		Events: []Event{
			{FrameNum: 1, Type: "inventorySnapshot", Message: `{"massUnits":695}`},
			{FrameNum: 2, Type: "medicalSnapshot", Message: `{"unitId":-1}`},
			{FrameNum: 3, Type: "staminaSnapshot", Message: `{"unitId":4}`},
		},
	}

	require.NoError(t, w.WriteManifest(context.Background(), dir, result))

	data, err := os.ReadFile(filepath.Join(dir, "manifest.pb"))
	require.NoError(t, err)
	var manifest pbv1.Manifest
	require.NoError(t, proto.Unmarshal(data, &manifest))

	require.Len(t, manifest.Events, 2)
	assert.Equal(t, uint32(1), manifest.Events[0].FrameNum)
	assert.Equal(t, uint32(2), manifest.Events[1].FrameNum)
	assert.Equal(t, []uint32{4}, manifest.SnapshotUnitIds)
}

func snapshotFileName(unitID uint32) string {
	return fmt.Sprintf("%d.pb", unitID)
}

func readSnapshotSeries(t *testing.T, dir string, unitID uint32) *pbv1.PlayerSnapshotSeries {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(dir, SnapshotsDirName, snapshotFileName(unitID)))
	require.NoError(t, err)
	var series pbv1.PlayerSnapshotSeries
	require.NoError(t, proto.Unmarshal(data, &series))
	return &series
}
