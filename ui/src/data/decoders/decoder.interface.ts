import type { ChunkData, EventDef, Manifest } from "../types";

export interface DecoderStrategy {
  decodeManifest(buffer: ArrayBuffer): Manifest;
  decodeChunk(buffer: ArrayBuffer): ChunkData;
  /**
   * Decode one player's snapshot sidecar. Formats that keep snapshots in the
   * manifest return an empty list — the events are already loaded.
   */
  decodePlayerSnapshots(buffer: ArrayBuffer): EventDef[];
}
