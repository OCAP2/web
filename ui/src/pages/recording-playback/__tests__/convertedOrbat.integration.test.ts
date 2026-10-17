import { expect, it, vi } from "vitest";
import type { ApiClient } from "../../../data/apiClient";
import { ChunkManager } from "../../../data/chunkManager";
import { ProtobufDecoder } from "../../../data/decoders/protobufDecoder";
import {
  Chunk as PbChunk,
  Manifest as PbManifest,
  EntityType as PbEntityType,
  Side as PbSide,
} from "../../../data/decoders/generated/ocap.pb";
import { PlaybackEngine } from "../../../playback/engine";
import { MockRenderer } from "../../../renderers/mockRenderer";
import { buildOrbat, isLeader } from "../orbat";

const buffer = (bytes: Uint8Array): ArrayBuffer => new Uint8Array(bytes).buffer;

it("preserves manifest roles and leader priority through actual protobuf chunk playback", async () => {
  const manifest = PbManifest.fromPartial({
    version: 1, worldName: "altis", missionName: "ORBAT roles", endFrame: 1,
    chunkSize: 300, chunkCount: 1, captureDelayMs: 1000,
    entities: [
      { id: 1, name: "Aaron", role: "Rifleman" },
      { id: 2, name: "Zulu", role: "Squad Leader" },
    ].map((entity) => ({
      ...entity, type: PbEntityType.ENTITY_TYPE_UNIT, side: PbSide.SIDE_WEST,
      groupName: "Alpha", isPlayer: true, startFrame: 0, endFrame: 1,
    })),
  });
  const chunk = PbChunk.fromPartial({
    startFrame: 0, frameCount: 2,
    frames: [0, 1].map((frameNum) => ({
      frameNum, entities: [1, 2].map((entityId) => ({
        entityId, posX: 100, posY: 200, alive: 1, isPlayer: true,
      })),
    })),
  });
  const api = {
    getManifest: vi.fn(async () => buffer(PbManifest.encode(manifest).finish())),
    getChunk: vi.fn(async () => buffer(PbChunk.encode(chunk).finish())),
  } as unknown as ApiClient;
  const cache = new ChunkManager(new ProtobufDecoder(), api);
  const decodedManifest = await cache.loadManifest("orbat-roles");
  await cache.loadChunk(0);
  const engine = new PlaybackEngine(new MockRenderer());
  try {
    engine.loadRecording(decodedManifest, cache);
    engine.seekTo(1);
    expect(engine.entityManager.getEntity(1)?.positions).toBeNull();
    expect(engine.getStateAt(1, 1)?.role).toBeUndefined();
    const [group] = buildOrbat(engine, "WEST", 1);
    expect(group.members.map((member) => [member.name, member.role, isLeader(member.role)]))
      .toEqual([["Zulu", "Squad Leader", true], ["Aaron", "Rifleman", false]]);
  } finally {
    engine.dispose();
  }
});
