import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../../data/apiClient";
import { ChunkManager } from "../../../data/chunkManager";
import { ProtobufDecoder } from "../../../data/decoders/protobufDecoder";
import {
  Chunk as PbChunk,
  EntityType as PbEntityType,
  Manifest as PbManifest,
  Side as PbSide,
} from "../../../data/decoders/generated/ocap.pb";
import type { EntityState, Recording } from "../../../data/types";
import { PlaybackEngine } from "../../../playback/engine";
import { Unit } from "../../../playback/entities/unit";
import { HitKilledEvent } from "../../../playback/events/hitKilledEvent";
import { MarkerManager } from "../../../playback/markerManager";
import { MockRenderer } from "../../../renderers/mockRenderer";
import { loadRecording } from "../loadRecording";

const engines: PlaybackEngine[] = [];
afterEach(() => {
  for (const engine of engines) engine.dispose();
  engines.length = 0;
});

const buffer = (bytes: Uint8Array): ArrayBuffer => new Uint8Array(bytes).buffer;

function fixture(recordSides = true) {
  const killFrames = [1, 301, 901, 1201];
  const raw = PbManifest.fromPartial({
    version: 1, worldName: "altis", missionName: "Faction changes", endFrame: 1499,
    chunkSize: 300, chunkCount: 5, captureDelayMs: 1000,
    entities: [1, 2].map((id) => ({
      id, type: PbEntityType.ENTITY_TYPE_UNIT, name: `Unit ${id}`, side: PbSide.SIDE_WEST,
      isPlayer: true, startFrame: 0, endFrame: 1499,
    })),
    events: [
      ...killFrames.map((frameNum) => ({ frameNum, type: "killed", sourceId: 1, targetId: 2, weapon: "MX" })),
      { frameNum: 302, type: "hit", sourceId: 1, targetId: 2, weapon: "MX" },
    ],
  });
  const state = (id: number, frame: number): EntityState => ({
    position: [frame, id], direction: 0, alive: 1,
    ...(recordSides ? { side: id === 1
      ? (frame < 300 || (frame >= 900 && frame < 1200) ? "EAST" : "WEST")
      : (frame < 300 ? "WEST" : "EAST") } as const : {}),
  });
  const getChunk = vi.fn(async (_filename: string, index: number) => buffer(PbChunk.encode(PbChunk.fromPartial({
    startFrame: index * 300, frameCount: 300,
    frames: Array.from({ length: 300 }, (_, offset) => {
      const frameNum = index * 300 + offset;
      return { frameNum, entities: [1, 2].map((entityId) => {
        const current = state(entityId, frameNum);
        return { entityId, posX: current.position[0], posY: current.position[1], alive: 1, side: current.side ?? "" };
      }) };
    }),
  })).finish()));
  const api = {
    getWorldConfig: vi.fn(async () => ({ worldName: "altis", worldSize: 30720, minZoom: 0, maxZoom: 6 })),
    getManifest: vi.fn(async () => buffer(PbManifest.encode(raw).finish())),
    getChunk,
  } as unknown as ApiClient;
  const rec: Recording = {
    id: "42", filename: "faction-changes", worldName: "altis", missionName: "Faction changes",
    storageFormat: "protobuf", date: "2026-10-17", missionDuration: 1500,
  };
  const renderer = new MockRenderer();
  const engine = new PlaybackEngine(renderer);
  engines.push(engine);
  const markerManager = new MarkerManager(renderer);
  return { api, rec, engine, markerManager, getChunk, raw, state };
}

function combat(engine: PlaybackEngine): HitKilledEvent[] {
  return engine.eventManager.getAll().filter((event): event is HitKilledEvent => event instanceof HitKilledEvent);
}

