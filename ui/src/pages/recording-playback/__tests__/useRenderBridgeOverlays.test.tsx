import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot, createSignal } from "solid-js";
import { MockRenderer } from "../../../renderers/mockRenderer";
import { MarkerManager } from "../../../playback/markerManager";
import { PlaybackEngine } from "../../../playback/engine";
import { useRenderBridge } from "../useRenderBridge";
import { setLeftPanelVisible } from "../shortcuts";
import {
  setDeathHeatmapVisible,
  setTrailMode,
  setTransmissionsVisible,
} from "../viewOptions";
import { SIDE_COLORS_BRIGHT } from "../../../config/sideColors";
import { unitDef, vehicleDef, makeManifest, killedEvent } from "./testHelpers";
import type { BriefingMarkerDef, EntityMarkerOpts, EntityMarkerState } from "../../../renderers/renderer.types";
import type { TimeMode } from "../../../playback/time";
import type { EntityDef, EventDef, EntityState } from "../../../data/types";

/** Last element; the project's TS lib target has no Array.prototype.at. */
function last<T>(items: T[]): T {
  return items[items.length - 1];
}

function flush(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve));
}

async function flushMany(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) await flush();
}

function stationary(x: number, y: number, count: number): EntityState[] {
  return Array.from({ length: count }, () => ({ position: [x, y, 0], direction: 0, alive: 1 as const }));
}

function trackPath(count: number, scale = 2): EntityState[] {
  return Array.from({ length: count }, (_, i) => ({
    position: [i * scale, i * 3, 0],
    direction: 0,
    alive: 1 as const,
  }));
}

interface Harness {
  engine: PlaybackEngine;
  renderer: MockRenderer;
  created: () => BriefingMarkerDef[];
  updates: () => { handle: unknown; state: any }[];
  removedHandles: () => unknown[];
  removedEntityMarkers: () => unknown[];
  entityMarkers: () => { id: number; opts: EntityMarkerOpts }[];
  /** Per-frame states sent for one entity's own handle, oldest first. */
  entityUpdatesFor: (id: number) => EntityMarkerState[];
  dispose: () => void;
}

function harness(
  entities: EntityDef[],
  events: EventDef[] = [],
  endFrame = 400,
  timeMode?: () => TimeMode,
): Harness {
  const renderer = new MockRenderer();
  const engine = new PlaybackEngine(renderer);
  const markerManager = new MarkerManager(renderer);

  const created = vi.spyOn(renderer, "createBriefingMarker");
  const updates = vi.spyOn(renderer, "updateBriefingMarker");
  const removed = vi.spyOn(renderer, "removeBriefingMarker");
  const removedEntities = vi.spyOn(renderer, "removeEntityMarker");
  const entityMarkers = vi.spyOn(renderer, "createEntityMarker");
  const entityUpdates = vi.spyOn(renderer, "updateEntityMarker");

  engine.loadRecording(makeManifest(entities, events, endFrame));

  const disposeRoot = createRoot((dispose) => {
    useRenderBridge(engine, renderer, markerManager, timeMode);
    return dispose;
  });

  return {
    engine,
    renderer,
    created: () => created.mock.calls.map((call) => call[0]),
    updates: () => updates.mock.calls.map(([handle, state]) => ({ handle, state })),
    removedHandles: () => removed.mock.calls.map((call) => call[0]),
    removedEntityMarkers: () => removedEntities.mock.calls.map((call) => call[0]),
    entityMarkers: () => entityMarkers.mock.calls.map(([id, opts]) => ({ id, opts })),
    entityUpdatesFor: (id: number) => {
      // createEntityMarker takes the id and returns the handle every later
      // update is keyed by, so the handle comes from the spy's result, not its args.
      const created = entityMarkers.mock.calls.findIndex(([mid]) => mid === id);
      if (created < 0) return [];
      const handle = entityMarkers.mock.results[created]?.value;
      return entityUpdates.mock.calls
        .filter(([updated]) => updated === handle)
        .map(([, state]) => state);
    },
    dispose: () => {
      disposeRoot();
      engine.dispose();
      vi.restoreAllMocks();
    },
  };
}

