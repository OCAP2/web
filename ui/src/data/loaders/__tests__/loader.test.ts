import { describe, expect, it } from "vitest";
import type { DecoderStrategy } from "../../decoders/decoder.interface";
import type { ChunkData, Manifest } from "../../types";
import { Loader } from "../loader";

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
        endFrame: 0,
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

// ─── Loader tests ───

describe("Loader", () => {
  it("delegates manifest decoding to the decoder", () => {
    const decoder = makeCapturingDecoder();
    const loader = new Loader(decoder);

    const buf = toBuffer([0x08, 0x01]);
    const result = loader.decode(buf, "manifest");

    expect(decoder.lastManifestBuffer).not.toBeNull();
    expect((result as Manifest).worldName).toBe("test");
  });

  it("delegates chunk decoding to the decoder", () => {
    const decoder = makeCapturingDecoder();
    const loader = new Loader(decoder);

    const buf = toBuffer([0x08, 0x01]);
    const result = loader.decode(buf, "chunk");

    expect(decoder.lastChunkBuffer).not.toBeNull();
    expect((result as ChunkData).entities).toBeInstanceOf(Map);
  });

  it("passes buffer directly to decoder", () => {
    const decoder = makeCapturingDecoder();
    const loader = new Loader(decoder);

    const buf = toBuffer([0x08, 0x01, 0x00, 0x00]);
    loader.decode(buf, "manifest");

    const received = new Uint8Array(decoder.lastManifestBuffer!);
    expect(received).toEqual(new Uint8Array([0x08, 0x01, 0x00, 0x00]));
  });
});
