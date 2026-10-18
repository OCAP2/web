package conversion

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/OCAP2/web/internal/storage"
	pb "github.com/OCAP2/web/pkg/schemas/protobuf/v2"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/proto"
)

func TestNativeV2SurvivesLegacyConversionAndStatsBackfill(t *testing.T) {
	dir := t.TempDir()
	output := filepath.Join(dir, "native")
	require.NoError(t, os.MkdirAll(output, 0755))
	data, err := proto.Marshal(&pb.Manifest{Version: 2, FrameCount: 10, CaptureDelayMs: 1000, Soldiers: []*pb.SoldierDef{{Id: 1, Name: "Player", IsPlayer: true, Side: pb.Side_SIDE_WEST}}, Events: []*pb.Event{{FrameNum: 5, Event: &pb.Event_Kill{Kill: &pb.KillEvent{KillerSoldierId: 1, VictimSoldierId: 1}}}}})
	require.NoError(t, err)
	manifestPath := filepath.Join(output, "manifest.pb")
	require.NoError(t, os.WriteFile(manifestPath, data, 0600))
	repo := newMockRepo()
	w := NewWorker(repo, Config{DataDir: dir})
	require.NoError(t, w.ConvertOne(context.Background(), 1, "native"))
	require.Equal(t, "completed", repo.status[1])
	require.Empty(t, repo.format)
	require.NoError(t, w.ComputeStatsFor(context.Background(), 1, "native"))
	require.Equal(t, "1", repo.stats[1][0])
	require.Equal(t, "1", repo.stats[1][1])
	require.Error(t, storage.NewProtobufEngine(dir).Convert(context.Background(), "unused.json.gz", output))
	after, err := os.ReadFile(manifestPath)
	require.NoError(t, err)
	require.Equal(t, data, after)
}
