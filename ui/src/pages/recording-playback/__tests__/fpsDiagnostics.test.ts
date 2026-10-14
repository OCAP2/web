import { describe, it, expect, vi } from "vitest";
import type { ChunkManager } from "../../../data/chunkManager";
import type { AliveState, ChunkData, EntityDef, EntityState } from "../../../data/types";
import {
  buildPopulationSamples,
  correlationStrength,
  findLowestDips,
  nearestIndex,
  niceScale,
  pearson,
  populationFrames,
  timeTicks,
} from "../fpsDiagnostics";
import { createTestEngine, makeManifest, unitDef, vehicleDef } from "./testHelpers";

/** Dense per-frame states for an entity living `startFrame..endFrame`. */
function states(
  startFrame: number,
  endFrame: number,
  at: (frame: number) => Partial<EntityState> = () => ({}),
): EntityState[] {
  const result: EntityState[] = [];
  for (let frame = startFrame; frame <= endFrame; frame++) {
    result.push({ position: [0, 0], direction: 0, alive: 1, ...at(frame) });
  }
  return result;
}

function living(def: Partial<EntityDef> & { id: number }, at?: (frame: number) => Partial<EntityState>): EntityDef {
  const startFrame = def.startFrame ?? 0;
  const endFrame = def.endFrame ?? 10;
  const base = def.type && def.type !== "man" && def.type !== "zeus" ? vehicleDef : unitDef;
  return base({ ...def, startFrame, endFrame, positions: states(startFrame, endFrame, at) });
}

describe("populationFrames", () => {
  // Counting at the sample frames is what pairs each FPS value with the load
  // at that same moment.
  it("counts at the FPS sample frames when there are samples", () => {
    expect(populationFrames(
      [{ frame: 0, fps: 40 }, { frame: 10, fps: 30 }, { frame: 10, fps: 31 }, { frame: 20, fps: 20 }],
      100,
      1000,
    )).toEqual([0, 10, 20]);
  });

  it("falls back to a ten-second grid that reaches the last frame", () => {
    expect(populationFrames([], 35, 1000)).toEqual([0, 10, 20, 30, 35]);
    expect(populationFrames([{ frame: 0, fps: 40 }], 20, 500)).toEqual([0, 20]);
  });

  it("caps the grid on a very long recording", () => {
    const frames = populationFrames([], 1_000_000, 1000);
    expect(frames.length).toBeLessThanOrEqual(1501);
    expect(frames[frames.length - 1]).toBe(1_000_000);
  });
});

