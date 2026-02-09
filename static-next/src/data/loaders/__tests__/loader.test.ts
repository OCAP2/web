import { describe, expect, it } from "vitest";
import type { DecoderStrategy } from "../../decoders/decoder.interface";
import type { ChunkData, Manifest } from "../../types";
import {
  Loader,
  VERSION_PREFIX_SIZE,
  readVersionPrefix,
  stripVersionPrefix,
} from "../loader";

// ─── Helper ───

function toBuffer(bytes: number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

/** Stub decoder that records what buffer it received. */
function makeCapturingDecoder(): DecoderStrategy & {
  lastManifestBuffer: ArrayBuffer | null;
  lastChunkBuffer: ArrayBuffer | null;
} {
  const stub = {
    lastManifestBuffer: null as ArrayBuffer | null,
    lastChunkBuffer: null as ArrayBuffer | null,
    decodeManifest(buffer: ArrayBuffer): Manifest {
      stub.lastManifestBuffer = buffer;
      return {
        version: 0,
        worldName: "test",
        missionName: "",
        frameCount: 0,
        chunkSize: 0,
        captureDelayMs: 0,
        chunkCount: 0,
        entities: [],
        events: [],
        markers: [],
        times: [],
      };
    },
    decodeChunk(buffer: ArrayBuffer): ChunkData {
      stub.lastChunkBuffer = buffer;
      return { entities: new Map() };
    },
  };
  return stub;
}

// ─── readVersionPrefix tests ───

describe("readVersionPrefix", () => {
  it("detects version prefix for small version numbers", () => {
    // Version 1: [0x01, 0x00, 0x00, 0x00]
    expect(readVersionPrefix(toBuffer([0x01, 0x00, 0x00, 0x00]))).toBe(1);
    expect(readVersionPrefix(toBuffer([0x02, 0x00, 0x00, 0x00]))).toBe(2);
    expect(readVersionPrefix(toBuffer([0x0f, 0x00, 0x00, 0x00]))).toBe(15);
  });

  it("returns null for legacy protobuf data (starts with field tag)", () => {
    // Protobuf field 1, varint wire type: 0x08
    expect(
      readVersionPrefix(toBuffer([0x08, 0x01, 0x00, 0x00])),
    ).toBeNull();
  });

  it("returns null for legacy flatbuffers data (root offset >= 16)", () => {
    // Root table offset = 20 → [0x14, 0x00, 0x00, 0x00]
    // byte0 = 0x14 = 20 which is >= 16 so NOT a version prefix
    expect(
      readVersionPrefix(toBuffer([0x14, 0x00, 0x00, 0x00])),
    ).toBeNull();
  });

  it("returns null for non-zero upper bytes (byte1 != 0)", () => {
    expect(
      readVersionPrefix(toBuffer([0x01, 0x01, 0x00, 0x00])),
    ).toBeNull();
  });

  it("returns null for buffer too short", () => {
    expect(readVersionPrefix(toBuffer([0x01, 0x00]))).toBeNull();
    expect(readVersionPrefix(toBuffer([]))).toBeNull();
  });

  it("returns 0 for version 0 (legacy marker)", () => {
    expect(readVersionPrefix(toBuffer([0x00, 0x00, 0x00, 0x00]))).toBe(0);
  });
});

// ─── stripVersionPrefix tests ───

describe("stripVersionPrefix", () => {
  it("strips the 4-byte prefix for version 1", () => {
    const bytes = [0x01, 0x00, 0x00, 0x00, 0xaa, 0xbb, 0xcc];
    const result = stripVersionPrefix(toBuffer(bytes));
    expect(new Uint8Array(result)).toEqual(
      new Uint8Array([0xaa, 0xbb, 0xcc]),
    );
  });

  it("returns buffer unchanged for legacy protobuf data", () => {
    const bytes = [0x08, 0x01, 0x00, 0x00, 0xaa];
    const buf = toBuffer(bytes);
    const result = stripVersionPrefix(buf);
    expect(result).toBe(buf); // same reference
  });

  it("returns buffer unchanged for version 0", () => {
    const bytes = [0x00, 0x00, 0x00, 0x00, 0xaa];
    const buf = toBuffer(bytes);
    const result = stripVersionPrefix(buf);
    expect(result).toBe(buf);
  });

  it("returns buffer unchanged for short buffer", () => {
    const bytes = [0x01];
    const buf = toBuffer(bytes);
    const result = stripVersionPrefix(buf);
    expect(result).toBe(buf);
  });
});

// ─── Loader tests ───

describe("Loader", () => {
  it("delegates manifest decoding to the decoder", () => {
    const decoder = makeCapturingDecoder();
    const loader = new Loader(decoder);

    // No version prefix (legacy data)
    const buf = toBuffer([0x08, 0x01]); // protobuf-like
    const result = loader.decode(buf, "manifest");

    expect(decoder.lastManifestBuffer).not.toBeNull();
    expect((result as Manifest).worldName).toBe("test");
  });

  it("delegates chunk decoding to the decoder", () => {
    const decoder = makeCapturingDecoder();
    const loader = new Loader(decoder);

    const buf = toBuffer([0x08, 0x01]); // protobuf-like
    const result = loader.decode(buf, "chunk");

    expect(decoder.lastChunkBuffer).not.toBeNull();
    expect((result as ChunkData).entities).toBeInstanceOf(Map);
  });

  it("strips version prefix before passing to decoder", () => {
    const decoder = makeCapturingDecoder();
    const loader = new Loader(decoder);

    // Version 1 prefix + 2 bytes of data
    const buf = toBuffer([0x01, 0x00, 0x00, 0x00, 0xaa, 0xbb]);
    loader.decode(buf, "manifest");

    // The decoder should receive data without the version prefix
    const received = new Uint8Array(decoder.lastManifestBuffer!);
    expect(received).toEqual(new Uint8Array([0xaa, 0xbb]));
  });

  it("passes buffer unchanged when no version prefix detected", () => {
    const decoder = makeCapturingDecoder();
    const loader = new Loader(decoder);

    // Protobuf-like data (byte0 = 0x08 >= 16 is false... wait 0x08 is 8 < 16)
    // Actually 0x08 = 8 < 16, but byte1 is 0x01 != 0, so not a version prefix
    const buf = toBuffer([0x08, 0x01, 0x00, 0x00]);
    loader.decode(buf, "manifest");

    const received = new Uint8Array(decoder.lastManifestBuffer!);
    expect(received).toEqual(new Uint8Array([0x08, 0x01, 0x00, 0x00]));
  });

  it("VERSION_PREFIX_SIZE is 4", () => {
    expect(VERSION_PREFIX_SIZE).toBe(4);
  });
});
