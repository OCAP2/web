import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PlaybackEngine } from "../playback/engine";
import { MockRenderer } from "../renderers/mockRenderer";
import { EntityManager } from "../playback/entityManager";
import { Unit } from "../playback/entities/unit";
import { Vehicle } from "../playback/entities/vehicle";
import { HitKilledEvent } from "../playback/events/hitKilledEvent";
import type {
  Manifest,
  EntityDef,
  EventDef,
  ChunkData,
  EntityState,
} from "../data/types";
import type { ChunkManager } from "../data/chunkManager";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeManifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    version: 1,
    worldName: "Altis",
    missionName: "Integration Test Mission",
    frameCount: 100,
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

function makeEntityStates(
  count: number,
  opts: {
    baseX?: number;
    baseY?: number;
    alive?: 0 | 1 | 2;
    isInVehicle?: boolean;
  } = {},
): EntityState[] {
  const { baseX = 100, baseY = 200, alive = 1, isInVehicle = false } = opts;
  const states: EntityState[] = [];
  for (let i = 0; i < count; i++) {
    states.push({
      position: [baseX + i, baseY + i],
      direction: i * 3.6,
      alive,
      isInVehicle,
    });
  }
  return states;
}

function makeChunkData(
  entityMap: Map<number, (EntityState | undefined)[]>,
): ChunkData {
  // Convert to the expected Map<number, EntityState[]> shape
  return { entities: entityMap as unknown as Map<number, EntityState[]> };
}

