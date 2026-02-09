import type { ChunkData, Manifest } from "../types";
import type { DecoderStrategy } from "../decoders/decoder.interface";

/**
 * Version prefix size in bytes (4-byte little-endian uint32).
 */
export const VERSION_PREFIX_SIZE = 4;

/**
 * Read the version prefix from binary data.
 *
 * The version prefix is a 4-byte little-endian uint32 at the start of the data.
 * Returns null if the buffer does not appear to contain a version prefix.
 *
 * Heuristic: for small version numbers (1-255) the first byte is the version
 * and bytes 2-4 are all zero. Legacy protobuf files start with 0x08 or 0x0A
 * (field tags) which would have non-zero upper bytes or be >= 16. Legacy
 * flatbuffers files start with a root table offset typically >= 16.
 */
export function readVersionPrefix(buffer: ArrayBuffer): number | null {
  if (buffer.byteLength < VERSION_PREFIX_SIZE) {
    return null;
  }

  const view = new DataView(buffer);
  const byte0 = view.getUint8(0);
  const byte1 = view.getUint8(1);
  const byte2 = view.getUint8(2);
  const byte3 = view.getUint8(3);

  const hasVersionPrefix =
    byte0 < 16 && byte1 === 0 && byte2 === 0 && byte3 === 0;

  if (!hasVersionPrefix) {
    return null; // Legacy file without version prefix
  }

  return view.getUint32(0, true);
}

/**
 * Strip the version prefix from binary data if present.
 *
 * Returns the buffer unchanged if no version prefix is detected or if
 * the version is 0 (legacy).
 */
export function stripVersionPrefix(buffer: ArrayBuffer): ArrayBuffer {
  const version = readVersionPrefix(buffer);
  if (version === null || version === 0) {
    return buffer;
  }
  return buffer.slice(VERSION_PREFIX_SIZE);
}

/**
 * Versioned loader that strips the version prefix byte from an ArrayBuffer
 * and delegates to the appropriate DecoderStrategy.
 */
export class Loader {
  constructor(private readonly decoder: DecoderStrategy) {}

  /**
   * Decode binary data, stripping the version prefix if present.
   *
   * @param buffer - Raw binary data (may include a 4-byte version prefix)
   * @param type - Whether to decode as a manifest or a chunk
   * @returns Decoded manifest or chunk data
   */
  decode(buffer: ArrayBuffer, type: "manifest" | "chunk"): Manifest | ChunkData {
    const data = stripVersionPrefix(buffer);

    if (type === "manifest") {
      return this.decoder.decodeManifest(data);
    }
    return this.decoder.decodeChunk(data);
  }
}