const pingEvent = (
  frameNum: number,
  payload: Partial<{ curatorId: number; unitId: number; name: string; side: string; x: number; y: number }> = {},
): EventDef =>
  ({
    frameNum,
    type: "zeusPing",
    payload: { curatorId: 1, unitId: 1, name: "Nosey", side: "WEST", x: 100, y: 200, ...payload },
  }) as EventDef;

const moduleEvent = (
  frameNum: number,
  payload: Record<string, unknown> = {},
): EventDef =>
  ({
    frameNum,
    type: "zeusModule",
    payload: { curatorId: 7, curatorName: "Director", displayName: "Mine Field", x: 300, y: 400, ...payload },
  }) as EventDef;

const explosionEvent = (frameNum: number, payload: Record<string, unknown> = {}): EventDef =>
  ({
    frameNum,
    type: "explosion",
    payload: { x: 120, y: 240, ammo: "M_Shot", name: "Mortar", radius: 25, power: 1, firerId: 1, vehicleId: 0, side: "WEST", source: "projectile", ...payload },
  }) as EventDef;

const pingLabels = (defs: BriefingMarkerDef[]) => defs.filter((d) => d.textClass === "zeus-ping-label");
const moduleLabels = (defs: BriefingMarkerDef[]) => defs.filter((d) => d.textClass === "zeus-module-label");
const ellipses = (defs: BriefingMarkerDef[]) => defs.filter((d) => d.shape === "ELLIPSE");

afterEach(() => {
  setTrailMode("off");
  setDeathHeatmapVisible(false);
  setTransmissionsVisible(false);
  setLeftPanelVisible(true);
  vi.restoreAllMocks();
});