describe("converted recording event-time factions", () => {
  it("uses an already-loaded chunk when resolving engine references directly", async () => {
    const { api, engine } = fixture();
    const chunks = new ChunkManager(new ProtobufDecoder(), api);
    const manifest = await chunks.loadManifest("faction-changes");
    await chunks.loadChunk(0);
    engine.loadRecording(manifest, chunks);
    const first = combat(engine).find((event) => event.frameNum === 1)!;
    expect(engine.getStateAt(1, 1)?.side).toBe("EAST");
    expect(first.isFriendlyFire()).toBe(false);
    expect(first.causerKillScore).toBe(1);
  });

  it("resolves hits and kills outside the initial chunk before playback is ready", async () => {
    const { api, rec, engine, markerManager, getChunk } = fixture();
    await loadRecording(api, engine, markerManager, rec);

    expect(engine.entityManager.getEntity(1)?.positions).toBeNull();
    const kills = combat(engine).filter((event) => event.type === "killed");
    expect(kills.map((event) => [event.causerSide, event.victimSide, event.isFriendlyFire(), event.causerKillScore]))
      .toEqual([
        ["EAST", "WEST", false, 1],
        ["WEST", "EAST", false, 2],
        ["EAST", "EAST", true, 1],
        ["WEST", "EAST", false, 2],
      ]);
    expect(combat(engine).find((event) => event.type === "hit")?.isFriendlyFire()).toBe(false);
    const shooter = engine.entityManager.getEntity(1) as Unit;
    expect([shooter.killCount, shooter.teamKillCount]).toEqual([4, 1]);
    expect(engine.eventManager.getKillDeathCounts(301).teamKills.get(1)).toBeUndefined();
    expect(engine.eventManager.getKillDeathCounts(1499).teamKills.get(1)).toBe(1);
    // Four distinct event chunks overflow the real three-chunk cache. The
    // event sides remain correct even though chunk 1 has already been evicted.
    expect(engine.getStateAt(1, 301)).toBeNull();
    expect(engine.getStateAt(1, 0)?.side).toBe("EAST");
    expect(getChunk.mock.calls.map((call) => call[1])).not.toContain(2);
  });

  it("matches dense JSON results and retains the spawn-side fallback for older protobuf files", async () => {
    for (const recordSides of [true, false]) {
      const { api, rec, engine, markerManager, raw, state } = fixture(recordSides);
      await loadRecording(api, engine, markerManager, rec);
      const manifest = new ProtobufDecoder().decodeManifest(buffer(PbManifest.encode(raw).finish()));
      manifest.chunkCount = 0;
      for (const entity of manifest.entities) {
        entity.positions = Array.from({ length: 1500 }, (_, frame) => state(entity.id, frame));
      }
      const dense = new PlaybackEngine(new MockRenderer());
      engines.push(dense);
      dense.loadRecording(manifest);
      expect(combat(engine).map((event) => [event.causerSide, event.victimSide, event.causerKillScore]))
        .toEqual(combat(dense).map((event) => [event.causerSide, event.victimSide, event.causerKillScore]));
      if (!recordSides) expect(combat(engine).every((event) => event.isFriendlyFire())).toBe(true);
    }
  });

  it("reports an unavailable event chunk instead of publishing spawn-side classifications", async () => {
    const { api, rec, engine, markerManager, getChunk } = fixture();
    const original = getChunk.getMockImplementation()!;
    getChunk.mockImplementation(async (filename, index) => {
      if (index === 3) throw new Error("event chunk unavailable");
      return original(filename, index);
    });
    await expect(loadRecording(api, engine, markerManager, rec)).rejects.toThrow("event chunk unavailable");
    expect(engine.eventManager.getAll()).toEqual([]);
  });

  it("loads only the initial chunk when the recording has no combat events", async () => {
    const { api, rec, engine, markerManager, getChunk, raw } = fixture();
    raw.events = [];
    await loadRecording(api, engine, markerManager, rec);
    expect(getChunk.mock.calls.map((call) => call[1])).toEqual([0]);
  });
});
