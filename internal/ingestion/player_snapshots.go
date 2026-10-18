package ingestion

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	v1 "github.com/OCAP2/web/pkg/schemas/protobuf/v1"
	v2 "github.com/OCAP2/web/pkg/schemas/protobuf/v2"
	"google.golang.org/protobuf/proto"
)

// Reuse the existing sidecar wire format and HTTP endpoint. Large player
// snapshots are fetched per player, keeping v2 startup downloads small too.
func writePlayerSnapshots(dir string, m *v2.Manifest) error {
	byUnit := make(map[uint32]*v1.PlayerSnapshotSeries)
	var events []*v2.Event
	for _, e := range m.Events {
		g := e.GetGeneral()
		if g == nil {
			events = append(events, e)
			continue
		}
		switch g.Name {
		case "inventorySnapshot", "medicalSnapshot", "staminaSnapshot", "radioSnapshot":
		default:
			events = append(events, e)
			continue
		}
		var p struct {
			UnitID *uint32 `json:"unitId"`
		}
		if json.Unmarshal([]byte(g.Message), &p) != nil || p.UnitID == nil {
			events = append(events, e)
			continue
		}
		id := *p.UnitID
		if byUnit[id] == nil {
			byUnit[id] = &v1.PlayerSnapshotSeries{UnitId: id}
		}
		byUnit[id].Events = append(byUnit[id].Events, &v1.Event{FrameNum: e.FrameNum, Type: g.Name, Message: g.Message})
	}
	if len(byUnit) == 0 {
		return nil
	}
	snapDir := filepath.Join(dir, "snapshots")
	if err := os.MkdirAll(snapDir, 0755); err != nil {
		return err
	}
	for id, series := range byUnit {
		sort.SliceStable(series.Events, func(i, j int) bool { return series.Events[i].FrameNum < series.Events[j].FrameNum })
		data, err := proto.Marshal(series)
		if err != nil {
			return err
		}
		if err := writeAtomic(filepath.Join(snapDir, fmt.Sprintf("%d.pb", id)), data); err != nil {
			return err
		}
		m.SnapshotUnitIds = append(m.SnapshotUnitIds, id)
	}
	sort.Slice(m.SnapshotUnitIds, func(i, j int) bool { return m.SnapshotUnitIds[i] < m.SnapshotUnitIds[j] })
	m.Events = events
	return nil
}
