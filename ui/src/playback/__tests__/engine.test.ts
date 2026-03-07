import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PlaybackEngine } from "../engine";
import { MockRenderer } from "../../renderers/mockRenderer";
import type { Manifest, EntityDef, ChunkData } from "../../data/types";
import type { ChunkManager } from "../../data/chunkManager";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeManifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    version: 1,
    worldName: "Altis",
    missionName: "Test Mission",
    endFrame: 99,
    chunkSize: 300,
    captureDelayMs: 1000,
    chunkCount: 1,
    entities: [],
    events: [],
    markers: [],
    times: [],
    ...overrides,
  };
}

function makeEntityDef(overrides: Partial<EntityDef> = {}): EntityDef {
  return {
    id: 1,
    type: "man",
    name: "Rifleman",
    side: "WEST",
    groupName: "Alpha",
    isPlayer: true,
    startFrame: 0,
    endFrame: 99,
    ...overrides,
  };
}

function makeChunkData(
  entities: Map<number, Array<{ position: [number, number]; direction: number; alive: 0 | 1 | 2; isInVehicle?: boolean; name?: string }>>,
): ChunkData {
  return { entities } as ChunkData;
}

/**
 * Create a mock ChunkManager that returns pre-configured chunk data.
 */
function makeMockChunkManager(chunkData: ChunkData | null = null): ChunkManager {
  return {
    loadManifest: vi.fn(),
    loadChunk: vi.fn(),
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
    getChunkForFrame: vi.fn().mockReturnValue(chunkData),
    clear: vi.fn(),
    getManifest: vi.fn().mockReturnValue(null),
    setCallbacks: vi.fn(),
  } as unknown as ChunkManager;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PlaybackEngine", () => {
  let engine: PlaybackEngine;
  let renderer: MockRenderer;

  beforeEach(() => {
    vi.useFakeTimers();
    // Stub rAF to 1ms interval so existing timing values work precisely.
    // In production, rAF fires at ~16ms (paint-aligned). In tests, 1ms
    // avoids rounding issues (e.g., advanceTimersByTime(1000) for interval=1000).
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      return setTimeout(() => cb(performance.now()), 1) as unknown as number;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      clearTimeout(id);
    });
    renderer = new MockRenderer();
    engine = new PlaybackEngine(renderer);
  });

  afterEach(() => {
    engine.dispose();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // ─── loadRecording ───

  describe("loadRecording", () => {
    it("populates entities from manifest", () => {
      const manifest = makeManifest({
        entities: [
          makeEntityDef({ id: 1, name: "Alpha1" }),
          makeEntityDef({ id: 2, name: "Alpha2", type: "car" }),
        ],
      });
      const cm = makeMockChunkManager();
      engine.loadRecording(manifest, cm);

      expect(engine.entityManager.getAll()).toHaveLength(2);
      expect(engine.entityManager.getEntity(1)?.name).toBe("Alpha1");
      expect(engine.entityManager.getEntity(2)?.name).toBe("Alpha2");
    });

    it("populates events from manifest", () => {
      const manifest = makeManifest({
        entities: [
          makeEntityDef({ id: 1 }),
          makeEntityDef({ id: 2 }),
        ],
        events: [
          { frameNum: 10, type: "killed", victimId: 1, causedById: 2, distance: 100, weapon: "M4" },
          { frameNum: 20, type: "connected", unitName: "Player1" },
        ],
      });
      const cm = makeMockChunkManager();
      engine.loadRecording(manifest, cm);

      expect(engine.eventManager.getAll()).toHaveLength(2);
    });

    it("sets endFrame from manifest endFrame", () => {
      const manifest = makeManifest({ endFrame: 499 });
      const cm = makeMockChunkManager();
      engine.loadRecording(manifest, cm);

      expect(engine.endFrame()).toBe(499);
    });

    it("sets captureDelayMs from manifest", () => {
      const manifest = makeManifest({ captureDelayMs: 500 });
      const cm = makeMockChunkManager();
      engine.loadRecording(manifest, cm);

      expect(engine.captureDelayMs()).toBe(500);
    });

    it("resets currentFrame to 0", () => {
      const manifest = makeManifest();
      const cm = makeMockChunkManager();

      // Manually set frame first via seekTo after an initial load
      engine.loadRecording(manifest, cm);
      engine.seekTo(50);
      expect(engine.currentFrame()).toBe(50);

      // Load again should reset
      engine.loadRecording(manifest, cm);
      expect(engine.currentFrame()).toBe(0);
    });
  });

  // ─── play / pause ───

  describe("play()", () => {
    it("sets isPlaying to true", () => {
      const manifest = makeManifest({ endFrame: 99 });
      const cm = makeMockChunkManager();
      engine.loadRecording(manifest, cm);

      engine.play();
      expect(engine.isPlaying()).toBe(true);
    });

    it("frame advances on tick", () => {
      const manifest = makeManifest({ endFrame: 99, captureDelayMs: 1000 });
      const cm = makeMockChunkManager();
      engine.loadRecording(manifest, cm);

      engine.setSpeed(1);
      engine.play();
      expect(engine.currentFrame()).toBe(0);

      vi.advanceTimersByTime(1000);
      expect(engine.currentFrame()).toBe(1);

      vi.advanceTimersByTime(1000);
      expect(engine.currentFrame()).toBe(2);
    });

    it("does not play when already at endFrame", () => {
      const manifest = makeManifest({ endFrame: 9 });
      const cm = makeMockChunkManager();
      engine.loadRecording(manifest, cm);

      engine.seekTo(9); // endFrame = 9
      engine.play();
      expect(engine.isPlaying()).toBe(false);
    });
  });

  describe("pause()", () => {
    it("sets isPlaying to false", () => {
      const manifest = makeManifest({ endFrame: 99 });
      const cm = makeMockChunkManager();
      engine.loadRecording(manifest, cm);

      engine.play();
      expect(engine.isPlaying()).toBe(true);

      engine.pause();
      expect(engine.isPlaying()).toBe(false);
    });

    it("stops frame from advancing", () => {
      const manifest = makeManifest({ endFrame: 99, captureDelayMs: 1000 });
      const cm = makeMockChunkManager();
      engine.loadRecording(manifest, cm);

      engine.setSpeed(1);
      engine.play();
      vi.advanceTimersByTime(1000);
      expect(engine.currentFrame()).toBe(1);

      engine.pause();
      vi.advanceTimersByTime(5000);
      expect(engine.currentFrame()).toBe(1);
    });
  });

  describe("togglePlayPause()", () => {
    it("toggles between play and pause", () => {
      const manifest = makeManifest({ endFrame: 99 });
      const cm = makeMockChunkManager();
      engine.loadRecording(manifest, cm);

      engine.togglePlayPause();
      expect(engine.isPlaying()).toBe(true);

      engine.togglePlayPause();
      expect(engine.isPlaying()).toBe(false);
    });
  });

  // ─── seekTo ───

  describe("seekTo()", () => {
    it("sets currentFrame to N", () => {
      const manifest = makeManifest({ endFrame: 99 });
      const cm = makeMockChunkManager();
      engine.loadRecording(manifest, cm);

      engine.seekTo(42);
      expect(engine.currentFrame()).toBe(42);
    });

    it("clamps to 0 when seeking negative", () => {
      const manifest = makeManifest({ endFrame: 99 });
      const cm = makeMockChunkManager();
      engine.loadRecording(manifest, cm);

      engine.seekTo(-10);
      expect(engine.currentFrame()).toBe(0);
    });

    it("clamps to endFrame when seeking past end", () => {
      const manifest = makeManifest({ endFrame: 99 });
      const cm = makeMockChunkManager();
      engine.loadRecording(manifest, cm);

      engine.seekTo(9999);
      expect(engine.currentFrame()).toBe(99); // endFrame from manifest
    });

    it("updates snapshots when seeking", () => {
      const entityStates = new Map<number, any[]>();
      const states = [];
      for (let i = 0; i < 100; i++) {
        states.push({
          position: [100 + i, 200 + i] as [number, number],
          direction: i * 3,
          alive: 1 as const,
        });
      }
      entityStates.set(1, states);

      const chunkData = makeChunkData(entityStates);
      const cm = makeMockChunkManager(chunkData);

      const manifest = makeManifest({
        endFrame: 99,
        entities: [makeEntityDef({ id: 1, startFrame: 0, endFrame: 99 })],
      });

      engine.loadRecording(manifest, cm);
      engine.seekTo(50);

      const snapshots = engine.entitySnapshots();
      expect(snapshots.has(1)).toBe(true);
      const snap = snapshots.get(1)!;
      expect(snap.position).toEqual([150, 250]);
      expect(snap.direction).toBe(150);
    });
  });

  // ─── setSpeed ───

  describe("setSpeed()", () => {
    it("changes playbackSpeed signal", () => {
      const manifest = makeManifest({ endFrame: 99 });
      const cm = makeMockChunkManager();
      engine.loadRecording(manifest, cm);

      engine.setSpeed(10);
      expect(engine.playbackSpeed()).toBe(10);
    });

    it("clamps speed to range 1-60", () => {
      const manifest = makeManifest({ endFrame: 99 });
      const cm = makeMockChunkManager();
      engine.loadRecording(manifest, cm);

      engine.setSpeed(0);
      expect(engine.playbackSpeed()).toBe(1);

      engine.setSpeed(100);
      expect(engine.playbackSpeed()).toBe(60);
    });

    it("changes timer interval when playing", () => {
      const manifest = makeManifest({ endFrame: 999, captureDelayMs: 1000 });
      const cm = makeMockChunkManager();
      engine.loadRecording(manifest, cm);

      engine.setSpeed(1);
      engine.play();

      // At speed 1, interval is 1000ms
      vi.advanceTimersByTime(1000);
      expect(engine.currentFrame()).toBe(1);

      // Change to speed 10
      engine.setSpeed(10);

      // Now interval is 100ms
      vi.advanceTimersByTime(100);
      expect(engine.currentFrame()).toBe(2);

      vi.advanceTimersByTime(100);
      expect(engine.currentFrame()).toBe(3);
    });
  });

  // ─── followEntity ───

  describe("followEntity()", () => {
    it("sets followTarget signal", () => {
      engine.followEntity(42);
      expect(engine.followTarget()).toBe(42);
    });
  });

  describe("unfollowEntity()", () => {
    it("clears followTarget signal", () => {
      engine.followEntity(42);
      engine.unfollowEntity();
      expect(engine.followTarget()).toBeNull();
    });
  });

  // ─── endFrame auto-pause ───

  describe("endFrame auto-pause", () => {
    it("auto-pauses when reaching endFrame", () => {
      const manifest = makeManifest({ endFrame: 4, captureDelayMs: 100 });
      const cm = makeMockChunkManager();
      engine.loadRecording(manifest, cm);

      engine.seekTo(3); // endFrame = 4
      engine.play();

      // Advance one tick to frame 4 (endFrame)
      vi.advanceTimersByTime(100);
      expect(engine.currentFrame()).toBe(4);
      expect(engine.isPlaying()).toBe(false);

      // No more advancement
      vi.advanceTimersByTime(500);
      expect(engine.currentFrame()).toBe(4);
    });
  });

  // ─── Entity spawn/despawn ───

  describe("entity spawn/despawn", () => {
    it("entity not in snapshots before startFrame", () => {
      const entityStates = new Map<number, any[]>();
      // Entity starts at frame 10, build states for frames 10-19 within chunk
      // In the chunk, frames 0-9 have no data for this entity
      const states: any[] = [];
      for (let i = 0; i < 300; i++) {
        if (i >= 10 && i <= 19) {
          states.push({
            position: [100 + i, 200] as [number, number],
            direction: 0,
            alive: 1 as const,
          });
        } else {
          states.push(undefined);
        }
      }
      entityStates.set(1, states);

      const chunkData = makeChunkData(entityStates);
      const cm = makeMockChunkManager(chunkData);

      const manifest = makeManifest({
        endFrame: 99,
        entities: [makeEntityDef({ id: 1, startFrame: 10, endFrame: 19 })],
      });

      engine.loadRecording(manifest, cm);

      // Frame 5: entity should NOT be in snapshots
      engine.seekTo(5);
      expect(engine.entitySnapshots().has(1)).toBe(false);
    });

    it("entity appears at startFrame", () => {
      const entityStates = new Map<number, any[]>();
      const states: any[] = [];
      for (let i = 0; i < 300; i++) {
        if (i >= 10 && i <= 19) {
          states.push({
            position: [100 + i, 200] as [number, number],
            direction: 0,
            alive: 1 as const,
          });
        } else {
          states.push(undefined);
        }
      }
      entityStates.set(1, states);

      const chunkData = makeChunkData(entityStates);
      const cm = makeMockChunkManager(chunkData);

      const manifest = makeManifest({
        endFrame: 99,
        entities: [makeEntityDef({ id: 1, startFrame: 10, endFrame: 19 })],
      });

      engine.loadRecording(manifest, cm);

      // Frame 10: entity should appear
      engine.seekTo(10);
      expect(engine.entitySnapshots().has(1)).toBe(true);
      const snap = engine.entitySnapshots().get(1)!;
      expect(snap.position).toEqual([110, 200]);
    });

    it("entity gone after endFrame", () => {
      const entityStates = new Map<number, any[]>();
      const states: any[] = [];
      for (let i = 0; i < 300; i++) {
        if (i >= 10 && i <= 19) {
          states.push({
            position: [100 + i, 200] as [number, number],
            direction: 0,
            alive: 1 as const,
          });
        } else {
          states.push(undefined);
        }
      }
      entityStates.set(1, states);

      const chunkData = makeChunkData(entityStates);
      const cm = makeMockChunkManager(chunkData);

      const manifest = makeManifest({
        endFrame: 99,
        entities: [makeEntityDef({ id: 1, startFrame: 10, endFrame: 19 })],
      });

      engine.loadRecording(manifest, cm);

      // Frame 20: entity should be gone (endFrame is 19)
      engine.seekTo(20);
      expect(engine.entitySnapshots().has(1)).toBe(false);
    });
  });

  // ─── dispose ───

  describe("dispose()", () => {
    it("stops playback and clears state", () => {
      const manifest = makeManifest({ endFrame: 99, captureDelayMs: 1000 });
      const cm = makeMockChunkManager();
      engine.loadRecording(manifest, cm);

      engine.play();
      // Default speed 10: interval = 1000/10 = 100ms
      vi.advanceTimersByTime(100);
      expect(engine.currentFrame()).toBe(1);

      engine.dispose();
      expect(engine.isPlaying()).toBe(false);

      vi.advanceTimersByTime(1000);
      // Frame should not advance after dispose
      expect(engine.entityManager.getAll()).toHaveLength(0);
    });
  });

  // ─── Camera follow during playback ───

  describe("camera follow during playback", () => {
    it("calls renderer.setView for followed entity on tick", () => {
      const entityStates = new Map<number, any[]>();
      const states: any[] = [];
      for (let i = 0; i < 300; i++) {
        states.push({
          position: [100 + i, 200 + i] as [number, number],
          direction: 0,
          alive: 1 as const,
        });
      }
      entityStates.set(1, states);

      const chunkData = makeChunkData(entityStates);
      const cm = makeMockChunkManager(chunkData);

      const manifest = makeManifest({
        endFrame: 99,
        captureDelayMs: 100,
        entities: [makeEntityDef({ id: 1, startFrame: 0, endFrame: 99 })],
      });

      engine.loadRecording(manifest, cm);
      engine.followEntity(1);
      engine.setSpeed(1);

      const setViewSpy = vi.spyOn(renderer, "setView");

      engine.play();
      vi.advanceTimersByTime(100);

      expect(setViewSpy).toHaveBeenCalledWith([101, 201]);
    });

    it("unfollows when entity disappears", () => {
      const entityStates = new Map<number, any[]>();
      const states: any[] = [];
      for (let i = 0; i < 300; i++) {
        if (i <= 2) {
          states.push({
            position: [100, 200] as [number, number],
            direction: 0,
            alive: 1 as const,
          });
        } else {
          states.push(undefined);
        }
      }
      entityStates.set(1, states);

      const chunkData = makeChunkData(entityStates);
      const cm = makeMockChunkManager(chunkData);

      const manifest = makeManifest({
        endFrame: 99,
        captureDelayMs: 100,
        entities: [makeEntityDef({ id: 1, startFrame: 0, endFrame: 2 })],
      });

      engine.loadRecording(manifest, cm);
      engine.followEntity(1);
      engine.setSpeed(1);

      engine.play();

      // Tick to frame 1 - entity still exists
      vi.advanceTimersByTime(100);
      expect(engine.followTarget()).toBe(1);

      // Tick to frame 2 - entity still exists (endFrame)
      vi.advanceTimersByTime(100);
      expect(engine.followTarget()).toBe(1);

      // Tick to frame 3 - entity gone (past endFrame)
      vi.advanceTimersByTime(100);
      expect(engine.followTarget()).toBeNull();
    });
  });

  // ─── Multiple entities ───

  describe("multiple entities", () => {
    it("computes snapshots for all active entities", () => {
      const entityStates = new Map<number, any[]>();

      const statesA: any[] = [];
      const statesB: any[] = [];
      for (let i = 0; i < 300; i++) {
        statesA.push({
          position: [i, 0] as [number, number],
          direction: 0,
          alive: 1 as const,
        });
        statesB.push({
          position: [0, i] as [number, number],
          direction: 90,
          alive: 1 as const,
        });
      }
      entityStates.set(1, statesA);
      entityStates.set(2, statesB);

      const chunkData = makeChunkData(entityStates);
      const cm = makeMockChunkManager(chunkData);

      const manifest = makeManifest({
        endFrame: 99,
        entities: [
          makeEntityDef({ id: 1, startFrame: 0, endFrame: 99 }),
          makeEntityDef({ id: 2, name: "Medic", startFrame: 0, endFrame: 99 }),
        ],
      });

      engine.loadRecording(manifest, cm);
      engine.seekTo(10);

      const snapshots = engine.entitySnapshots();
      expect(snapshots.size).toBe(2);
      expect(snapshots.get(1)?.position).toEqual([10, 0]);
      expect(snapshots.get(2)?.position).toEqual([0, 10]);
    });
  });

  // ─── Vehicle side from crew ───

  describe("vehicle side derived from crew", () => {
    it("vehicle snapshot has null side when no crew", () => {
      const manifest = makeManifest({
        endFrame: 9,
        entities: [
          makeEntityDef({
            id: 1,
            type: "heli",
            startFrame: 0,
            endFrame: 9,
            positions: [
              { position: [100, 200], direction: 0, alive: 1, crewIds: [] },
            ],
          }),
        ],
      });

      engine.loadRecording(manifest);
      engine.seekTo(0);

      const snap = engine.entitySnapshots().get(1);
      expect(snap).toBeDefined();
      expect(snap!.side).toBeNull();
      expect(snap!.iconType).toBe("heli");
    });

    it("vehicle derives side from first crew member", () => {
      const manifest = makeManifest({
        endFrame: 9,
        entities: [
          makeEntityDef({
            id: 1,
            name: "Pilot",
            type: "man",
            side: "WEST",
            startFrame: 0,
            endFrame: 9,
            positions: [
              { position: [100, 200], direction: 0, alive: 1, isInVehicle: true },
            ],
          }),
          makeEntityDef({
            id: 2,
            type: "heli",
            name: "Ghost Hawk",
            startFrame: 0,
            endFrame: 9,
            positions: [
              { position: [100, 200], direction: 0, alive: 1, crewIds: [1] },
            ],
          }),
        ],
      });

      engine.loadRecording(manifest);
      engine.seekTo(0);

      const snap = engine.entitySnapshots().get(2);
      expect(snap).toBeDefined();
      expect(snap!.side).toBe("WEST");
    });

    it("vehicle side changes when crew changes", () => {
      const manifest = makeManifest({
        endFrame: 9,
        entities: [
          makeEntityDef({
            id: 1,
            name: "BLUFOR Pilot",
            type: "man",
            side: "WEST",
            startFrame: 0,
            endFrame: 9,
            positions: [
              { position: [100, 200], direction: 0, alive: 1 },
              { position: [100, 200], direction: 0, alive: 1 },
            ],
          }),
          makeEntityDef({
            id: 2,
            name: "OPFOR Pilot",
            type: "man",
            side: "EAST",
            startFrame: 0,
            endFrame: 9,
            positions: [
              { position: [100, 200], direction: 0, alive: 1 },
              { position: [100, 200], direction: 0, alive: 1 },
            ],
          }),
          makeEntityDef({
            id: 3,
            type: "heli",
            name: "Heli",
            startFrame: 0,
            endFrame: 9,
            positions: [
              { position: [100, 200], direction: 0, alive: 1, crewIds: [1] },
              { position: [100, 200], direction: 0, alive: 1, crewIds: [2] },
            ],
          }),
        ],
      });

      engine.loadRecording(manifest);

      engine.seekTo(0);
      expect(engine.entitySnapshots().get(3)!.side).toBe("WEST");

      engine.seekTo(1);
      expect(engine.entitySnapshots().get(3)!.side).toBe("EAST");
    });

    it("vehicle crew clears when seeking backward to frame without crew", () => {
      const manifest = makeManifest({
        endFrame: 9,
        entities: [
          makeEntityDef({
            id: 1,
            name: "Pilot",
            type: "man",
            side: "WEST",
            startFrame: 0,
            endFrame: 9,
            positions: [
              { position: [100, 200], direction: 0, alive: 1 },
              { position: [100, 200], direction: 0, alive: 1 },
              { position: [100, 200], direction: 0, alive: 1 },
            ],
          }),
          makeEntityDef({
            id: 2,
            type: "heli",
            name: "Heli",
            startFrame: 0,
            endFrame: 9,
            positions: [
              // Frame 0: no crew
              { position: [100, 200], direction: 0, alive: 1 },
              // Frame 1: pilot enters
              { position: [100, 200], direction: 0, alive: 1, crewIds: [1] },
              // Frame 2: pilot still in
              { position: [100, 200], direction: 0, alive: 1, crewIds: [1] },
            ],
          }),
        ],
      });

      engine.loadRecording(manifest);

      // Seek forward: pilot in vehicle
      engine.seekTo(1);
      const vehicle = engine.entityManager.getEntity(2) as any;
      expect(vehicle.crew).toEqual([1]);
      expect(engine.entitySnapshots().get(2)!.side).toBe("WEST");

      // Seek backward: no crew — crew must be cleared
      engine.seekTo(0);
      expect(vehicle.crew).toEqual([]);
      expect(engine.entitySnapshots().get(2)!.side).toBeNull();
    });

    it("unit snapshots always use their own side", () => {
      const manifest = makeManifest({
        endFrame: 9,
        entities: [
          makeEntityDef({
            id: 1,
            type: "man",
            side: "GUER",
            startFrame: 0,
            endFrame: 9,
            positions: [
              { position: [100, 200], direction: 0, alive: 1 },
            ],
          }),
        ],
      });

      engine.loadRecording(manifest);
      engine.seekTo(0);

      const snap = engine.entitySnapshots().get(1);
      expect(snap!.side).toBe("GUER");
    });
  });

  // ─── Events at frame ───

  describe("events at frame", () => {
    it("returns events at the current frame after seekTo", () => {
      const manifest = makeManifest({
        endFrame: 99,
        entities: [
          makeEntityDef({ id: 1 }),
          makeEntityDef({ id: 2, name: "Enemy", side: "EAST" }),
        ],
        events: [
          { frameNum: 10, type: "killed", victimId: 1, causedById: 2, distance: 100, weapon: "AK" },
          { frameNum: 20, type: "connected", unitName: "Player1" },
        ],
      });
      const cm = makeMockChunkManager();
      engine.loadRecording(manifest, cm);

      engine.seekTo(10);
      const events = engine.activeEvents();
      expect(events).toHaveLength(1);
      expect(events[0].frameNum).toBe(10);
    });

    it("returns empty when no events at frame", () => {
      const manifest = makeManifest({
        endFrame: 99,
        events: [
          { frameNum: 10, type: "connected", unitName: "Player1" },
        ],
      });
      const cm = makeMockChunkManager();
      engine.loadRecording(manifest, cm);

      engine.seekTo(5);
      expect(engine.activeEvents()).toHaveLength(0);
    });

    it("returns cumulative events (all events up to current frame)", () => {
      const manifest = makeManifest({
        endFrame: 99,
        entities: [
          makeEntityDef({ id: 1 }),
          makeEntityDef({ id: 2, name: "Enemy", side: "EAST" }),
        ],
        events: [
          { frameNum: 5, type: "connected", unitName: "Player1" },
          { frameNum: 10, type: "killed", victimId: 1, causedById: 2, distance: 100, weapon: "AK" },
          { frameNum: 20, type: "connected", unitName: "Player2" },
        ],
      });
      const cm = makeMockChunkManager();
      engine.loadRecording(manifest, cm);

      // At frame 5: only the connected event
      engine.seekTo(5);
      expect(engine.activeEvents()).toHaveLength(1);

      // At frame 10: connected + killed = 2
      engine.seekTo(10);
      expect(engine.activeEvents()).toHaveLength(2);

      // At frame 15: still 2 (no event at 15, but cumulative from before)
      engine.seekTo(15);
      expect(engine.activeEvents()).toHaveLength(2);

      // At frame 20: all 3 events
      engine.seekTo(20);
      expect(engine.activeEvents()).toHaveLength(3);

      // Back to frame 0: none
      engine.seekTo(0);
      expect(engine.activeEvents()).toHaveLength(0);
    });
  });

  // ─── Playback speed and timer interval ───

  describe("playback speed affects timer", () => {
    it("speed 2 halves the interval", () => {
      const manifest = makeManifest({ endFrame: 99, captureDelayMs: 1000 });
      const cm = makeMockChunkManager();
      engine.loadRecording(manifest, cm);

      engine.setSpeed(2);
      engine.play();

      // At speed 2, interval is 500ms
      vi.advanceTimersByTime(500);
      expect(engine.currentFrame()).toBe(1);

      vi.advanceTimersByTime(500);
      expect(engine.currentFrame()).toBe(2);
    });

    it("speed 1 uses full captureDelayMs", () => {
      const manifest = makeManifest({ endFrame: 99, captureDelayMs: 2000 });
      const cm = makeMockChunkManager();
      engine.loadRecording(manifest, cm);

      engine.setSpeed(1);
      engine.play();

      vi.advanceTimersByTime(1999);
      expect(engine.currentFrame()).toBe(0);

      vi.advanceTimersByTime(1);
      expect(engine.currentFrame()).toBe(1);
    });

    it("skips frames when ideal interval is sub-16ms", () => {
      const manifest = makeManifest({ endFrame: 999, captureDelayMs: 100 });
      const cm = makeMockChunkManager();
      engine.loadRecording(manifest, cm);
      engine.setSpeed(60); // interval = 100/60 ≈ 1.67ms

      engine.play();
      vi.advanceTimersByTime(100); // 100ms of playback
      // At speed 60, ideal interval ≈ 1.67ms. Each 1ms rAF tick accumulates
      // time and advances multiple frames when enough accumulates. Over 100ms
      // we expect ~60 frames (minor float rounding may lose 1).
      expect(engine.currentFrame()).toBeGreaterThanOrEqual(59);
      expect(engine.currentFrame()).toBeLessThanOrEqual(60);
    });
  });

  // ─── Chunk-loaded callback recomputes snapshots ───

  describe("onChunkLoaded callback", () => {
    it("recomputes snapshots when a chunk finishes loading", () => {
      // Start with a chunk manager that returns null (chunk not yet loaded)
      let chunkData: ReturnType<typeof makeChunkData> | null = null;
      const cm = {
        loadManifest: vi.fn(),
        loadChunk: vi.fn(),
        ensureLoaded: vi.fn().mockResolvedValue(undefined),
        getChunkForFrame: vi.fn().mockImplementation(() => chunkData),
        clear: vi.fn(),
        getManifest: vi.fn().mockReturnValue(null),
        setCallbacks: vi.fn(),
      } as unknown as ChunkManager;

      const manifest = makeManifest({
        endFrame: 99,
        entities: [makeEntityDef({ id: 1, startFrame: 0, endFrame: 99 })],
      });

      engine.loadRecording(manifest, cm);

      // Capture the onChunkLoaded callback that the engine registered
      expect(cm.setCallbacks).toHaveBeenCalledTimes(1);
      const callbacks = (cm.setCallbacks as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callbacks.onChunkLoaded).toBeDefined();

      // At frame 0 with no chunk data, entity should NOT be in snapshots
      expect(engine.entitySnapshots().has(1)).toBe(false);

      // Simulate chunk loading: provide data and fire callback
      const entityStates = new Map<number, any[]>();
      const states = [];
      for (let i = 0; i < 100; i++) {
        states.push({
          position: [100 + i, 200 + i] as [number, number],
          direction: i * 3,
          alive: 1 as const,
        });
      }
      entityStates.set(1, states);
      chunkData = makeChunkData(entityStates);

      // Fire the callback for the current chunk (0) — engine should recompute
      callbacks.onChunkLoaded(0);

      // Now the entity should appear with frame 0 position
      const snapshots = engine.entitySnapshots();
      expect(snapshots.has(1)).toBe(true);
      expect(snapshots.get(1)!.position).toEqual([100, 200]);
    });

    it("skips recomputation when a prefetched future chunk loads", () => {
      const entityStates = new Map<number, any[]>();
      const states = [];
      for (let i = 0; i < 300; i++) {
        states.push({
          position: [100 + i, 200 + i] as [number, number],
          direction: i * 3,
          alive: 1 as const,
        });
      }
      entityStates.set(1, states);
      const chunk = makeChunkData(entityStates);

      const cm = {
        loadManifest: vi.fn(),
        loadChunk: vi.fn(),
        ensureLoaded: vi.fn().mockResolvedValue(undefined),
        getChunkForFrame: vi.fn().mockReturnValue(chunk),
        clear: vi.fn(),
        getManifest: vi.fn().mockReturnValue(null),
        setCallbacks: vi.fn(),
      } as unknown as ChunkManager;

      const manifest = makeManifest({
        endFrame: 599,
        chunkSize: 300,
        entities: [makeEntityDef({ id: 1, startFrame: 0, endFrame: 599 })],
      });

      engine.loadRecording(manifest, cm);

      const callbacks = (cm.setCallbacks as ReturnType<typeof vi.fn>).mock.calls[0][0];

      // Frame 0 is in chunk 0 — entity should be in snapshots
      expect(engine.entitySnapshots().has(1)).toBe(true);
      const snapshotBefore = engine.entitySnapshots();

      // Fire callback for chunk 1 (future chunk) — should NOT recompute
      callbacks.onChunkLoaded(1);

      // Snapshots reference should be unchanged (no recomputation)
      expect(engine.entitySnapshots()).toBe(snapshotBefore);
    });
  });

  // ─── computeSnapshots with no manifest ───

  describe("computeSnapshots with no manifest", () => {
    it("returns empty snapshots when seekTo is called before loadRecording", () => {
      // engine has no manifest yet — seekTo calls computeSnapshots internally
      // This hits lines 411-413 (early return when manifest is null)
      engine.seekTo(5);

      const snapshots = engine.entitySnapshots();
      expect(snapshots.size).toBe(0);
    });
  });

  // ─── Vehicle isPlayer from crew in chunk data ───

  describe("vehicle isPlayer derived from crew", () => {
    it("vehicle snapshot has isPlayer=true when crew contains a player unit", () => {
      const entityStates = new Map<number, any[]>();

      // Unit states (player)
      const unitStates: any[] = [];
      for (let i = 0; i < 300; i++) {
        unitStates.push({
          position: [100, 200] as [number, number],
          direction: 0,
          alive: 1 as const,
          isInVehicle: true,
        });
      }
      entityStates.set(1, unitStates);

      // Vehicle states with crew
      const vehicleStates: any[] = [];
      for (let i = 0; i < 300; i++) {
        vehicleStates.push({
          position: [300, 400] as [number, number],
          direction: 90,
          alive: 1 as const,
          crewIds: [1],
        });
      }
      entityStates.set(2, vehicleStates);

      const chunkData = makeChunkData(entityStates);
      const cm = makeMockChunkManager(chunkData);

      const manifest = makeManifest({
        endFrame: 99,
        entities: [
          makeEntityDef({ id: 1, name: "Player1", type: "man", side: "WEST", isPlayer: true, startFrame: 0, endFrame: 99 }),
          makeEntityDef({ id: 2, name: "HMMWV", type: "car", side: "CIV", isPlayer: false, startFrame: 0, endFrame: 99 }),
        ],
      });

      engine.loadRecording(manifest, cm);
      engine.seekTo(0);

      const vehicleSnap = engine.entitySnapshots().get(2);
      expect(vehicleSnap).toBeDefined();
      // Vehicle should derive isPlayer=true from crew member who is a player
      expect(vehicleSnap!.isPlayer).toBe(true);
      // Vehicle should derive side from crew
      expect(vehicleSnap!.side).toBe("WEST");
    });

    it("vehicle snapshot has isPlayer=false when crew has no player units", () => {
      const entityStates = new Map<number, any[]>();

      // Unit states (NOT a player)
      const unitStates: any[] = [];
      for (let i = 0; i < 300; i++) {
        unitStates.push({
          position: [100, 200] as [number, number],
          direction: 0,
          alive: 1 as const,
          isInVehicle: true,
        });
      }
      entityStates.set(1, unitStates);

      // Vehicle states with crew
      const vehicleStates: any[] = [];
      for (let i = 0; i < 300; i++) {
        vehicleStates.push({
          position: [300, 400] as [number, number],
          direction: 90,
          alive: 1 as const,
          crewIds: [1],
        });
      }
      entityStates.set(2, vehicleStates);

      const chunkData = makeChunkData(entityStates);
      const cm = makeMockChunkManager(chunkData);

      const manifest = makeManifest({
        endFrame: 99,
        entities: [
          makeEntityDef({ id: 1, name: "AI1", type: "man", side: "EAST", isPlayer: false, startFrame: 0, endFrame: 99 }),
          makeEntityDef({ id: 2, name: "T-100", type: "tank", side: "CIV", isPlayer: false, startFrame: 0, endFrame: 99 }),
        ],
      });

      engine.loadRecording(manifest, cm);
      engine.seekTo(0);

      const vehicleSnap = engine.entitySnapshots().get(2);
      expect(vehicleSnap).toBeDefined();
      expect(vehicleSnap!.isPlayer).toBe(false);
      expect(vehicleSnap!.side).toBe("EAST");
    });
  });

  // ─── Unit firedOnFrame ───

  describe("unit firedOnFrame in snapshots", () => {
    it("includes firedTargets in snapshot when unit fired on the current frame", () => {
      const entityStates = new Map<number, any[]>();
      const states: any[] = [];
      for (let i = 0; i < 300; i++) {
        states.push({
          position: [100, 200] as [number, number],
          direction: 0,
          alive: 1 as const,
        });
      }
      entityStates.set(1, states);

      const chunkData = makeChunkData(entityStates);
      const cm = makeMockChunkManager(chunkData);

      const manifest = makeManifest({
        endFrame: 99,
        entities: [
          {
            ...makeEntityDef({ id: 1, startFrame: 0, endFrame: 99 }),
            framesFired: [[5, [500, 600] as [number, number]]],
          },
        ],
      });

      engine.loadRecording(manifest, cm);
      engine.seekTo(5);

      const snap = engine.entitySnapshots().get(1);
      expect(snap).toBeDefined();
      expect(snap!.firedTargets).toEqual([[500, 600]]);
    });

    it("does not include firedTargets when unit did not fire on current frame", () => {
      const entityStates = new Map<number, any[]>();
      const states: any[] = [];
      for (let i = 0; i < 300; i++) {
        states.push({
          position: [100, 200] as [number, number],
          direction: 0,
          alive: 1 as const,
        });
      }
      entityStates.set(1, states);

      const chunkData = makeChunkData(entityStates);
      const cm = makeMockChunkManager(chunkData);

      const manifest = makeManifest({
        endFrame: 99,
        entities: [
          {
            ...makeEntityDef({ id: 1, startFrame: 0, endFrame: 99 }),
            framesFired: [[5, [500, 600] as [number, number]]],
          },
        ],
      });

      engine.loadRecording(manifest, cm);
      engine.seekTo(10); // not frame 5

      const snap = engine.entitySnapshots().get(1);
      expect(snap).toBeDefined();
      expect(snap!.firedTargets).toBeUndefined();
    });
  });

  // ─── timeConfig ───

  describe("timeConfig", () => {
    it("returns time config from manifest", () => {
      const manifest = makeManifest({
        captureDelayMs: 500,
        times: [
          { frameNum: 0, systemTimeUtc: "2024-01-15T12:00:00", date: "2035-06-10", timeMultiplier: 2 },
        ],
      });
      engine.loadRecording(manifest);

      const config = engine.timeConfig;
      expect(config.captureDelayMs).toBe(500);
      expect(config.times).toHaveLength(1);
      expect(config.missionDate).toBe("2035-06-10");
      expect(config.missionTimeMultiplier).toBe(2);
    });

    it("returns undefined missionDate when no times", () => {
      const manifest = makeManifest({ times: [] });
      engine.loadRecording(manifest);

      const config = engine.timeConfig;
      expect(config.missionDate).toBeUndefined();
      expect(config.missionTimeMultiplier).toBeUndefined();
    });
  });

  // ─── panToEntity ───

  describe("panToEntity", () => {
    it("does not call setView when entity has no snapshot", () => {
      const manifest = makeManifest({ endFrame: 9 });
      engine.loadRecording(manifest);

      const spy = vi.spyOn(renderer, "setView");
      engine.panToEntity(999); // non-existent entity

      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("panToPosition", () => {
    it("calls setView with the given Arma position", () => {
      const manifest = makeManifest({ endFrame: 9 });
      engine.loadRecording(manifest);

      const spy = vi.spyOn(renderer, "setView");
      engine.panToPosition([5000, 6000]);

      expect(spy).toHaveBeenCalledWith([5000, 6000]);
    });
  });
});
