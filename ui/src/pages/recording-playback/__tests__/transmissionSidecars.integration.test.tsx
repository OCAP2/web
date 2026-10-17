import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "solid-js";
import type { ApiClient } from "../../../data/apiClient";
import { ChunkManager } from "../../../data/chunkManager";
import { ProtobufDecoder } from "../../../data/decoders/protobufDecoder";
import {
  Chunk as PbChunk, Manifest as PbManifest, PlayerSnapshotSeries,
  EntityType, Side,
} from "../../../data/decoders/generated/ocap.pb";
import { PlaybackEngine } from "../../../playback/engine";
import { MarkerManager } from "../../../playback/markerManager";
import { MockRenderer } from "../../../renderers/mockRenderer";
import { useRenderBridge } from "../useRenderBridge";

const cleanup: Array<() => void> = [];
afterEach(() => { for (const dispose of cleanup.splice(0).reverse()) dispose(); vi.restoreAllMocks(); });
const buffer = (bytes: Uint8Array): ArrayBuffer => new Uint8Array(bytes).buffer;

async function setup(transmit = true) {
  const manifest = PbManifest.fromPartial({
    version: 1, worldName: "altis", missionName: "Sidecar radios", endFrame: 10,
    chunkSize: 300, chunkCount: 1, captureDelayMs: 1000, snapshotUnitIds: [1, 2, 3],
    entities: [1, 2, 3].map((id) => ({ id, name: `Unit ${id}`, type: EntityType.ENTITY_TYPE_UNIT,
      side: Side.SIDE_WEST, isPlayer: true, startFrame: 0, endFrame: 10 })),
    events: transmit ? [{ frameNum: 0, type: "radioTransmission", message: JSON.stringify({
      unitId: 1, radio: "TFAR_anprc152", type: "SW", action: "Start", channel: 1,
      additional: false, frequency: 100, code: "",
    }) }] : [],
  });
  const pending = new Map<number, { resolve: (value: ArrayBuffer) => void; reject: (error: Error) => void }>();
  const getPlayerSnapshots = vi.fn((_filename: string, id: number) => new Promise<ArrayBuffer>((resolve, reject) => {
    pending.set(id, { resolve, reject });
  }));
  const api = {
    getManifest: async () => buffer(PbManifest.encode(manifest).finish()),
    getChunk: vi.fn(async () => buffer(PbChunk.encode(PbChunk.fromPartial({
      startFrame: 0, frameCount: 11, frames: [{ frameNum: 0,
        entities: [1, 2, 3].map((entityId) => ({ entityId, posX: entityId * 100, posY: 100, alive: 1 })),
      }],
    })).finish())),
    getPlayerSnapshots,
  } as unknown as ApiClient;
  const chunks = new ChunkManager(new ProtobufDecoder(), api);
  const decoded = await chunks.loadManifest("sidecar-radios");
  await chunks.loadChunk(0);
  const renderer = new MockRenderer();
  const engine = new PlaybackEngine(renderer);
  cleanup.push(() => engine.dispose());
  engine.loadRecording(decoded, chunks);
  const lines = vi.spyOn(renderer, "addLine");
  const mount = () => cleanup.push(createRoot((dispose) => {
    useRenderBridge(engine, renderer, new MarkerManager(renderer));
    return dispose;
  }));
  const finish = (id: number) => pending.get(id)!.resolve(buffer(PlayerSnapshotSeries.encode(PlayerSnapshotSeries.fromPartial({
    unitId: id, events: [{ frameNum: 0, type: "radioSnapshot", message: JSON.stringify({
      unitId: id, radios: [{ class: "TFAR_anprc152", mod: "TFAR", type: "SW", channel: 1,
        frequency: 100, code: "", rangeMeters: 1000, additional: false }],
    }) }],
  })).finish()));
  return { engine, chunks, decoded, renderer, lines, mount, getPlayerSnapshots, finish, pending };
}

describe("map transmissions with lazy radio sidecars", () => {
  it("requests all radio owners without panel visits and redraws at the same paused frame", async () => {
    const { engine, lines, mount, getPlayerSnapshots, finish } = await setup();
    mount();
    await vi.waitFor(() => expect(getPlayerSnapshots).toHaveBeenCalledTimes(3));
    expect(engine.eventManager.getPlayerSnapshotUnitIds()).toEqual([]);
    finish(1);
    finish(2);
    await vi.waitFor(() => expect(lines).toHaveBeenCalled());
    finish(3);
    await vi.waitFor(() => expect(engine.playerSnapshotsVersion()).toBe(3));
    expect(engine.currentFrame()).toBe(0);
    expect(lines.mock.calls.slice(-2).map((call) => call[1][0])).toEqual([200, 300]);
    expect(lines.mock.calls.slice(-2).every((call) => call[2].color === "#4ade80")).toBe(true);
    await engine.ensureAllPlayerSnapshots();
    expect(getPlayerSnapshots).toHaveBeenCalledTimes(3);
  });

  it("completes the receiver set even if a profile already requested only one sidecar", async () => {
    const { engine, lines, mount, getPlayerSnapshots, finish } = await setup();
    const profileLoad = engine.ensurePlayerSnapshots(2);
    finish(2);
    await profileLoad;
    mount();
    await vi.waitFor(() => expect(getPlayerSnapshots).toHaveBeenCalledTimes(3));
    finish(1);
    finish(3);
    await vi.waitFor(() => expect(engine.playerSnapshotsVersion()).toBe(3));
    expect(new Set(lines.mock.calls.slice(-2).map((call) => call[1][0]))).toEqual(new Set([200, 300]));
    expect(getPlayerSnapshots.mock.calls.filter((call) => call[1] === 2)).toHaveLength(1);
  });

  it("keeps playback and available receiver lines usable when one sidecar fails", async () => {
    const { engine, lines, mount, getPlayerSnapshots, finish, pending } = await setup();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    mount();
    await vi.waitFor(() => expect(getPlayerSnapshots).toHaveBeenCalledTimes(3));
    finish(1);
    pending.get(2)!.reject(new Error("sidecar unavailable"));
    finish(3);
    await vi.waitFor(() => expect(lines).toHaveBeenCalled());
    expect(lines.mock.calls.slice(-1)[0][1][0]).toBe(300);
    expect(engine.getStateAt(1, 0)).not.toBeNull();
    expect(errors).toHaveBeenCalled();
  });

  it("does not request sidecars when there are no transmissions", async () => {
    const { mount, getPlayerSnapshots } = await setup(false);
    mount();
    await Promise.resolve();
    expect(getPlayerSnapshots).not.toHaveBeenCalled();
  });

  it("clears the overlay when replaced by a recording with the same duration", async () => {
    const { engine, renderer, lines, decoded, mount, getPlayerSnapshots, finish } = await setup();
    const removed = vi.spyOn(renderer, "removeLine");
    mount();
    await vi.waitFor(() => expect(getPlayerSnapshots).toHaveBeenCalledTimes(3));
    for (const id of [1, 2, 3]) finish(id);
    await vi.waitFor(() => expect(engine.playerSnapshotsVersion()).toBe(3));
    expect(lines.mock.calls.length - removed.mock.calls.length).toBe(2);
    const entities = decoded.entities.map((entity) => ({
      ...entity, positions: [engine.getStateAt(entity.id, 0)!],
    }));
    engine.loadRecording({ ...decoded, entities, events: [], snapshotUnitIds: [], chunkCount: 0 });
    await vi.waitFor(() => expect(lines.mock.calls.length - removed.mock.calls.length).toBe(0));
    expect(getPlayerSnapshots).toHaveBeenCalledTimes(3);
  });
});