describe("useRenderBridge — zeus ping overlay", () => {
  it("draws a ping icon and label while the ping is live", async () => {
    const h = harness([unitDef({ id: 1 })], [pingEvent(5)]);
    try {
      h.engine.seekTo(5);
      await flushMany();

      const defs = h.created();
      const labels = pingLabels(defs);
      expect(labels).toHaveLength(1);
      expect(labels[0].text).toContain("[Zeus ping]");
      expect(labels[0].text).toContain("Nosey");
      expect(labels[0].layer).toBe("systemMarkers");
      expect(labels[0].side).toBe("GLOBAL");

      const icons = defs.filter((d) => d.type === "zeus");
      expect(icons).toHaveLength(1);
      expect(icons[0].layer).toBe("systemMarkers");

      // The icon carries the pinged player's side colour, without the leading #.
      expect(icons[0].color).toBe(SIDE_COLORS_BRIGHT.WEST.replace("#", ""));

      const latest = last(h.updates())!;
      expect(latest.state.position).toEqual([100, 200]);
      expect(latest.state.alpha).toBeGreaterThan(0);
    } finally {
      h.dispose();
    }
  });

  it("removes both ping markers once the ping ages out of its lifetime", async () => {
    const h = harness([unitDef({ id: 1 })], [pingEvent(5)]);
    try {
      h.engine.seekTo(5);
      await flushMany();
      expect(h.created().filter((d) => d.type === "zeus")).toHaveLength(1);

      const before = h.removedHandles().length;
      h.engine.seekTo(5 + 180); // lifetime is 180 frames at a 1 s capture delay
      await flushMany();

      expect(h.removedHandles().length).toBe(before + 2);
    } finally {
      h.dispose();
    }
  });

  it("rebuilds the label when a second ping joins the group", async () => {
    const h = harness([unitDef({ id: 1 })], [
      pingEvent(5),
      pingEvent(6, { x: 105, y: 205 }), // within the 25 m group radius
    ]);
    try {
      h.engine.seekTo(5);
      await flushMany();
      const firstText = pingLabels(h.created())[0].text ?? "";
      expect(firstText).not.toContain("<br>");

      h.engine.seekTo(6);
      await flushMany();

      const labels = pingLabels(h.created());
      expect(labels.length).toBeGreaterThan(1);
      const text = last(labels)!.text ?? "";
      expect(text).toContain("<br>");
      expect(text.split("<br>")).toHaveLength(2);
      // The whole divIcon is rebuilt, so the rendered label really changed.
      expect(text).not.toBe(firstText);
    } finally {
      h.dispose();
    }
  });

  it("keeps pings from the same player that land far apart as separate groups", async () => {
    const h = harness([unitDef({ id: 1 })], [
      pingEvent(5),
      pingEvent(6, { x: 900, y: 900 }), // far outside the 25 m group radius
    ]);
    try {
      h.engine.seekTo(6);
      await flushMany();

      const labels = pingLabels(h.created());
      expect(labels).toHaveLength(2);
      // Two places, two labels: collapsing them would hide where the second
      // ping actually landed.
      for (const label of labels) {
        expect(label.text).not.toContain("<br>");
      }
    } finally {
      h.dispose();
    }
  });

  it("escapes the recorded unit name in the ping label", async () => {
    const h = harness([unitDef({ id: 1 })], [
      pingEvent(5, { name: '<img src=x onerror="alert(1)">' }),
    ]);
    try {
      h.engine.seekTo(5);
      await flushMany();

      const text = pingLabels(h.created())[0].text ?? "";
      expect(text).toContain("&lt;img");
      expect(text).toContain("&quot;");
      expect(text).not.toContain('<img');
    } finally {
      h.dispose();
    }
  });

  it("labels an unnamed pinger by unit id", async () => {
    const h = harness([unitDef({ id: 1 })], [pingEvent(5, { name: "" })]);
    try {
      h.engine.seekTo(5);
      await flushMany();
      expect(pingLabels(h.created())[0].text).toContain("Unit 1");
    } finally {
      h.dispose();
    }
  });

  it("falls back to the default colour for an unknown side", async () => {
    const h = harness([unitDef({ id: 1 })], [pingEvent(5, { side: "NOPE" })]);
    try {
      h.engine.seekTo(5);
      await flushMany();
      expect(h.created().find((d) => d.type === "zeus")!.color).toBe("ffcc00");
    } finally {
      h.dispose();
    }
  });

  it("rebuilds ping labels when the time mode changes", async () => {
    const [mode, setMode] = createSignal<TimeMode>("elapsed");
    const h = harness([unitDef({ id: 1 })], [pingEvent(5)], 400, mode);
    try {
      h.engine.seekTo(5);
      await flushMany();
      const first = last(pingLabels(h.created()))!.text;

      setMode("mission");
      await flushMany();

      const latest = last(pingLabels(h.created()))!.text;
      expect(latest).not.toBe(first);
      expect(pingLabels(h.created()).length).toBeGreaterThan(1);
    } finally {
      h.dispose();
    }
  });
});

describe("useRenderBridge — zeus module overlay", () => {
  it("draws a module overlay labelled with curator, module and target", async () => {
    const h = harness([unitDef({ id: 1 })], [
      moduleEvent(10, { attachedName: "Objective" }),
    ]);
    try {
      h.engine.seekTo(10);
      await flushMany();

      const labels = moduleLabels(h.created());
      expect(labels).toHaveLength(1);
      const text = labels[0].text ?? "";
      expect(text).toContain("[Zeus module]");
      expect(text).toContain("Director");
      expect(text).toContain("Mine Field");
      expect(text).toContain("Objective");

      expect(h.created().filter((d) => d.type === "zeus")).toHaveLength(1);
      expect(last(h.updates())!.state.position).toEqual([300, 400]);
    } finally {
      h.dispose();
    }
  });

  it("labels an unattached module by curator id when no name was recorded", async () => {
    const h = harness([unitDef({ id: 1 })], [
      moduleEvent(10, { curatorName: "", displayName: "Ammo Box" }),
    ]);
    try {
      h.engine.seekTo(10);
      await flushMany();
      const text = moduleLabels(h.created())[0].text ?? "";
      expect(text).toContain("Zeus 7");
      expect(text).toContain("Ammo Box");
      expect(text).not.toMatch(/ - - /);
    } finally {
      h.dispose();
    }
  });

  it("removes module markers past the 30 s module lifetime", async () => {
    const h = harness([unitDef({ id: 1 })], [moduleEvent(10)]);
    try {
      h.engine.seekTo(10);
      await flushMany();
      const before = h.removedHandles().length;

      h.engine.seekTo(40);
      await flushMany();
      expect(h.removedHandles().length).toBe(before + 2);
    } finally {
      h.dispose();
    }
  });

  it("fades a module as the playhead moves away from its placement", async () => {
    const h = harness([unitDef({ id: 1 })], [moduleEvent(10)]);
    try {
      h.engine.seekTo(10);
      await flushMany();
      const fresh = last(h.updates())!.state.alpha;

      h.engine.seekTo(37);
      await flushMany();
      const older = last(h.updates())!.state.alpha;

      expect(fresh).toBeGreaterThan(older);
      expect(older).toBeGreaterThan(0);
    } finally {
      h.dispose();
    }
  });

  it("escapes module names coming from the recording", async () => {
    const h = harness([unitDef({ id: 1 })], [
      moduleEvent(10, { curatorName: "<b>Z</b>", displayName: '<i>M</i>', attachedName: "<u>T</u>" }),
    ]);
    try {
      h.engine.seekTo(10);
      await flushMany();
      const text = moduleLabels(h.created())[0].text ?? "";
      expect(text).toContain("&lt;b&gt;");
      expect(text).toContain("&lt;i&gt;");
      expect(text).toContain("&lt;u&gt;");
    } finally {
      h.dispose();
    }
  });
});