function makeMockChunkManager(
  chunkData: ChunkData | null = null,
): ChunkManager {
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
// Integration tests
// ---------------------------------------------------------------------------

describe("Integration: Full stack playback", () => {
  let engine: PlaybackEngine;
  let renderer: MockRenderer;

  beforeEach(() => {
    vi.useFakeTimers();
    renderer = new MockRenderer();
    engine = new PlaybackEngine(renderer);
  });

  afterEach(() => {
    engine.dispose();
    vi.useRealTimers();
  });

  it("loads operation and verifies entities, events, and endFrame", () => {
    const entities: EntityDef[] = [
      makeEntityDef({ id: 1, name: "Alpha1", side: "WEST" }),
      makeEntityDef({ id: 2, name: "Bravo1", side: "EAST", type: "car" }),
      makeEntityDef({ id: 3, name: "Charlie1", side: "GUER" }),
    ];

    const events: EventDef[] = [
      {
        frameNum: 10,
        type: "killed",
        victimId: 1,
        causedById: 3,
        distance: 150,
        weapon: "AK-74",
      },
      { frameNum: 20, type: "connected", unitName: "Player1" },
      {
        frameNum: 30,
        type: "hit",
        victimId: 3,
        causedById: 1,
        distance: 50,
        weapon: "M4A1",
      },
    ];

    const manifest = makeManifest({
      frameCount: 200,
      entities,
      events,
    });

    // Build chunk data for all entities across 300 frames (chunk 0)
    const entityStates = new Map<number, EntityState[]>();
    entityStates.set(1, makeEntityStates(300, { baseX: 0, baseY: 0 }));
    entityStates.set(2, makeEntityStates(300, { baseX: 500, baseY: 500 }));
    entityStates.set(3, makeEntityStates(300, { baseX: 1000, baseY: 1000 }));

    const chunkData = makeChunkData(entityStates);
    const cm = makeMockChunkManager(chunkData);

    // Load operation
    engine.loadRecording(manifest, cm);

    // Verify entities populated
    expect(engine.entityManager.getAll()).toHaveLength(3);
    expect(engine.entityManager.getEntity(1)?.name).toBe("Alpha1");
    expect(engine.entityManager.getEntity(2)?.name).toBe("Bravo1");
    expect(engine.entityManager.getEntity(3)?.name).toBe("Charlie1");

    // Verify events populated (connected + 2 hit/killed = 3, but connected only produces ConnectEvent)
    // hit and killed produce HitKilledEvent, connected produces ConnectEvent
    expect(engine.eventManager.getAll()).toHaveLength(3);

    // Verify endFrame = frameCount - 1
    expect(engine.endFrame()).toBe(199);
  });

  it("plays and advances frames via timer ticks", () => {
    const entityStates = new Map<number, EntityState[]>();
    entityStates.set(1, makeEntityStates(300));

    const chunkData = makeChunkData(entityStates);
    const cm = makeMockChunkManager(chunkData);

    const manifest = makeManifest({
      frameCount: 50,
      captureDelayMs: 500,
      entities: [makeEntityDef({ id: 1, endFrame: 49 })],
    });

    engine.loadRecording(manifest, cm);
    engine.setSpeed(1);

    // Start playback
    engine.play();
    expect(engine.isPlaying()).toBe(true);
    expect(engine.currentFrame()).toBe(0);

    // Advance 3 ticks at 500ms each
    vi.advanceTimersByTime(500);
    expect(engine.currentFrame()).toBe(1);

    vi.advanceTimersByTime(500);
    expect(engine.currentFrame()).toBe(2);

    vi.advanceTimersByTime(500);
    expect(engine.currentFrame()).toBe(3);

    // Verify snapshots are updated at frame 3
    const snapshots = engine.entitySnapshots();
    expect(snapshots.has(1)).toBe(true);
    const snap = snapshots.get(1)!;
    expect(snap.position).toEqual([103, 203]); // baseX+3, baseY+3
    expect(snap.direction).toBeCloseTo(10.8); // 3 * 3.6
    expect(snap.alive).toBe(1);
  });

  it("seekTo updates currentFrame and snapshots at that frame", () => {
    const entityStates = new Map<number, EntityState[]>();
    entityStates.set(1, makeEntityStates(300));

    const chunkData = makeChunkData(entityStates);
    const cm = makeMockChunkManager(chunkData);

    const manifest = makeManifest({
      frameCount: 100,
      entities: [makeEntityDef({ id: 1 })],
    });

    engine.loadRecording(manifest, cm);

    // Seek to frame 42
    engine.seekTo(42);
    expect(engine.currentFrame()).toBe(42);

    // Verify snapshot at frame 42
    const snapshots = engine.entitySnapshots();
    expect(snapshots.has(1)).toBe(true);
    const snap = snapshots.get(1)!;
    expect(snap.position).toEqual([142, 242]); // 100+42, 200+42
    expect(snap.direction).toBeCloseTo(42 * 3.6);
  });

  it("pause stops frame advancement", () => {
    const entityStates = new Map<number, EntityState[]>();
    entityStates.set(1, makeEntityStates(300));

    const chunkData = makeChunkData(entityStates);
    const cm = makeMockChunkManager(chunkData);

    const manifest = makeManifest({
      frameCount: 100,
      captureDelayMs: 200,
      entities: [makeEntityDef({ id: 1 })],
    });

    engine.loadRecording(manifest, cm);
    engine.setSpeed(1);

    // Play for 3 ticks
    engine.play();
    vi.advanceTimersByTime(600);
    expect(engine.currentFrame()).toBe(3);
    expect(engine.isPlaying()).toBe(true);

    // Pause
    engine.pause();
    expect(engine.isPlaying()).toBe(false);

    // Advance timers further - frame should NOT change
    vi.advanceTimersByTime(2000);
    expect(engine.currentFrame()).toBe(3);
  });

  it("full lifecycle: load -> play -> seek -> pause -> play -> end", () => {
    const entityStates = new Map<number, EntityState[]>();
    entityStates.set(1, makeEntityStates(300));

    const chunkData = makeChunkData(entityStates);
    const cm = makeMockChunkManager(chunkData);

    const manifest = makeManifest({
      frameCount: 10,
      captureDelayMs: 100,
      entities: [makeEntityDef({ id: 1, endFrame: 9 })],
    });

    engine.loadRecording(manifest, cm);
    engine.setSpeed(1);
    expect(engine.currentFrame()).toBe(0);
    expect(engine.endFrame()).toBe(9);

    // Play
    engine.play();
    vi.advanceTimersByTime(300); // 3 ticks
    expect(engine.currentFrame()).toBe(3);

    // Seek back to frame 1
    engine.seekTo(1);
    expect(engine.currentFrame()).toBe(1);
    // Engine is still "playing" from the timer perspective
    // but seekTo doesn't stop playback

    // Pause
    engine.pause();
    expect(engine.isPlaying()).toBe(false);
    expect(engine.currentFrame()).toBe(1);

    // Play again to the end
    engine.play();
    // Need to advance enough ticks to reach frame 9 (8 more ticks from frame 1)
    vi.advanceTimersByTime(800);
    expect(engine.currentFrame()).toBe(9);
    expect(engine.isPlaying()).toBe(false); // auto-paused at end
  });
});

describe("Integration: Entity type verification", () => {
  it("creates Unit instances for type 'man'", () => {
    const em = new EntityManager();
    const unitDef = makeEntityDef({
      id: 1,
      type: "man",
      name: "Soldier1",
      side: "WEST",
    });
    const entity = em.addEntity(unitDef);

    expect(entity).toBeInstanceOf(Unit);
    expect(entity.name).toBe("Soldier1");
    expect((entity as Unit).side).toBe("WEST");
    expect((entity as Unit).isPlayer).toBe(true);
    expect((entity as Unit).groupName).toBe("Alpha");
  });

  it("creates Vehicle instances for non-'man' types", () => {
    const em = new EntityManager();

    const vehicleTypes = [
      "car",
      "tank",
      "apc",
      "truck",
      "heli",
      "plane",
      "ship",
    ] as const;

    for (let i = 0; i < vehicleTypes.length; i++) {
      const def = makeEntityDef({
        id: 10 + i,
        type: vehicleTypes[i],
        name: `Vehicle_${vehicleTypes[i]}`,
      });
      const entity = em.addEntity(def);
      expect(entity).toBeInstanceOf(Vehicle);
      expect(entity).not.toBeInstanceOf(Unit);
      expect(entity.name).toBe(`Vehicle_${vehicleTypes[i]}`);
    }
  });

  it("mixed manifest produces correct entity types", () => {
    const renderer = new MockRenderer();
    const engine = new PlaybackEngine(renderer);

    const manifest = makeManifest({
      frameCount: 100,
      entities: [
        makeEntityDef({ id: 1, type: "man", name: "Rifleman" }),
        makeEntityDef({ id: 2, type: "car", name: "MRAP" }),
        makeEntityDef({ id: 3, type: "heli", name: "Ghosthawk" }),
        makeEntityDef({ id: 4, type: "man", name: "Medic" }),
        makeEntityDef({ id: 5, type: "tank", name: "Slammer" }),
      ],
    });

    const cm = makeMockChunkManager();
    engine.loadRecording(manifest, cm);

    // Verify units
    const units = engine.entityManager.getUnits();
    expect(units).toHaveLength(2);
    expect(units.map((u) => u.name).sort()).toEqual(["Medic", "Rifleman"]);

    // Verify vehicles
    const vehicles = engine.entityManager.getVehicles();
    expect(vehicles).toHaveLength(3);
    expect(vehicles.map((v) => v.name).sort()).toEqual([
      "Ghosthawk",
      "MRAP",
      "Slammer",
    ]);

    engine.dispose();
  });
});

describe("Integration: Event resolution", () => {
  let engine: PlaybackEngine;
  let renderer: MockRenderer;

  beforeEach(() => {
    vi.useFakeTimers();
    renderer = new MockRenderer();
    engine = new PlaybackEngine(renderer);
  });

  afterEach(() => {
    engine.dispose();
    vi.useRealTimers();
  });

  it("resolves victim and causer names on HitKilled events", () => {
    const manifest = makeManifest({
      frameCount: 100,
      entities: [
        makeEntityDef({
          id: 1,
          type: "man",
          name: "Victim_Soldier",
          side: "WEST",
        }),
        makeEntityDef({
          id: 2,
          type: "man",
          name: "Killer_Soldier",
          side: "EAST",
        }),
      ],
      events: [
        {
          frameNum: 15,
          type: "killed",
          victimId: 1,
          causedById: 2,
          distance: 250,
          weapon: "AK-74M",
        },
      ],
    });

    const cm = makeMockChunkManager();
    engine.loadRecording(manifest, cm);

    // Get the resolved event
    const events = engine.eventManager.getAll();
    expect(events).toHaveLength(1);

    const event = events[0] as HitKilledEvent;
    expect(event).toBeInstanceOf(HitKilledEvent);
    expect(event.victimName).toBe("Victim_Soldier");
    expect(event.causerName).toBe("Killer_Soldier");
    expect(event.victimSide).toBe("WEST");
    expect(event.causerSide).toBe("EAST");
    expect(event.weapon).toBe("AK-74M");
    expect(event.distance).toBe(250);
  });

  it("resolves multiple HitKilled events with correct references", () => {
    const manifest = makeManifest({
      frameCount: 100,
      entities: [
        makeEntityDef({ id: 1, name: "UnitA", side: "WEST" }),
        makeEntityDef({ id: 2, name: "UnitB", side: "EAST" }),
        makeEntityDef({ id: 3, name: "UnitC", side: "GUER" }),
      ],
      events: [
        {
          frameNum: 10,
          type: "hit",
          victimId: 1,
          causedById: 2,
          distance: 100,
          weapon: "Pistol",
        },
        {
          frameNum: 20,
          type: "killed",
          victimId: 2,
          causedById: 3,
          distance: 300,
          weapon: "Sniper",
        },
        {
          frameNum: 30,
          type: "killed",
          victimId: 3,
          causedById: 1,
          distance: 50,
          weapon: "Grenade",
        },
      ],
    });

    const cm = makeMockChunkManager();
    engine.loadRecording(manifest, cm);

    const events = engine.eventManager.getAll();
    expect(events).toHaveLength(3);

    // First event: UnitB hits UnitA
    const e0 = events[0] as HitKilledEvent;
    expect(e0.type).toBe("hit");
    expect(e0.victimName).toBe("UnitA");
    expect(e0.causerName).toBe("UnitB");
    expect(e0.victimSide).toBe("WEST");
    expect(e0.causerSide).toBe("EAST");

    // Second event: UnitC kills UnitB
    const e1 = events[1] as HitKilledEvent;
    expect(e1.type).toBe("killed");
    expect(e1.victimName).toBe("UnitB");
    expect(e1.causerName).toBe("UnitC");
    expect(e1.victimSide).toBe("EAST");
    expect(e1.causerSide).toBe("GUER");

    // Third event: UnitA kills UnitC
    const e2 = events[2] as HitKilledEvent;
    expect(e2.type).toBe("killed");
    expect(e2.victimName).toBe("UnitC");
    expect(e2.causerName).toBe("UnitA");
    expect(e2.victimSide).toBe("GUER");
    expect(e2.causerSide).toBe("WEST");
  });

  it("handles events where victim or causer is a vehicle (no side resolution)", () => {
    const manifest = makeManifest({
      frameCount: 100,
      entities: [
        makeEntityDef({
          id: 1,
          type: "man",
          name: "Soldier",
          side: "WEST",
        }),
        makeEntityDef({
          id: 2,
          type: "car",
          name: "MRAP",
          side: "EAST",
        }),
      ],
      events: [
        {
          frameNum: 10,
          type: "killed",
          victimId: 1,
          causedById: 2,
          distance: 5,
          weapon: "Roadkill",
        },
      ],
    });

    const cm = makeMockChunkManager();
    engine.loadRecording(manifest, cm);

    const event = engine.eventManager.getAll()[0] as HitKilledEvent;
    expect(event.victimName).toBe("Soldier");
    expect(event.causerName).toBe("MRAP");
    // Victim is a Unit, so side is resolved
    expect(event.victimSide).toBe("WEST");
    // Causer is a Vehicle (not Unit), so side is NOT resolved
    expect(event.causerSide).toBeUndefined();
  });

  it("events at specific frames are retrievable after load", () => {
    const manifest = makeManifest({
      frameCount: 100,
      entities: [
        makeEntityDef({ id: 1, name: "A" }),
        makeEntityDef({ id: 2, name: "B" }),
      ],
      events: [
        {
          frameNum: 5,
          type: "killed",
          victimId: 1,
          causedById: 2,
          distance: 10,
          weapon: "Knife",
        },
        { frameNum: 5, type: "connected", unitName: "NewPlayer" },
        {
          frameNum: 15,
          type: "hit",
          victimId: 2,
          causedById: 1,
          distance: 20,
          weapon: "Rifle",
        },
      ],
    });

    const cm = makeMockChunkManager();
    engine.loadRecording(manifest, cm);

    // Two events at frame 5 (cumulative: 2)
    engine.seekTo(5);
    expect(engine.activeEvents()).toHaveLength(2);

    // Frame 15 has all events up to and including frame 15 (cumulative: 3)
    engine.seekTo(15);
    expect(engine.activeEvents()).toHaveLength(3);

    // No events at frame 0
    engine.seekTo(0);
    expect(engine.activeEvents()).toHaveLength(0);
  });
});
