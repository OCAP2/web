import { describe, it, expect, beforeEach } from "vitest";
import { EventManager } from "../eventManager";
import { ServerFpsEvent } from "../events/serverFpsEvent";
import { PlayerSnapshotEvent } from "../events/playerSnapshotEvent";
import { GameEvent } from "../events/gameEvent";

describe("server FPS samples", () => {
  let mgr: EventManager;

  beforeEach(() => {
    mgr = new EventManager();
  });

  const addSamples = (samples: [number, number][]) => {
    samples.forEach(([frame, fps], index) => mgr.addEvent(new ServerFpsEvent(frame, index, fps)));
  };

  // A recording made before the sampler existed has no samples at all, and the
  // Stats panel hides the card on `undefined` rather than showing zeros.
  it("returns undefined when the recording carries no samples", () => {
    expect(mgr.getServerFpsStats(0)).toBeUndefined();
    expect(mgr.getServerFpsStats(9999)).toBeUndefined();
  });

  // The first sample is clamped to frame 0 by the recorder, so scrubbing to the
  // very start of a recording already has one value to show.
  it("reports the clamped first sample at frame 0", () => {
    addSamples([[0, 51.2]]);
    expect(mgr.getServerFpsStats(0)).toEqual({ current: 51.2, average: 51.2, median: 51.2 });
  });

  it("stays undefined while the playhead sits before the first sample", () => {
    addSamples([[10, 48]]);
    expect(mgr.getServerFpsStats(9)).toBeUndefined();
    expect(mgr.getServerFpsStats(10)).toBeDefined();
  });

  // Everything is scoped to the playhead: a sample from later in the recording
  // must not leak into the average the viewer sees now.
  it("aggregates only the samples up to the playhead", () => {
    addSamples([
      [0, 40],
      [10, 20],
      [20, 30],
      [30, 50],
    ]);

    expect(mgr.getServerFpsStats(10)).toEqual({ current: 20, average: 30, median: 30 });

    const atTwenty = mgr.getServerFpsStats(20)!;
    expect(atTwenty.current).toBe(30);
    expect(atTwenty.average).toBe(30);
    expect(atTwenty.median).toBe(30); // odd count: the middle of 20, 30, 40
  });

  it("averages the two middle values for an even sample count", () => {
    addSamples([
      [0, 10],
      [10, 20],
      [20, 30],
      [30, 100],
    ]);

    const stats = mgr.getServerFpsStats(30)!;
    expect(stats.current).toBe(100);
    expect(stats.average).toBe(40);
    expect(stats.median).toBe(25); // (20 + 30) / 2, unmoved by the outlier
  });

  // "current" is the newest sample by frame, not the newest one added: chunked
  // recordings hand events over in fetch order, not recording order.
  it("orders samples by frame regardless of insertion order", () => {
    addSamples([
      [30, 50],
      [0, 40],
      [20, 30],
      [10, 20],
    ]);

    expect(mgr.getServerFpsStats(10)!.current).toBe(20);
    expect(mgr.getServerFpsStats(30)!.current).toBe(50);
  });

  // The recorder samples before its first frame and again at frame 0. Older
  // builds stamp the early sample -1, newer ones 0; both are the start.
  it("keeps one start sample whether the early one is stamped -1 or 0", () => {
    for (const early of [-1, 0]) {
      mgr.clear();
      addSamples([
        [early, 26],
        [0, 27],
        [10, 80],
      ]);

      expect(mgr.getServerFpsSamples()).toEqual([
        { frame: 0, fps: 26 },
        { frame: 10, fps: 80 },
      ]);
      expect(mgr.getServerFpsStats(10)).toEqual({ current: 80, average: 53, median: 53 });
    }
  });

  it("keeps a lone pre-start sample, at frame 0", () => {
    addSamples([[-1, 40]]);
    expect(mgr.getServerFpsStats(0)).toEqual({ current: 40, average: 40, median: 40 });
  });

  it("drops the samples on clear", () => {
    addSamples([[0, 40]]);
    mgr.clear();
    expect(mgr.getServerFpsStats(9999)).toBeUndefined();
  });

  // Samples and per-player snapshots are read through their own lookups. They
  // must stay out of the event log, which would otherwise be one FPS line every
  // ten seconds plus a snapshot per player per interval.
  it("keeps samples and snapshots out of the events feed", () => {
    const killed = new GameEvent(15, "killed", 99);
    mgr.addEvent(new ServerFpsEvent(0, 1, 40));
    mgr.addEvent(new PlayerSnapshotEvent(10, "staminaSnapshot", 2, {
      unitId: 7,
      vanilla: { stamina: 12.5, staminaMax: 30, load: 0.61, massUnits: 695, stance: 3 },
    }));
    mgr.addEvent(killed);

    expect(mgr.getAll()).toEqual([killed]);
    expect(mgr.getActiveEvents(9999)).toEqual([killed]);
    expect(mgr.getEventsAtFrame(0)).toEqual([]);
    expect(mgr.getEventsAtFrame(10)).toEqual([]);

    // ...while both are still reachable through their own lookups.
    expect(mgr.getServerFpsStats(0)).toBeDefined();
    expect(mgr.hasPlayerSnapshots(7)).toBe(true);
  });
});
