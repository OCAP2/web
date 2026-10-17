import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemo, createRoot } from "solid-js";
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
import { eventInvolvedSides } from "../components/EventsTab";

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
  it("retains transmission factions after the speaker departs and the event chunk is evicted", async () => {
    const { api, rec, engine, markerManager, getChunk, raw } = fixture();
    raw.events = PbManifest.fromPartial({ events: [{
      frameNum: 901, type: "radioTransmission",
      message: JSON.stringify({ unitId: 1, radio: "TFAR_anprc152", type: "SW", action: "Start",
        channel: 1, additional: false, frequency: 100, code: "blue" }),
    }] }).events;
    raw.entities[0].endFrame = 1000;
    await loadRecording(api, engine, markerManager, rec);
    const transmission = engine.eventManager.getAll()[0];
    expect(getChunk.mock.calls.map((call) => call[1])).toEqual([0]);
    // An unavailable event-frame history uses the stable spawn side, not the
    // speaker's EAST side at the playhead in chunk zero, and causes no fetch.
    expect(engine.entitySnapshots().get(1)?.side).toBe("EAST");
    expect(eventInvolvedSides(transmission, engine)).toEqual(["WEST"]);

    const version = engine.eventReferencesVersion();
    engine.seekTo(901);
    await vi.waitFor(() => expect(engine.getStateAt(1, 901)).not.toBeNull());
    expect(engine.eventReferencesVersion()).toBeGreaterThan(version);
    expect(eventInvolvedSides(transmission, engine)).toEqual(["EAST"]);
    for (const frame of [1201, 0, 301, 601]) {
      engine.seekTo(frame);
      await vi.waitFor(() => expect(engine.getStateAt(2, frame)).not.toBeNull());
      expect(eventInvolvedSides(transmission, engine)).toEqual(["EAST"]);
      if (frame === 1201) expect(engine.entitySnapshots().has(1)).toBe(false);
    }
    expect(engine.getStateAt(1, 901)).toBeNull();
    expect(getChunk.mock.calls.map((call) => call[1])).toEqual([0, 3, 4, 1, 2]);
  });

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

  it("opens with chunk zero and retains event-time factions as later chunks arrive", async () => {
    const { api, rec, engine, markerManager, getChunk } = fixture();
    await loadRecording(api, engine, markerManager, rec);
    expect(getChunk.mock.calls.map((call) => call[1])).toEqual([0]);

    for (const frame of [301, 901, 1201, 0]) {
      engine.seekTo(frame);
      await vi.waitFor(() => expect(engine.getStateAt(1, frame)).not.toBeNull());
    }

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
      for (const frame of [301, 901, 1201]) {
        engine.seekTo(frame);
        await vi.waitFor(() => expect(engine.getStateAt(1, frame)).not.toBeNull());
      }
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

  it("opens early playback even when a distant combat chunk is unavailable", async () => {
    const { api, rec, engine, markerManager, getChunk } = fixture();
    const original = getChunk.getMockImplementation()!;
    getChunk.mockImplementation(async (filename, index) => {
      if (index === 3) throw new Error("event chunk unavailable");
      return original(filename, index);
    });
    await expect(loadRecording(api, engine, markerManager, rec)).resolves.toBeDefined();
    expect(getChunk.mock.calls.map((call) => call[1])).toEqual([0]);
    expect(engine.getStateAt(1, 0)).not.toBeNull();
    expect(combat(engine)[0].isFriendlyFire()).toBe(false);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      engine.seekTo(901);
      await vi.waitFor(() => expect(errors).toHaveBeenCalled());
      engine.seekTo(0);
      expect(engine.getStateAt(1, 0)).not.toBeNull();
    } finally { errors.mockRestore(); }
  });

  it("refreshes classification and scores at a paused frame without counting a kill twice", async () => {
    const { api, rec, engine, markerManager } = fixture();
    await loadRecording(api, engine, markerManager, rec);
    const dispose = createRoot((dispose) => {
      const friendly = createMemo(() => {
        engine.eventReferencesVersion();
        return combat(engine).find((event) => event.frameNum === 301)!.isFriendlyFire();
      });
      return { dispose, friendly };
    });
    try {
      engine.seekTo(301);
      await vi.waitFor(() => expect(dispose.friendly()).toBe(false));
      const shooter = engine.entityManager.getEntity(1) as Unit;
      const counts = [shooter.killCount, shooter.teamKillCount, shooter.deathCount];
      for (const frame of [601, 901, 1201, 0, 301]) {
        engine.seekTo(frame);
        await vi.waitFor(() => expect(engine.getStateAt(1, frame)).not.toBeNull());
      }
      expect(shooter.killCount).toBe(counts[0]);
      expect(shooter.deathCount).toBe(counts[2]);
      expect(shooter.teamKillCount).toBe(1);
    } finally { dispose.dispose(); }
  });

  it("loads only the initial chunk when the recording has no combat events", async () => {
    const { api, rec, engine, markerManager, getChunk, raw } = fixture();
    raw.events = [];
    await loadRecording(api, engine, markerManager, rec);
    expect(getChunk.mock.calls.map((call) => call[1])).toEqual([0]);
  });
});
