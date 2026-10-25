package ingestion

import (
	"strings"
	"testing"

	"github.com/OCAP2/extension/v5/pkg/core"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ptr returns a pointer to v, for the optional id fields on projectile events.
func ptr[T any](v T) *T { return &v }

func TestExtractFilename(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"empty", "", ""},
		{"no separator", "rocket.paa", "rocket.paa"},
		{"backslash (Arma path)", `z\addons\mag_icons\titan.paa`, "titan.paa"},
		{"forward slash", "z/addons/mag_icons/titan.paa", "titan.paa"},
		{"mixed separators", `z\addons/mag_icons\titan.paa`, "titan.paa"},
		{"trailing separator", `z\addons\`, ""},
		{"separator only", `\`, ""},
		{"leading separator", "/absolute", "absolute"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, extractFilename(tc.in))
		})
	}
}

func TestFormatWeaponText(t *testing.T) {
	assert.Equal(t, "M16A4", formatWeaponText("M16A4", ""))
	assert.Equal(t, "M16A4 [30Rnd_556x45]", formatWeaponText("M16A4", "30Rnd_556x45"))
	// Current behaviour, not a requirement: an unresolved weapon still yields the
	// bracket form. Callers resolve a display name first, so this only shows up if
	// the recording carried neither. A formatting fix should update this line.
	assert.Equal(t, " [30Rnd_556x45]", formatWeaponText("", "30Rnd_556x45"))
	assert.Equal(t, "", formatWeaponText("", ""))
}

func TestSession_RocketBecomesMovingMarker(t *testing.T) {
	s := NewSession()
	s.HandleAddSoldier(core.Soldier{ID: 5, DisplayName: "Nosey", OcapType: "unit"})

	s.HandleProjectileEvent(core.ProjectileEvent{
		CaptureFrame:    0,
		FirerObjectID:   5,
		MuzzleDisplay:   "Titan",
		MagazineDisplay: "Titan AP",
		SimulationType:  "shotRocket",
		MagazineIcon:    `z\addons\mag_icons\titan.paa`,
		Trajectory: []core.TrajectoryPoint{
			{FrameNum: 1, Position: core.Position3D{X: 100, Y: 200, Z: 5}},
			{FrameNum: 5, Position: core.Position3D{X: 120, Y: 200, Z: 8}},
			{FrameNum: 9, Position: core.Position3D{X: 140, Y: 200, Z: 12}},
		},
	})

	s.deriveProjectileData()

	rec, ok := s.markers["_projectile_1"]
	require.True(t, ok, "a non-bullet projectile becomes a moving marker")

	assert.Equal(t, "magIcons/titan.paa", rec.Marker.MarkerType)
	assert.Equal(t, "ColorWhite", rec.Marker.Color)
	assert.Equal(t, "Titan - Titan AP", rec.Marker.Text)
	assert.Equal(t, 5, rec.Marker.OwnerID)
	assert.Equal(t, core.Frame(1), rec.Marker.CaptureFrame)
	// The marker lives until the projectile's last known position.
	assert.Equal(t, core.Frame(9), rec.Marker.EndFrame)
	assert.Equal(t, core.Position3D{X: 100, Y: 200, Z: 5}, rec.Marker.Position)

	// The first trajectory point is the marker position; the rest are states.
	require.Len(t, rec.States, 2)
	assert.Equal(t, core.Frame(5), rec.States[0].CaptureFrame)
	assert.InDelta(t, 120, rec.States[0].Position.X, 1e-5)
	assert.Equal(t, core.Frame(9), rec.States[1].CaptureFrame)
}

// Without an equipment icon the marker falls back to a generic red triangle.
func TestSession_ProjectileMarkerWithoutIcon(t *testing.T) {
	s := NewSession()
	s.HandleProjectileEvent(core.ProjectileEvent{
		FirerObjectID:   1,
		MuzzleDisplay:   "Mortar",
		MagazineDisplay: "8Rnd_82mm_Mo_HE",
		SimulationType:  "shotMine",
		Trajectory:      []core.TrajectoryPoint{{FrameNum: 2, Position: core.Position3D{X: 7}}},
	})

	s.deriveProjectileData()

	rec, ok := s.markers["_projectile_1"]
	require.True(t, ok)
	assert.Equal(t, "mil_triangle", rec.Marker.MarkerType)
	assert.Equal(t, "ColorRed", rec.Marker.Color)
	assert.Equal(t, "Mortar - 8Rnd_82mm_Mo_HE", rec.Marker.Text)
	assert.Empty(t, rec.States, "a single trajectory point carries no extra states")
}

// Grenades show only the magazine, which reads better than a duplicated
// launcher/muzzle prefix.
func TestSession_GrenadeMarkerTextIsMagazineOnly(t *testing.T) {
	s := NewSession()
	s.HandleProjectileEvent(core.ProjectileEvent{
		FirerObjectID:   1,
		MuzzleDisplay:   "",
		MagazineDisplay: "Hand Grenade",
		SimulationType:  "shotGrenade",
		Trajectory:      []core.TrajectoryPoint{{FrameNum: 3}},
	})

	s.deriveProjectileData()

	rec, ok := s.markers["_projectile_1"]
	require.True(t, ok)
	assert.Equal(t, "Hand Grenade", rec.Marker.Text)
}

// A weapon mounted on a vehicle is labelled with the vehicle, so the marker is
// attributable on a crowded map.
func TestSession_ProjectileMarkerFromVehicleNamesVehicle(t *testing.T) {
	s := NewSession()
	s.HandleAddSoldier(core.Soldier{ID: 5, DisplayName: "Nosey", OcapType: "unit"})
	s.HandleAddVehicle(core.Vehicle{ID: 9, DisplayName: "M2A1 Slammer", OcapType: "tank"})

	s.HandleProjectileEvent(core.ProjectileEvent{
		FirerObjectID:   5,
		VehicleObjectID: ptr(uint16(9)),
		MuzzleDisplay:   "20mm AutoCannon",
		MagazineDisplay: "200Rnd_20mm_HE",
		SimulationType:  "shotCannon",
		Trajectory:      []core.TrajectoryPoint{{FrameNum: 1}},
	})

	s.deriveProjectileData()

	rec, ok := s.markers["_projectile_1"]
	require.True(t, ok)
	assert.Equal(t, "M2A1 Slammer 20mm AutoCannon - 200Rnd_20mm_HE", rec.Marker.Text)
}

// An unknown vehicle must not fabricate a name; the marker still renders.
func TestSession_ProjectileMarkerFromUnknownVehicle(t *testing.T) {
	s := NewSession()
	s.HandleProjectileEvent(core.ProjectileEvent{
		FirerObjectID:   5,
		VehicleObjectID: ptr(uint16(99)),
		MuzzleDisplay:   "Autocannon",
		MagazineDisplay: "Mag",
		SimulationType:  "shotCannon",
		Trajectory:      []core.TrajectoryPoint{{FrameNum: 1}},
	})

	s.deriveProjectileData()

	rec, ok := s.markers["_projectile_1"]
	require.True(t, ok)
	// What must not regress is that no name is invented for a vehicle the
	// recording never described. The separator spacing is current formatting, not
	// a requirement, so the surrounding space is not pinned.
	assert.Equal(t, "Autocannon - Mag", strings.TrimSpace(rec.Marker.Text))
}

// The vehicle branch is checked first, so a grenade launched from a mounted
// weapon keeps the vehicle label rather than the grenade shorthand.
func TestSession_ProjectileMarkerVehicleBranchBeatsGrenade(t *testing.T) {
	s := NewSession()
	s.HandleAddVehicle(core.Vehicle{ID: 9, DisplayName: "Offroad", OcapType: "car"})

	s.HandleProjectileEvent(core.ProjectileEvent{
		FirerObjectID:   5,
		VehicleObjectID: ptr(uint16(9)),
		MuzzleDisplay:   "Launcher",
		MagazineDisplay: "Grenade",
		SimulationType:  "shotGrenade",
		Trajectory:      []core.TrajectoryPoint{{FrameNum: 1}},
	})

	s.deriveProjectileData()

	rec, ok := s.markers["_projectile_1"]
	require.True(t, ok)
	assert.Equal(t, "Offroad Launcher - Grenade", rec.Marker.Text)
}

// A projectile fired from the soldier's own vehicle id is not a vehicle weapon.
func TestSession_ProjectileMarkerVehicleEqualToFirerIsNotVehicleText(t *testing.T) {
	s := NewSession()
	s.HandleAddVehicle(core.Vehicle{ID: 5, DisplayName: "ignored", OcapType: "car"})

	s.HandleProjectileEvent(core.ProjectileEvent{
		FirerObjectID:   5,
		VehicleObjectID: ptr(uint16(5)),
		MuzzleDisplay:   "Titan",
		MagazineDisplay: "Titan AP",
		SimulationType:  "shotRocket",
		Trajectory:      []core.TrajectoryPoint{{FrameNum: 1}},
	})

	s.deriveProjectileData()

	rec, ok := s.markers["_projectile_1"]
	require.True(t, ok)
	assert.Equal(t, "Titan - Titan AP", rec.Marker.Text)
}

// The two derivations differ on purpose when the firer is inside the vehicle it
// is carrying: the marker label drops the redundant vehicle prefix, while the
// hit still records the vehicle so the shot is attributable. Pinned so a change
// to either side is a deliberate one.
func TestSession_ProjectileFromOwnVehicleLabelsMarkerButAttributesVehicleHit(t *testing.T) {
	s := NewSession()
	s.HandleAddVehicle(core.Vehicle{ID: 5, DisplayName: "Offroad", OcapType: "car"})

	s.HandleProjectileEvent(core.ProjectileEvent{
		FirerObjectID:   5,
		VehicleObjectID: ptr(uint16(5)),
		MuzzleDisplay:   "Titan",
		MagazineDisplay: "Titan AP",
		SimulationType:  "shotRocket",
		Trajectory:      []core.TrajectoryPoint{{FrameNum: 1, Position: core.Position3D{X: 0, Y: 0}}},
		Hits: []core.ProjectileHit{
			{CaptureFrame: 2, Position: core.Position3D{X: 3, Y: 4}, SoldierID: ptr(uint16(8))},
		},
	})

	s.deriveProjectileData()

	rec, ok := s.markers["_projectile_1"]
	require.True(t, ok)
	assert.Equal(t, "Titan - Titan AP", rec.Marker.Text)

	require.Len(t, s.events, 1)
	hit := s.events[0].hit
	require.NotNil(t, hit)
	require.NotNil(t, hit.ShooterVehicleID)
	assert.Equal(t, uint(5), *hit.ShooterVehicleID)
}

// A trajectory-less projectile carries no position, so no marker can be drawn.
func TestSession_ProjectileWithoutTrajectoryCreatesNoMarker(t *testing.T) {
	s := NewSession()
	s.HandleProjectileEvent(core.ProjectileEvent{
		FirerObjectID:  1,
		SimulationType: "shotRocket",
		MagazineIcon:   "rocket.paa",
	})

	s.deriveProjectileData()

	assert.Empty(t, s.markers)
}

// Marker names are sequential and unique so two projectiles never collide.
func TestSession_ProjectileMarkerNamesAreSequential(t *testing.T) {
	s := NewSession()
	for _, frame := range []core.Frame{1, 20} {
		s.HandleProjectileEvent(core.ProjectileEvent{
			FirerObjectID:   1,
			MuzzleDisplay:   "Titan",
			MagazineDisplay: "Titan AP",
			SimulationType:  "shotRocket",
			Trajectory:      []core.TrajectoryPoint{{FrameNum: frame}},
		})
	}

	s.deriveProjectileData()

	require.Len(t, s.markers, 2)
	assert.Contains(t, s.markers, "_projectile_1")
	assert.Contains(t, s.markers, "_projectile_2")
}

func TestSession_BulletBecomesFireLineNotMarker(t *testing.T) {
	s := NewSession()
	s.HandleAddSoldier(core.Soldier{ID: 5, DisplayName: "Nosey", OcapType: "unit"})

	s.HandleProjectileEvent(core.ProjectileEvent{
		FirerObjectID:  5,
		SimulationType: "shotBullet",
		Trajectory: []core.TrajectoryPoint{
			{FrameNum: 1, Position: core.Position3D{X: 0}},
			{FrameNum: 4, Position: core.Position3D{X: 300}},
		},
	})

	s.deriveProjectileData()

	assert.Empty(t, s.markers, "bullets render as fire lines, not markers")
	rec, ok := s.soldiers[5]
	require.True(t, ok)
	require.Len(t, rec.bulletFireLines, 1)
	assert.Equal(t, core.Frame(4), rec.bulletFireLines[0].Trajectory[1].FrameNum)
}

// A one-point trajectory cannot draw a line, so the bullet is dropped rather
// than stored as a degenerate fire line.
func TestSession_ShortBulletTrajectoryIsNotAFireLine(t *testing.T) {
	s := NewSession()
	s.HandleAddSoldier(core.Soldier{ID: 5, DisplayName: "Nosey", OcapType: "unit"})

	s.HandleProjectileEvent(core.ProjectileEvent{
		FirerObjectID:  5,
		SimulationType: "shotBullet",
		Trajectory:     []core.TrajectoryPoint{{FrameNum: 1}},
	})

	s.deriveProjectileData()

	rec, ok := s.soldiers[5]
	require.True(t, ok)
	assert.Empty(t, rec.bulletFireLines)
	assert.Empty(t, s.markers)
}

// A bullet from an unknown firer must not panic or attach to the wrong soldier.
func TestSession_BulletFromUnknownFirerIsIgnored(t *testing.T) {
	s := NewSession()
	s.HandleProjectileEvent(core.ProjectileEvent{
		FirerObjectID:  404,
		SimulationType: "shotBullet",
		Trajectory: []core.TrajectoryPoint{
			{FrameNum: 1}, {FrameNum: 2},
		},
	})

	require.NotPanics(t, func() { s.deriveProjectileData() })
	assert.Empty(t, s.markers)
	assert.Empty(t, s.soldiers)
}

func TestSession_ProjectileHitsBecomeHitEvents(t *testing.T) {
	s := NewSession()
	s.HandleProjectileEvent(core.ProjectileEvent{
		FirerObjectID:   5,
		MuzzleDisplay:   "Titan",
		MagazineDisplay: "Titan AP",
		SimulationType:  "shotRocket",
		Trajectory: []core.TrajectoryPoint{
			{FrameNum: 1, Position: core.Position3D{X: 0, Y: 0}},
			{FrameNum: 4, Position: core.Position3D{X: 30, Y: 40}},
		},
		Hits: []core.ProjectileHit{
			{CaptureFrame: 4, Position: core.Position3D{X: 30, Y: 40}, SoldierID: ptr(uint16(8))},
		},
	})

	trackedBefore := s.FrameCount()
	s.deriveProjectileData()

	require.Len(t, s.events, 1)
	hit := s.events[0]
	assert.Equal(t, "hit", hit.eventType)
	assert.Equal(t, core.Frame(4), hit.frame)
	require.NotNil(t, hit.hit)

	require.NotNil(t, hit.hit.ShooterSoldierID)
	assert.Equal(t, uint(5), *hit.hit.ShooterSoldierID)
	require.NotNil(t, hit.hit.VictimSoldierID)
	assert.Equal(t, uint(8), *hit.hit.VictimSoldierID)
	assert.Nil(t, hit.hit.VictimVehicleID)
	assert.Nil(t, hit.hit.ShooterVehicleID)

	assert.Equal(t, "Titan", hit.hit.WeaponName)
	assert.Equal(t, "Titan AP", hit.hit.WeaponMagazine)
	assert.Equal(t, "Titan [Titan AP]", hit.hit.EventText)
	// Distance is measured from the first trajectory point to the impact.
	assert.InDelta(t, 50, hit.hit.Distance, 1e-4)

	// Ingestion already tracked the hit frame, so deriving must not move the
	// recording's end.
	assert.Equal(t, core.Frame(5), trackedBefore)
	assert.Equal(t, trackedBefore, s.FrameCount(), "derivation does not change the frame count")
}

// The recording has to reach the impact frame, which matters when a hit lands
// after the last trajectory sample.
func TestSession_ProjectileHitFrameExtendsRecording(t *testing.T) {
	s := NewSession()
	s.HandleProjectileEvent(core.ProjectileEvent{
		FirerObjectID:  5,
		MuzzleDisplay:  "Titan",
		SimulationType: "shotRocket",
		Trajectory: []core.TrajectoryPoint{
			{FrameNum: 1}, {FrameNum: 2}, {FrameNum: 4},
		},
		Hits: []core.ProjectileHit{{CaptureFrame: 40, SoldierID: ptr(uint16(8))}},
	})

	// Tracked as the projectile arrives, well past its final trajectory sample.
	assert.Equal(t, core.Frame(41), s.FrameCount())

	s.deriveProjectileData()

	require.Len(t, s.events, 1)
	assert.Equal(t, core.Frame(40), s.events[0].frame)
	assert.Equal(t, core.Frame(41), s.FrameCount(), "derivation does not change the frame count")
}

func TestSession_ProjectileHitOnVehicle(t *testing.T) {
	s := NewSession()
	s.HandleProjectileEvent(core.ProjectileEvent{
		FirerObjectID:   5,
		VehicleObjectID: ptr(uint16(9)),
		MuzzleDisplay:   "Autocannon",
		SimulationType:  "shotCannon",
		Trajectory:      []core.TrajectoryPoint{{FrameNum: 1, Position: core.Position3D{X: 0, Y: 0}}},
		Hits: []core.ProjectileHit{
			{CaptureFrame: 3, Position: core.Position3D{X: 6, Y: 8}, VehicleID: ptr(uint16(12))},
		},
	})

	s.deriveProjectileData()

	require.Len(t, s.events, 1)
	hit := s.events[0].hit
	require.NotNil(t, hit)

	require.NotNil(t, hit.VictimVehicleID)
	assert.Equal(t, uint(12), *hit.VictimVehicleID)
	assert.Nil(t, hit.VictimSoldierID)
	// The shooter is attributed to the launching vehicle as well as the soldier.
	require.NotNil(t, hit.ShooterVehicleID)
	assert.Equal(t, uint(9), *hit.ShooterVehicleID)
	require.NotNil(t, hit.ShooterSoldierID)
	assert.Equal(t, uint(5), *hit.ShooterSoldierID)
	assert.InDelta(t, 10, hit.Distance, 1e-4)
}

// Some projectiles report no muzzle name; the weapon display is the fallback,
// and the event text follows the resolved name.
func TestSession_ProjectileHitFallsBackToWeaponDisplay(t *testing.T) {
	s := NewSession()
	s.HandleProjectileEvent(core.ProjectileEvent{
		FirerObjectID:   5,
		WeaponDisplay:   "M151 105mm",
		MagazineDisplay: "HE",
		SimulationType:  "shotCannon",
		Trajectory:      []core.TrajectoryPoint{{FrameNum: 1}},
		Hits:            []core.ProjectileHit{{CaptureFrame: 2}},
	})

	s.deriveProjectileData()

	require.Len(t, s.events, 1)
	hit := s.events[0].hit
	require.NotNil(t, hit)
	assert.Equal(t, "M151 105mm", hit.WeaponName)
	assert.Equal(t, "M151 105mm [HE]", hit.EventText)
}

// A hit with no trajectory has no launch position; distance is taken from the
// origin rather than crashing or reading a missing sample.
func TestSession_ProjectileHitWithoutTrajectory(t *testing.T) {
	s := NewSession()
	s.HandleProjectileEvent(core.ProjectileEvent{
		FirerObjectID:  5,
		MuzzleDisplay:  "Titan",
		SimulationType: "shotRocket",
		Hits: []core.ProjectileHit{
			{CaptureFrame: 2, Position: core.Position3D{X: 3, Y: 4}},
		},
	})

	require.NotPanics(t, func() { s.deriveProjectileData() })

	require.Len(t, s.events, 1)
	hit := s.events[0].hit
	require.NotNil(t, hit)
	assert.InDelta(t, 5, hit.Distance, 1e-4)
}

// Every hit on a projectile produces its own event.
func TestSession_MultipleProjectileHitsProduceMultipleEvents(t *testing.T) {
	s := NewSession()
	s.HandleProjectileEvent(core.ProjectileEvent{
		FirerObjectID:  5,
		MuzzleDisplay:  "Titan",
		SimulationType: "shotRocket",
		Trajectory:     []core.TrajectoryPoint{{FrameNum: 1}},
		Hits: []core.ProjectileHit{
			{CaptureFrame: 2, SoldierID: ptr(uint16(8))},
			{CaptureFrame: 9, VehicleID: ptr(uint16(3))},
		},
	})

	trackedBefore := s.FrameCount()
	s.deriveProjectileData()

	require.Len(t, s.events, 2)
	assert.Equal(t, core.Frame(2), s.events[0].frame)
	assert.Equal(t, core.Frame(9), s.events[1].frame)
	assert.Equal(t, core.Frame(10), trackedBefore, "ingestion tracked the latest hit frame")
	assert.Equal(t, trackedBefore, s.FrameCount(), "derivation does not change the frame count")
}

// A bullet that both flies and hits yields a fire line and a hit event.
func TestSession_BulletWithHitYieldsFireLineAndHitEvent(t *testing.T) {
	s := NewSession()
	s.HandleAddSoldier(core.Soldier{ID: 5, DisplayName: "Nosey", OcapType: "unit"})
	s.HandleProjectileEvent(core.ProjectileEvent{
		FirerObjectID:  5,
		MuzzleDisplay:  "M16A4",
		SimulationType: "shotBullet",
		Trajectory:     []core.TrajectoryPoint{{FrameNum: 1}, {FrameNum: 3}},
		Hits:           []core.ProjectileHit{{CaptureFrame: 3, SoldierID: ptr(uint16(8))}},
	})

	s.deriveProjectileData()

	assert.Empty(t, s.markers)
	rec, ok := s.soldiers[5]
	require.True(t, ok)
	assert.Len(t, rec.bulletFireLines, 1)
	require.Len(t, s.events, 1)
	assert.Equal(t, "hit", s.events[0].eventType)
}

// Derivation runs once at write time; repeating it must not duplicate markers
// or events, since it is reached from several write paths.
func TestSession_DeriveProjectileDataIsIdempotent(t *testing.T) {
	s := NewSession()
	s.HandleAddSoldier(core.Soldier{ID: 5, DisplayName: "Nosey", OcapType: "unit"})
	s.HandleProjectileEvent(core.ProjectileEvent{
		FirerObjectID:   5,
		MuzzleDisplay:   "Titan",
		MagazineDisplay: "Titan AP",
		SimulationType:  "shotRocket",
		Trajectory:      []core.TrajectoryPoint{{FrameNum: 1}, {FrameNum: 2}},
		Hits:            []core.ProjectileHit{{CaptureFrame: 2, SoldierID: ptr(uint16(8))}},
	})

	s.deriveProjectileData()
	markers := len(s.markers)
	events := len(s.events)
	require.Equal(t, 1, markers)
	require.Equal(t, 1, events)

	s.deriveProjectileData()

	assert.Len(t, s.markers, markers, "markers are not derived twice")
	assert.Len(t, s.events, events, "events are not derived twice")
}

func TestSession_LivePlayerCount(t *testing.T) {
	s := NewSession()
	assert.Equal(t, 0, s.LivePlayerCount(), "no telemetry means no live players")

	s.HandleTelemetry(core.TelemetryEvent{GlobalCounts: core.GlobalEntityCount{PlayersConnected: 7}})
	assert.Equal(t, 7, s.LivePlayerCount())

	// The most recent snapshot wins; players leave.
	s.HandleTelemetry(core.TelemetryEvent{GlobalCounts: core.GlobalEntityCount{PlayersConnected: 3}})
	assert.Equal(t, 3, s.LivePlayerCount())
}

func TestSession_ChunkFlusherAccessor(t *testing.T) {
	s := NewSession()
	assert.Nil(t, s.ChunkFlusher(), "no flusher attached by default")

	cf, err := NewChunkFlusher(t.TempDir(), 10)
	require.NoError(t, err)

	s.SetChunkFlusher(cf)
	assert.Same(t, cf, s.ChunkFlusher())
}

// capturedFlag carries a different extra-data shape than captured/contested.
func TestSession_V1CapturedFlagEventPayload(t *testing.T) {
	s := NewSession()
	s.HandleGeneralEvent(core.GeneralEvent{
		CaptureFrame: 4,
		Name:         "capturedFlag",
		ExtraData: map[string]any{
			"unitName": "Nosey",
			"unitSide": "WEST",
			"flagSide": "EAST",
		},
	})

	events := s.eventsToV1()
	entry := findV1Event(t, events, "capturedFlag")

	assert.Equal(t, core.Frame(4), entry[0])
	payload, ok := entry[2].([]any)
	require.True(t, ok, "capturedFlag payload must be an array, got %T", entry[2])
	assert.Equal(t, []any{"Nosey", "WEST", "EAST"}, payload)
}

// Missing extra-data keys degrade to empty strings rather than dropping the event.
func TestSession_V1CapturedFlagEventWithoutExtraData(t *testing.T) {
	s := NewSession()
	s.HandleGeneralEvent(core.GeneralEvent{CaptureFrame: 1, Name: "capturedFlag"})

	entry := findV1Event(t, s.eventsToV1(), "capturedFlag")
	payload, ok := entry[2].([]any)
	require.True(t, ok)
	assert.Equal(t, []any{"", "", ""}, payload)
}

func findV1Event(t *testing.T, events []any, typ string) []any {
	t.Helper()
	for _, ev := range events {
		entry, ok := ev.([]any)
		require.True(t, ok, "event must be an array, got %T", ev)
		require.GreaterOrEqual(t, len(entry), 2)
		if name, _ := entry[1].(string); name == typ {
			return entry
		}
	}
	t.Fatalf("no v1 event of type %q", typ)
	return nil
}
