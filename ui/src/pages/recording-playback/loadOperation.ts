import type { Operation, WorldConfig } from "../../data/types";
import type { ApiClient } from "../../data/apiClient";
import { JsonDecoder } from "../../data/decoders/jsonDecoder";
import { ProtobufDecoder } from "../../data/decoders/protobufDecoder";
import type { DecoderStrategy } from "../../data/decoders/decoder.interface";
import { ChunkManager } from "../../data/chunkManager";
import type { PlaybackEngine } from "../../playback/engine";
import type { MarkerManager } from "../../playback/markerManager";

export interface LoadResult {
  worldConfig: WorldConfig;
  missionName: string;
  operationId: string;
  operationFilename: string;
  extensionVersion?: string;
  addonVersion?: string;
}

export async function loadOperation(
  api: ApiClient,
  engine: PlaybackEngine,
  markerManager: MarkerManager,
  op: Operation,
  onWorldResolved?: (world: WorldConfig) => void,
): Promise<LoadResult> {
  const world = await api.getWorldConfig(op.worldName);

  // Notify caller so the renderer can be initialized before
  // engine.loadOperation triggers snapshot effects.
  onWorldResolved?.(world);

  const filename = op.filename ?? String(op.id);
  let decoder: DecoderStrategy;
  let manifest;

  if (op.storageFormat === "protobuf") {
    decoder = new ProtobufDecoder();
    const chunkMgr = new ChunkManager(decoder, api);
    manifest = await chunkMgr.loadManifest(filename);
    await chunkMgr.loadChunk(0);
    engine.loadOperation(manifest, chunkMgr);
  } else {
    decoder = new JsonDecoder();
    const buffer = await api.getMissionData(filename);
    manifest = decoder.decodeManifest(buffer);
    engine.loadOperation(manifest);
  }

  markerManager.loadMarkers(manifest.markers, (id) => {
    const entity = engine.entityManager.getEntity(id);
    return entity?.name ?? null;
  });

  return {
    worldConfig: world,
    missionName: op.missionName,
    operationId: op.id,
    operationFilename: filename,
    extensionVersion: manifest.extensionVersion,
    addonVersion: manifest.addonVersion,
  };
}