describe("useRenderBridge — explosion blast circles", () => {
  it("draws a blast circle sized by the ammo radius", async () => {
    const h = harness([unitDef({ id: 1 })], [explosionEvent(10, { radius: 25 })]);
    try {
      h.engine.seekTo(10);
      await flushMany();

      const circles = ellipses(h.created());
      expect(circles).toHaveLength(1);
      expect(circles[0].size).toEqual([25, 25]);
      expect(circles[0].brush).toBe("Solid");
      expect(circles[0].layer).toBe("systemMarkers");
      // The biggest class of blast gets the most alarming colour.
      expect(circles[0].color).toBe("ff2d2d");

      const latest = last(h.updates())!;
      expect(latest.state.position).toEqual([120, 240]);
      expect(latest.state.alpha).toBeCloseTo(0.3, 5);
    } finally {
      h.dispose();
    }
  });

  it("colours small and medium blasts differently", async () => {
    for (const [radius, color] of [[8, "ff9d3d"], [12, "ff5c2d"], [30, "ff2d2d"]] as const) {
      const h = harness([unitDef({ id: 1 })], [explosionEvent(10, { radius })]);
      try {
        h.engine.seekTo(10);
        await flushMany();
        expect(ellipses(h.created())[0].color).toBe(color);
      } finally {
        h.dispose();
      }
    }
  });

  it("fades a blast as the playhead moves past it and removes it after 6 s", async () => {
    const h = harness([unitDef({ id: 1 })], [explosionEvent(10)]);
    try {
      h.engine.seekTo(10);
      await flushMany();
      const peak = last(h.updates())!.state.alpha;

      h.engine.seekTo(14);
      await flushMany();
      const fading = last(h.updates())!.state.alpha;
      expect(fading).toBeLessThan(peak);

      const before = h.removedHandles().length;
      h.engine.seekTo(16);
      await flushMany();
      expect(h.removedHandles().length).toBe(before + 1);
    } finally {
      h.dispose();
    }
  });

  it("draws one circle per blast in a barrage", async () => {
    const h = harness([unitDef({ id: 1 })], [
      explosionEvent(10, { x: 100, y: 100 }),
      explosionEvent(11, { x: 500, y: 500 }),
    ]);
    try {
      h.engine.seekTo(11);
      await flushMany();
      expect(ellipses(h.created())).toHaveLength(2);
    } finally {
      h.dispose();
    }
  });
});

