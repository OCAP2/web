import type { Recording, WorldConfig } from "../../data/types";
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
  recordingId: string;
  recordingFilename: string;
  extensionVersion?: string;
  addonVersion?: string;
}

export async function loadRecording(
  api: ApiClient,
  engine: PlaybackEngine,
  markerManager: MarkerManager,
  rec: Recording,
  onWorldResolved?: (world: WorldConfig) => void,
): Promise<LoadResult> {
  const world = await api.getWorldConfig(rec.worldName);

  // Notify caller so the renderer can be initialized before
  // engine.loadRecording triggers snapshot effects.
  onWorldResolved?.(world);

  const filename = rec.filename ?? String(rec.id);
  let decoder: DecoderStrategy;
  let manifest;

  if (rec.storageFormat === "protobuf") {
    decoder = new ProtobufDecoder();
    const chunkMgr = new ChunkManager(decoder, api);
    manifest = await chunkMgr.loadManifest(filename);
    await chunkMgr.loadChunk(0);
    engine.loadRecording(manifest, chunkMgr);
  } else {
    decoder = new JsonDecoder();
    const buffer = await api.getRecordingData(filename);
    manifest = decoder.decodeManifest(buffer);
    engine.loadRecording(manifest);
  }

  markerManager.loadMarkers(manifest.markers, (id) => {
    const entity = engine.entityManager.getEntity(id);
    return entity?.name ?? null;
  });

  return {
    worldConfig: world,
    missionName: rec.missionName,
    recordingId: rec.id,
    recordingFilename: filename,
    extensionVersion: manifest.extensionVersion,
    addonVersion: manifest.addonVersion,
  };
}
