package server

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/proto"

	"github.com/OCAP2/web/internal/storage"
	pbv1 "github.com/OCAP2/web/pkg/schemas/protobuf/v1"
)

// The profile card fetches snapshots/<unitId>.pb over the same /data route the
// manifest and chunks use, once, when a player is opened. The bytes have to
// come back intact and unencoded so protobuf decoding on the UI side works.
func TestGetDataServesPlayerSnapshotSidecar(t *testing.T) {
	dataDir := t.TempDir()
	missionDir := filepath.Join(dataDir, "snapshot_mission")
	snapshotsDir := filepath.Join(missionDir, storage.SnapshotsDirName)
	require.NoError(t, os.MkdirAll(snapshotsDir, 0755))

	series := &pbv1.PlayerSnapshotSeries{
		UnitId: 7,
		Events: []*pbv1.Event{
			{FrameNum: 5, Type: "inventorySnapshot", Message: `{"unitId":7,"massUnits":695}`},
			{FrameNum: 60, Type: "inventorySnapshot", Message: `{"unitId":7,"diffOf":5,"set":{"massUnits":700}}`},
		},
	}
	encoded, err := proto.Marshal(series)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(snapshotsDir, "7.pb"), encoded, 0644))

	hdlr := Handler{setting: Setting{Data: dataDir}}

	t.Run("serves the series for a unit that has one", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/data/snapshot_mission/snapshots/7.pb", nil)
		req.SetPathValue("path", "snapshot_mission/snapshots/7.pb")
		rec := httptest.NewRecorder()

		hdlr.GetData(rec, req)
		require.Equal(t, http.StatusOK, rec.Code)
		assert.Empty(t, rec.Header().Get("Content-Encoding"))

		var decoded pbv1.PlayerSnapshotSeries
		require.NoError(t, proto.Unmarshal(rec.Body.Bytes(), &decoded))
		assert.Equal(t, uint32(7), decoded.UnitId)
		require.Len(t, decoded.Events, 2)
		assert.Equal(t, `{"unitId":7,"diffOf":5,"set":{"massUnits":700}}`, decoded.Events[1].Message)
	})

	// A unit with no snapshots has no sidecar. The card logs the miss and keeps
	// playing, so a 404 here is the expected, non-fatal answer.
	t.Run("404 for a unit without a sidecar", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/data/snapshot_mission/snapshots/99.pb", nil)
		req.SetPathValue("path", "snapshot_mission/snapshots/99.pb")
		rec := httptest.NewRecorder()

		hdlr.GetData(rec, req)
		assert.Equal(t, http.StatusNotFound, rec.Code)
	})

	// A recording made before the feature has no snapshots directory at all.
	t.Run("404 when the recording has no snapshots directory", func(t *testing.T) {
		require.NoError(t, os.MkdirAll(filepath.Join(dataDir, "old_mission"), 0755))
		req := httptest.NewRequest(http.MethodGet, "/data/old_mission/snapshots/7.pb", nil)
		req.SetPathValue("path", "old_mission/snapshots/7.pb")
		rec := httptest.NewRecorder()

		hdlr.GetData(rec, req)
		assert.Equal(t, http.StatusNotFound, rec.Code)
	})

	// The unit id goes into the URL from the UI, so the sidecar route must not
	// become a way out of the data directory.
	t.Run("path traversal through the snapshots directory is blocked", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/data/snapshot_mission/snapshots/../../../etc/passwd", nil)
		req.SetPathValue("path", "snapshot_mission/snapshots/../../../etc/passwd")
		rec := httptest.NewRecorder()

		hdlr.GetData(rec, req)
		assert.Equal(t, http.StatusNotFound, rec.Code)
	})
}