describe("useRenderBridge — movement trails", () => {
  const trailUnits = (): EntityDef[] => [
    unitDef({ id: 1, name: "Walker", isPlayer: true, endFrame: 100, positions: trackPath(101) }),
    unitDef({ id: 2, name: "AlsoPlayer", isPlayer: true, endFrame: 100, positions: trackPath(101, 5) }),
  ];

  it("draws no trails while the mode is off", async () => {
    const h = harness(trailUnits());
    try {
      h.engine.seekTo(60);
      await flushMany();
      expect(h.created().filter((d) => d.shape === "POLYLINE")).toHaveLength(0);
    } finally {
      h.dispose();
    }
  });

  it("draws a trail for each on-foot player", async () => {
    setTrailMode("players");
    const h = harness(trailUnits());
    try {
      h.engine.seekTo(60);
      await flushMany();

      const trails = h.created().filter((d) => d.shape === "POLYLINE");
      expect(trails).toHaveLength(2);
      expect(trails[0].layer).toBe("systemMarkers");
      expect(trails[0].side).toBe("GLOBAL");
      expect(trails[0].color).toBe(SIDE_COLORS_BRIGHT.WEST.replace("#", ""));

      const updates = h.updates().filter((u) => Array.isArray(u.state.points));
      expect(updates.length).toBeGreaterThan(0);
      // Samples are windowed behind the playhead, so the newest point is the
      // unit's current position and the trail reads backwards in time.
      const points = last(updates)!.state.points as [number, number][];
      expect(points.length).toBeGreaterThan(2);
      expect(last(updates)!.state.alpha).toBeCloseTo(0.55, 5);
    } finally {
      h.dispose();
    }
  });

  it("excludes players riding in a vehicle", async () => {
    setTrailMode("players");
    const h = harness([
      unitDef({
        id: 1, isPlayer: true, endFrame: 100,
        positions: trackPath(101).map((s) => ({ ...s, isInVehicle: true })),
      }),
    ]);
    try {
      h.engine.seekTo(60);
      await flushMany();
      expect(h.created().filter((d) => d.shape === "POLYLINE")).toHaveLength(0);
    } finally {
      h.dispose();
    }
  });

  it("draws a trail only for the followed unit in followed mode", async () => {
    setTrailMode("followed");
    const h = harness(trailUnits());
    try {
      h.engine.seekTo(60);
      await flushMany();
      expect(h.created().filter((d) => d.shape === "POLYLINE")).toHaveLength(0);

      h.engine.followEntity(2);
      await flushMany();

      const trails = h.created().filter((d) => d.shape === "POLYLINE");
      expect(trails).toHaveLength(1);
      // The followed unit's path advances 5 m per frame.
      expect(last(last(h.updates())!.state.points)).toEqual([60 * 5, 60 * 3]);
    } finally {
      h.dispose();
    }
  });

  it("stops drawing when the follow target is cleared", async () => {
    setTrailMode("followed");
    const h = harness(trailUnits());
    try {
      h.engine.followEntity(1);
      h.engine.seekTo(60);
      await flushMany();
      expect(h.created().filter((d) => d.shape === "POLYLINE")).toHaveLength(1);

      const before = h.removedHandles().length;
      h.engine.unfollowEntity();
      await flushMany();
      expect(h.removedHandles().length).toBe(before + 1);
    } finally {
      h.dispose();
    }
  });

  it("removes trails when the mode turns off", async () => {
    setTrailMode("players");
    const h = harness(trailUnits());
    try {
      h.engine.seekTo(60);
      await flushMany();
      expect(h.created().filter((d) => d.shape === "POLYLINE")).toHaveLength(2);

      const before = h.removedHandles().length;
      setTrailMode("off");
      await flushMany();
      expect(h.removedHandles().length).toBe(before + 2);
    } finally {
      h.dispose();
    }
  });

  it("does not draw a degenerate one-point trail", async () => {
    setTrailMode("players");
    // Only the current frame resolves, so no window sample can be added.
    // The unit starts at frame 61 and the playhead sits at 62, so none of the
    // window samples at the 3-frame stride resolve and only the current head
    // point exists. One point cannot form a line.
    const h = harness([
      unitDef({ id: 1, isPlayer: true, startFrame: 61, endFrame: 101, positions: trackPath(41) }),
    ]);
    try {
      h.engine.seekTo(62);
      await flushMany();
      expect(h.created().filter((d) => d.shape === "POLYLINE")).toHaveLength(0);
    } finally {
      h.dispose();
    }
  });

  it("reuses cached samples as the playhead advances one frame", async () => {
    setTrailMode("players");
    const h = harness([unitDef({ id: 1, isPlayer: true, endFrame: 100, positions: trackPath(101) })]);
    try {
      h.engine.seekTo(60);
      await flushMany();
      const first = last(h.updates().filter((u) => Array.isArray(u.state.points)))!.state.points;

      h.engine.seekTo(61);
      await flushMany();
      const second = last(h.updates().filter((u) => Array.isArray(u.state.points)))!.state.points;

      // One trail handle only: the existing marker is updated, not recreated.
      expect(h.created().filter((d) => d.shape === "POLYLINE")).toHaveLength(1);
      expect(second.length).toBeGreaterThanOrEqual(first.length);
      expect(last(second)).toEqual([61 * 2, 61 * 3]);
    } finally {
      h.dispose();
    }
  });
});

