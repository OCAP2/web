import { afterEach, describe, expect, it, vi } from "vitest";
import { ChunkManager } from "../../data/chunkManager";
import type { ApiClient } from "../../data/apiClient";
import type { DecoderStrategy } from "../../data/decoders/decoder.interface";
import type { ChunkData, EntityState, Manifest } from "../../data/types";
import { MockRenderer } from "../../renderers/mockRenderer";
import { buildMovementStats } from "../../pages/recording-playback/movement";
import { buildOrbat, buildVehicleOccupancy, selectVehicleOccupancy } from "../../pages/recording-playback/orbat";
import { buildDeathSites } from "../deathHeatmap";
import { PlaybackEngine } from "../engine";

const engines: PlaybackEngine[] = [];
afterEach(() => {
  for (const engine of engines) engine.dispose();
  engines.length = 0;
});

async function recording(chunked = true) {
  const manifest: Manifest = {
    version: 1, worldName: "altis", missionName: "Four chunks", endFrame: 1199,
    chunkSize: 300, chunkCount: chunked ? 4 : 0, captureDelayMs: 1000,
    entities: [
      { id: 1, type: "man", name: "Walker", side: "WEST", groupName: "Alpha",
        isPlayer: true, startFrame: 0, endFrame: 1199 },
      { id: 2, type: "man", name: "Late joiner", side: "WEST", groupName: "Bravo",
        isPlayer: true, startFrame: 3, endFrame: 307 },
      { id: 9, type: "truck", name: "Truck", side: "WEST", groupName: "",
        isPlayer: false, startFrame: 0, endFrame: 1199 },
    ],
    events: [920, 20, 620, 320].map((frameNum) => ({
      frameNum, type: "killed", victimId: 1, causedById: 2, weapon: "Test", distance: 10,
    })),
    markers: [], times: [],
  };
  const state = (id: number, frame: number): EntityState => ({
    position: [frame, 10], direction: 0, alive: 1,
    groupName: id === 1 ? "Alpha" : "Bravo", isPlayer: id !== 9,
    // The player only used the truck in the first chunk.
    crewIds: id === 9 && frame < 100 ? [1] : [],
  });
  const getChunk = vi.fn(async (_filename: string, index: number) => new Uint32Array([index]).buffer);
  const api = {
    getManifest: vi.fn(async () => new ArrayBuffer(0)), getChunk,
  } as unknown as ApiClient;
  const decoder: DecoderStrategy = {
    decodeManifest: () => manifest,
    decodeChunk: (buffer): ChunkData => {
      const index = new Uint32Array(buffer)[0];
      return { entities: new Map(manifest.entities.map((entity) => [entity.id,
        Array.from({ length: 300 }, (_, offset) => state(entity.id, index * 300 + offset)),
      ])) };
    },
    decodePlayerSnapshots: () => [],
  };
  const cache = new ChunkManager(decoder, api);
  if (chunked) {
    await cache.loadManifest("four-chunks");
    await cache.ensureLoaded(0);
  } else {
    for (const entity of manifest.entities) {
      entity.positions = Array.from({ length: entity.endFrame - entity.startFrame + 1 },
        (_, offset) => state(entity.id, entity.startFrame + offset));
    }
  }
  const engine = new PlaybackEngine(new MockRenderer());
  engines.push(engine);
  engine.loadRecording(manifest, chunked ? cache : undefined);
  return { engine, cache, getChunk };
}

describe("whole-mission analysis with the real three-chunk cache", () => {
  it("counts movement from all four chunks, including steps across their boundaries", async () => {
    const { engine, cache } = await recording();
    const stats = await buildMovementStats(engine);
    expect(stats.find((row) => row.unitId === 1)?.total).toBe(1195);
    // A delayed start and a step that does not divide 300 preserve sample alignment.
    const uneven = await buildMovementStats(engine, { step: 7 });
    expect(uneven.find((row) => row.unitId === 2)?.total).toBe(301);
    expect([0, 300, 600, 900].filter((frame) => cache.getChunkForFrame(frame))).toHaveLength(3);
    expect(engine.getStateAt(1, 300)).toBeNull();
    expect(engine.getStateAt(1, 0)?.position).toEqual([0, 10]);
    expect(buildOrbat(engine, "WEST", 0)[0].members[0].name).toBe("Walker");
  });

  it("retains early vehicle crew history and filters it without fetching again", async () => {
    const { engine, cache, getChunk } = await recording();
    const history = await buildVehicleOccupancy(engine, 0);
    // Evict the early data again: the displayed strip must survive independently.
    for (let index = 1; index < 4; index++) await cache.loadChunk(index);
    expect(engine.getStateAt(9, 0)).toBeNull();
    const requests = getChunk.mock.calls.length;
    const [early] = selectVehicleOccupancy(engine, history, 0, { side: "WEST", playersOnly: true });
    expect(early.peak).toBe(1);
    expect(early.samples[0]).toEqual({ frame: 0, crewIds: [1] });
    expect(early.occupiedNow).toBe(true);
    expect(selectVehicleOccupancy(engine, history, 1199)[0].occupiedNow).toBe(false);
    expect(selectVehicleOccupancy(engine, history, 0, { side: "EAST", playersOnly: true })).toEqual([]);
    expect(getChunk).toHaveBeenCalledTimes(requests);
  });

  it("resolves deaths in every chunk into durable, chronological positions", async () => {
    const { engine, cache } = await recording();
    const sites = await buildDeathSites(engine);
    for (let index = 1; index < 4; index++) await cache.loadChunk(index);
    expect(engine.getPositionAt(1, 20)).toBeNull();
    expect(sites).toEqual([20, 320, 620, 920].map((frameNum) => ({ frameNum, x: frameNum, y: 10 })));
  });

  it("produces the same results for dense JSON and bounded chunk playback", async () => {
    const { engine: chunked } = await recording();
    const { engine: json } = await recording(false);
    expect(await buildMovementStats(chunked)).toEqual(await buildMovementStats(json));
    expect(await buildVehicleOccupancy(chunked, 700)).toEqual(await buildVehicleOccupancy(json, 700));
    expect(await buildDeathSites(chunked)).toEqual(await buildDeathSites(json));
  });

  it("propagates a failed chunk load and restores the paused playhead", async () => {
    const { engine, getChunk } = await recording();
    getChunk.mockImplementation(async (_filename, index) => {
      if (index === 3) throw new Error("unavailable chunk");
      return new Uint32Array([index]).buffer;
    });
    await expect(buildMovementStats(engine)).rejects.toThrow("unavailable chunk");
    expect(engine.getStateAt(1, 0)?.position).toEqual([0, 10]);
    expect(engine.entitySnapshots().get(1)?.position).toEqual([0, 10]);
  });
});
