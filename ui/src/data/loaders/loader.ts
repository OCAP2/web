import type { ChunkData, Manifest } from "../types";
import type { DecoderStrategy } from "../decoders/decoder.interface";

/**
 * Loader that delegates to a DecoderStrategy.
 */
export class Loader {
  constructor(private readonly decoder: DecoderStrategy) {}

  decode(buffer: ArrayBuffer, type: "manifest" | "chunk"): Manifest | ChunkData {
    if (type === "manifest") {
      return this.decoder.decodeManifest(buffer);
    }
    return this.decoder.decodeChunk(buffer);
  }
}