describe("useRenderBridge — death heatmap", () => {
  const deadly = (): EntityDef[] => [
    unitDef({ id: 1, isPlayer: true, endFrame: 100, positions: trackPath(101) }),
    unitDef({ id: 2, isPlayer: false, side: "EAST", endFrame: 100, positions: trackPath(101, 4) }),
    unitDef({ id: 3, isPlayer: false, side: "EAST", endFrame: 100, positions: trackPath(101, 4) }),
  ];
  const deaths = (): EventDef[] => [killedEvent(10, 2, 1), killedEvent(20, 3, 1)];

  it("draws nothing while the heatmap is hidden", async () => {
    const h = harness(deadly(), deaths());
    try {
      h.engine.seekTo(50);
      await flushMany();
      expect(ellipses(h.created())).toHaveLength(0);
    } finally {
      h.dispose();
    }
  });

  it("draws a blob per death cell once the heatmap is shown", async () => {
    setDeathHeatmapVisible(true);
    const h = harness(deadly(), deaths());
    try {
      h.engine.seekTo(50);
      await flushMany(12);

      const blobs = ellipses(h.created());
      expect(blobs.length).toBeGreaterThan(0);
      expect(blobs[0].color).toBe("ff3b3b");
      expect(blobs[0].brush).toBe("Solid");
      expect(blobs[0].layer).toBe("systemMarkers");
      expect(blobs[0].size![0]).toBeGreaterThan(0);
    } finally {
      h.dispose();
    }
  });

  // A blob's radius is sized against the busiest cell, so it only changes once a
  // cell catches up. The radius is baked into the handle at creation, which means
  // a growing cell has to discard its blob and draw a larger one.
  it("recreates a blob with a larger radius as its cell fills up", async () => {
    setDeathHeatmapVisible(true);
    const h = harness(
      [
        unitDef({ id: 1, isPlayer: true, endFrame: 100, positions: stationary(5, 5, 101) }),
        // Two deaths early in the busy cell at ~(100,100).
        unitDef({ id: 2, isPlayer: false, side: "EAST", endFrame: 100, positions: stationary(100, 100, 101) }),
        unitDef({ id: 3, isPlayer: false, side: "EAST", endFrame: 100, positions: stationary(110, 105, 101) }),
        // One death in the far cell at ~(500,500), joined by a second at frame 20.
        unitDef({ id: 4, isPlayer: false, side: "EAST", endFrame: 100, positions: stationary(500, 500, 101) }),
        unitDef({ id: 5, isPlayer: false, side: "EAST", endFrame: 100, positions: stationary(505, 495, 101) }),
      ],
      [killedEvent(4, 2, 1), killedEvent(5, 3, 1), killedEvent(6, 4, 1), killedEvent(20, 5, 1)],
    );
    try {
      h.engine.seekTo(10);
      await flushMany(12);

      // Busy cell holds 2 deaths, the far cell 1, so it is drawn smaller.
      const radiiEarly = ellipses(h.created()).map((d) => d.size![0]);
      expect(radiiEarly).toHaveLength(2);
      const small = Math.min(...radiiEarly);
      const large = Math.max(...radiiEarly);
      expect(small).toBeLessThan(large);

      const createdBefore = h.created().length;
      const removedBefore = h.removedHandles().length;

      h.engine.seekTo(20);
      await flushMany(12);

      // Both cells now hold 2 deaths, so the small blob is replaced by a bigger one.
      const drawnLate = ellipses(h.created().slice(createdBefore));
      expect(drawnLate.length).toBeGreaterThan(0);
      expect(Math.max(...drawnLate.map((d) => d.size![0]))).toBeGreaterThan(small);
      expect(h.removedHandles().length).toBeGreaterThan(removedBefore);
    } finally {
      h.dispose();
    }
  });

  it("removes every blob when the heatmap is hidden again", async () => {
    setDeathHeatmapVisible(true);
    const h = harness(deadly(), deaths());
    try {
      h.engine.seekTo(50);
      await flushMany(12);
      const drawn = ellipses(h.created()).length;
      expect(drawn).toBeGreaterThan(0);

      const before = h.removedHandles().length;
      setDeathHeatmapVisible(false);
      await flushMany(12);
      expect(h.removedHandles().length).toBe(before + drawn);
    } finally {
      h.dispose();
    }
  });
});