describe("buildPopulationSamples", () => {
  it("counts alive units, players, AI and vehicles at each frame", async () => {
    const { engine } = createTestEngine();
    engine.loadRecording(makeManifest(
      [
        living({ id: 1 }, () => ({ isPlayer: false })),
        // A player who dies at frame 6: a body is not load the way a man is.
        living({ id: 2 }, (frame) => ({ isPlayer: true, alive: (frame >= 6 ? 0 : 1) as AliveState })),
        // Unconscious is still simulated.
        living({ id: 3 }, () => ({ alive: 2 as AliveState, isPlayer: false })),
        // Takes over a slot at frame 5 and is a player from then on.
        living({ id: 4 }, (frame) => ({ isPlayer: frame >= 5 })),
        // Spawns late.
        living({ id: 5, startFrame: 8 }, () => ({ isPlayer: false })),
        living({ id: 50, type: "car" }),
        living({ id: 51, type: "tank" }, (frame) => ({ alive: (frame >= 3 ? 0 : 1) as AliveState })),
        // Zeus is a camera, not a simulated unit.
        living({ id: 90, type: "zeus" }, () => ({ isPlayer: true })),
      ],
      [],
      10,
    ));

    const samples = await buildPopulationSamples(engine, [10, 0, 5, 5]);

    expect(samples).toEqual([
      { frame: 0, units: 4, players: 1, ai: 3, vehicles: 2 },
      { frame: 5, units: 4, players: 2, ai: 2, vehicles: 1 },
      { frame: 10, units: 4, players: 1, ai: 3, vehicles: 1 },
    ]);
  });

  // The chunk cache keeps three chunks. Loading every chunk and then reading
  // would see only the last three, so the counts must be taken chunk by chunk.
  it("reads every chunk of a chunked recording, in order", async () => {
    const chunkSize = 10;
    const chunkCount = 5;
    const endFrame = chunkSize * chunkCount - 1;
    const chunks: ChunkData[] = [];
    for (let index = 0; index < chunkCount; index++) {
      const first = index * chunkSize;
      chunks.push({
        entities: new Map([
          [1, states(first, first + chunkSize - 1)],
          // A second unit only alive in the odd chunks.
          [2, states(first, first + chunkSize - 1, () => ({ alive: (index % 2) as AliveState }))],
        ]),
      });
    }
    const loadChunk = vi.fn((index: number) => Promise.resolve(chunks[index]));
    const chunkManager = {
      setCallbacks: () => {},
      getChunkForFrame: () => null,
      ensureLoaded: () => Promise.resolve(),
      loadChunk,
    } as unknown as ChunkManager;

    const { engine } = createTestEngine();
    const manifest = makeManifest(
      [
        unitDef({ id: 1, startFrame: 0, endFrame, positions: undefined }),
        unitDef({ id: 2, startFrame: 0, endFrame, positions: undefined }),
      ],
      [],
      endFrame,
    );
    engine.loadRecording({ ...manifest, chunkSize, chunkCount }, chunkManager);

    const samples = await buildPopulationSamples(engine, [5, 15, 25, 35, 45]);

    expect(samples.map((sample) => sample.units)).toEqual([1, 2, 1, 2, 1]);
    expect(loadChunk.mock.calls.map(([index]) => index)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("findLowestDips", () => {
  const samples = [
    { frame: 0, fps: 45 },
    { frame: 10, fps: 12 },
    { frame: 20, fps: 14 },
    { frame: 100, fps: 25 },
    { frame: 200, fps: 12 },
    { frame: 300, fps: 50 },
  ];

  it("lists the lowest samples first, the earliest on a tie", () => {
    expect(findLowestDips(samples, 3, 1)).toEqual([
      { frame: 10, fps: 12 },
      { frame: 200, fps: 12 },
      { frame: 20, fps: 14 },
    ]);
  });

  // Frame 20 is the same bad minute as frame 10, not a second dip.
  it("keeps the picks at least the gap apart", () => {
    expect(findLowestDips(samples, 3, 60)).toEqual([
      { frame: 10, fps: 12 },
      { frame: 200, fps: 12 },
      { frame: 100, fps: 25 },
    ]);
  });

  it("returns nothing for a recording without samples", () => {
    expect(findLowestDips([], 5, 60)).toEqual([]);
  });
});

describe("pearson", () => {
  it("is -1 for a perfectly inverse relationship and +1 for a direct one", () => {
    expect(pearson([20, 30, 40, 50], [4, 3, 2, 1])).toBeCloseTo(-1);
    expect(pearson([1, 2, 3], [10, 20, 30])).toBeCloseTo(1);
  });

  it("is null without enough data or without variation", () => {
    expect(pearson([1, 2], [2, 1])).toBeNull();
    expect(pearson([40, 40, 40], [1, 2, 3])).toBeNull();
    expect(pearson([1, 2, 3], [5, 5, 5])).toBeNull();
  });

  it("grades the strength by magnitude, whatever the sign", () => {
    expect(correlationStrength(-0.85)).toBe("strong");
    expect(correlationStrength(0.5)).toBe("moderate");
    expect(correlationStrength(-0.25)).toBe("weak");
    expect(correlationStrength(0.05)).toBe("none");
  });
});

describe("nearestIndex", () => {
  it("finds the closest frame, the earlier one on a tie", () => {
    const frames = [0, 10, 20, 30];
    expect(nearestIndex(frames, -5)).toBe(0);
    expect(nearestIndex(frames, 14)).toBe(1);
    expect(nearestIndex(frames, 15)).toBe(1);
    expect(nearestIndex(frames, 16)).toBe(2);
    expect(nearestIndex(frames, 99)).toBe(3);
    expect(nearestIndex([], 3)).toBe(-1);
  });
});

describe("axis helpers", () => {
  it("rounds the value axis up with headroom and ticks from zero", () => {
    const { max, ticks } = niceScale(50, 5);
    expect(max).toBeGreaterThanOrEqual(54);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBe(max);
    expect(ticks.length).toBeLessThanOrEqual(6);
  });

  it("puts time ticks on round marks", () => {
    // One hour at one frame per second, room for eight labels: every ten minutes.
    expect(timeTicks(3600, 1000, 8)).toEqual([0, 600, 1200, 1800, 2400, 3000, 3600]);
  });
});
