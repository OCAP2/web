package storage

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	"google.golang.org/protobuf/proto"

	pbv1 "github.com/OCAP2/web/pkg/schemas/protobuf/v1"
)

// SnapshotsDirName holds the per-player snapshot sidecars written next to the
// manifest and the chunks directory.
const SnapshotsDirName = "snapshots"

// playerSnapshotEventTypes are the additive event types recorded per player.
// They are the bulk of a recording's event stream but the profile card reads
// one unit at a time, so the protobuf writer moves them out of the manifest
// into snapshots/<unitId>.pb and the UI fetches the one series it needs.
//
// serverFps, weather, tfarSettings, acreSettings and the Zeus events are
// deliberately absent: they are needed for map-wide playback (Stats, range
// circles, VIRTUAL faction, camera cones, pings, modules) without selecting a
// unit, so they stay in the manifest.
var playerSnapshotEventTypes = map[string]struct{}{
	"inventorySnapshot": {},
	"medicalSnapshot":   {},
	"staminaSnapshot":   {},
	"radioSnapshot":     {},
}

// IsPlayerSnapshotEvent reports whether an event type is a per-player snapshot.
func IsPlayerSnapshotEvent(eventType string) bool {
	_, ok := playerSnapshotEventTypes[eventType]
	return ok
}

// snapshotUnitID reads the unitId the server stamped onto a snapshot payload.
// Both full snapshots and diffs carry it at the top level. A payload without a
// usable unitId cannot be filed under a player, so it is left in the manifest
// where the existing decoders still see it.
func snapshotUnitID(message string) (uint32, bool) {
	if message == "" {
		return 0, false
	}
	var payload struct {
		UnitID *float64 `json:"unitId"`
	}
	if err := json.Unmarshal([]byte(message), &payload); err != nil {
		return 0, false
	}
	if payload.UnitID == nil || *payload.UnitID < 0 {
		return 0, false
	}
	return uint32(*payload.UnitID), true
}

// SplitPlayerSnapshots partitions events into those that stay in the manifest
// and those that move to a per-unit sidecar. Recorded order is preserved within
// each series, which is what the diff chain rebuild depends on.
func SplitPlayerSnapshots(events []*pbv1.Event) (manifest []*pbv1.Event, byUnit map[uint32][]*pbv1.Event) {
	byUnit = make(map[uint32][]*pbv1.Event)
	for _, e := range events {
		if e == nil {
			continue
		}
		if !IsPlayerSnapshotEvent(e.Type) {
			manifest = append(manifest, e)
			continue
		}
		unitID, ok := snapshotUnitID(e.Message)
		if !ok {
			manifest = append(manifest, e)
			continue
		}
		byUnit[unitID] = append(byUnit[unitID], e)
	}
	return manifest, byUnit
}

// SortedUnitIDs returns the unit ids of a snapshot map in ascending order, for
// the manifest's snapshot_unit_ids index.
func SortedUnitIDs(byUnit map[uint32][]*pbv1.Event) []uint32 {
	if len(byUnit) == 0 {
		return nil
	}
	ids := make([]uint32, 0, len(byUnit))
	for id := range byUnit {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	return ids
}

// WritePlayerSnapshots writes one PlayerSnapshotSeries file per unit under
// outputPath/snapshots. Nothing is written when there are no snapshots, so a
// recording without the feature gains no empty directory.
func WritePlayerSnapshots(outputPath string, byUnit map[uint32][]*pbv1.Event) error {
	if len(byUnit) == 0 {
		return nil
	}

	dir := filepath.Join(outputPath, SnapshotsDirName)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("create snapshots directory: %w", err)
	}

	for _, unitID := range SortedUnitIDs(byUnit) {
		series := &pbv1.PlayerSnapshotSeries{
			UnitId: unitID,
			Events: byUnit[unitID],
		}
		data, err := proto.Marshal(series)
		if err != nil {
			return fmt.Errorf("marshal snapshots for unit %d: %w", unitID, err)
		}
		path := filepath.Join(dir, fmt.Sprintf("%d.pb", unitID))
		if err := WriteArtifact(path, data); err != nil {
			return fmt.Errorf("write snapshots for unit %d: %w", unitID, err)
		}
	}

	return nil
}