describe("useRenderBridge — entity and vehicle popups", () => {
  it("treats a vehicle with a player crew member as a player marker", async () => {
    const h = harness([
      unitDef({ id: 1, isPlayer: true, endFrame: 50, positions: trackPath(51).map((s) => ({ ...s, isInVehicle: true, vehicleId: 50 })) }),
      unitDef({ id: 2, isPlayer: false, endFrame: 50, positions: trackPath(51).map((s) => ({ ...s, isInVehicle: true, vehicleId: 50 })) }),
      vehicleDef({
        id: 50, isPlayer: false, name: "Offroad", endFrame: 50,
        positions: trackPath(51, 3).map((s) => ({ ...s, crewIds: [1, 2] })),
      }),
    ]);
    try {
      h.engine.seekTo(5);
      await flushMany();

      const vehicle = h.entityMarkers().find((m) => m.id === 50);
      expect(vehicle).toBeDefined();
      expect(vehicle!.opts.isPlayer).toBe(true);
      // Only the player crew member is named in the popup.
      expect(vehicle!.opts.crew).toEqual({ count: 2, names: ["Rifleman"] });
    } finally {
      h.dispose();
    }
  });

  it("leaves a vehicle with no player crew unlabelled as a player marker", async () => {
    const h = harness([
      unitDef({ id: 2, isPlayer: false, endFrame: 50, positions: trackPath(51).map((s) => ({ ...s, isInVehicle: true, vehicleId: 50 })) }),
      vehicleDef({
        id: 50, isPlayer: false, name: "Offroad", endFrame: 50,
        positions: trackPath(51, 3).map((s) => ({ ...s, crewIds: [2] })),
      }),
    ]);
    try {
      h.engine.seekTo(5);
      await flushMany();
      const vehicle = h.entityMarkers().find((m) => m.id === 50);
      expect(vehicle!.opts.isPlayer).toBe(false);
      expect(vehicle!.opts.crew).toEqual({ count: 1, names: [] });
    } finally {
      h.dispose();
    }
  });

  it("drops entity markers for entities that no longer exist", async () => {
    const h = harness([
      unitDef({ id: 1, endFrame: 20, positions: trackPath(21) }),
      unitDef({ id: 2, endFrame: 100, positions: trackPath(101) }),
    ]);
    try {
      h.engine.seekTo(10);
      await flushMany();
      expect(h.entityMarkers().map((m) => m.id)).toContain(1);

      const before = h.removedEntityMarkers().length;
      h.engine.seekTo(30);
      await flushMany();
      // The expired unit's marker handle is released rather than left on screen.
      expect(h.removedEntityMarkers().length).toBeGreaterThan(before);
    } finally {
      h.dispose();
    }
  });

  it("marks a unit hit on the current frame for the renderer", async () => {
    const h = harness(
      [
        unitDef({ id: 1, endFrame: 50, positions: trackPath(51) }),
        unitDef({ id: 2, side: "EAST", endFrame: 50, positions: trackPath(51) }),
      ],
      [{ frameNum: 8, type: "hit", victimId: 2, causedById: 1, weapon: "M4", distance: 10 } as unknown as EventDef],
    );
    try {
      h.engine.seekTo(8);
      await flushMany();

      const victim = h.entityUpdatesFor(2);
      expect(victim.length).toBeGreaterThan(0);
      expect(last(victim)!.hit).toBe(true);

      // The shooter is not flashed alongside the victim.
      const shooter = h.entityUpdatesFor(1);
      expect(shooter.length).toBeGreaterThan(0);
      expect(last(shooter)!.hit).toBe(false);

      // The flash belongs to that one frame only.
      h.engine.seekTo(9);
      await flushMany();
      expect(last(h.entityUpdatesFor(2))!.hit).toBe(false);
    } finally {
      h.dispose();
    }
  });
});

