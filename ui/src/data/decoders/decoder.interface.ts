import type { ChunkData, Manifest } from "../types";

export interface DecoderStrategy {
  decodeManifest(buffer: ArrayBuffer): Manifest;
  decodeChunk(buffer: ArrayBuffer): ChunkData;
}