describe("useRenderBridge — renderer plumbing", () => {
  it("enables smoothing only while playing, sized to the frame interval", async () => {
    const renderer = new MockRenderer();
    const engine = new PlaybackEngine(renderer);
    const smoothing = vi.spyOn(renderer, "setSmoothingEnabled");
    const markerManager = new MarkerManager(renderer);
    engine.loadRecording(makeManifest([unitDef({ id: 1 })], [], 100));

    const dispose = createRoot((d) => {
      useRenderBridge(engine, renderer, markerManager);
      return d;
    });
    try {
      await flushMany();
      // Paused at the default 10x speed of a 1 s capture delay: one tenth of a
      // second per frame, which is what the renderer sizes its tween to.
      expect(smoothing).toHaveBeenLastCalledWith(false, 0.1);

      // Smoothing is only worth doing while frames are actually advancing.
      engine.play();
      await flushMany();
      expect(smoothing).toHaveBeenLastCalledWith(true, 0.1);

      engine.pause();
      await flushMany();
      expect(smoothing).toHaveBeenLastCalledWith(false, 0.1);

      engine.setSpeed(1);
      engine.play();
      await flushMany();
      expect(smoothing).toHaveBeenLastCalledWith(true, 1);

      engine.setSpeed(60);
      await flushMany();
      expect(smoothing).toHaveBeenLastCalledWith(true, 1 / 60);

      engine.pause();
      await flushMany();

      // Speed is clamped, so the tween never targets a zero-length interval.
      engine.setSpeed(0);
      await flushMany();
      expect(smoothing).toHaveBeenLastCalledWith(false, 1);
    } finally {
      dispose();
      engine.dispose();
    }
  });

  it("unfollows the entity when the map is dragged", async () => {
    const renderer = new MockRenderer();
    const engine = new PlaybackEngine(renderer);
    const markerManager = new MarkerManager(renderer);
    engine.loadRecording(makeManifest([unitDef({ id: 1 })], [], 100));
    const unfollow = vi.spyOn(engine, "unfollowEntity");

    const dispose = createRoot((d) => {
      useRenderBridge(engine, renderer, markerManager);
      return d;
    });
    try {
      engine.followEntity(1);
      await flush();
      expect(engine.followTarget()).toBe(1);

      // The bridge subscribes to the renderer's dragstart event, so dragging the
      // map releases the follow lock instead of fighting the user's pan.
      const callbacks = (renderer as unknown as { listeners: Map<string, Set<() => void>> }).listeners.get("dragstart");
      expect(callbacks?.size).toBeGreaterThan(0);
      for (const callback of callbacks ?? []) callback();
      await flush();

      expect(unfollow).toHaveBeenCalled();
      expect(engine.followTarget()).toBeNull();
    } finally {
      dispose();
      engine.dispose();
    }
  });

  it("moves the map offset with the side panel", async () => {
    const h = harness([unitDef({ id: 1 })]);
    try {
      await flush();
      expect(document.documentElement.style.getPropertyValue("--leaflet-left-offset"))
        .toBe("calc(var(--pb-panel-width) + 16px)");

      setLeftPanelVisible(false);
      await flush();
      expect(document.documentElement.style.getPropertyValue("--leaflet-left-offset"))
        .toBe("10px");
    } finally {
      h.dispose();
    }
  });
});
