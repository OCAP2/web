import { describe, expect, it } from "vitest";
import { FlatBufferReader, FlatBuffersDecoder } from "../flatbuffers-decoder";

// ─── Helpers to build FlatBuffers binary by hand ───

/**
 * Build a minimal FlatBuffers manifest with a vtable and root table.
 *
 * Layout: [root_offset(4)] [vtable] [table] [strings...]
 *
 * String fields use forward-pointing unsigned offsets, so strings must be
 * placed AFTER the table.
 *
 * Field layout for manifest:
 * 0: version (uint32), 1: world_name (string), 2: mission_name (string),
 * 3: frame_count (uint32), 4: chunk_size (uint32), 5: capture_delay_ms (uint32),
 * 6: chunk_count (uint32)
 */
function buildMinimalManifest(opts: {
  version?: number;
  worldName?: string;
  missionName?: string;
  frameCount?: number;
  chunkSize?: number;
  captureDelayMs?: number;
  chunkCount?: number;
}): ArrayBuffer {
  const buf: number[] = [];

  function push32LE(value: number) {
    buf.push(
      value & 0xff,
      (value >> 8) & 0xff,
      (value >> 16) & 0xff,
      (value >> 24) & 0xff,
    );
  }

  function push16LE(value: number) {
    buf.push(value & 0xff, (value >> 8) & 0xff);
  }

  function patch32LE(pos: number, value: number) {
    buf[pos] = value & 0xff;
    buf[pos + 1] = (value >> 8) & 0xff;
    buf[pos + 2] = (value >> 16) & 0xff;
    buf[pos + 3] = (value >> 24) & 0xff;
  }

  function pushString(str: string): number {
    const encoded = new TextEncoder().encode(str);
    const pos = buf.length;
    push32LE(encoded.length);
    for (const b of encoded) buf.push(b);
    buf.push(0); // null terminator
    while (buf.length % 4 !== 0) buf.push(0);
    return pos;
  }

  const numFields = 7;
  const vtableSize = 4 + numFields * 2; // 2 byte header fields + 2 bytes per field
  const tableSize = 4 + numFields * 4; // soffset + 4 bytes per field

  const fieldPresent = [
    opts.version !== undefined,
    opts.worldName !== undefined,
    opts.missionName !== undefined,
    opts.frameCount !== undefined,
    opts.chunkSize !== undefined,
    opts.captureDelayMs !== undefined,
    opts.chunkCount !== undefined,
  ];

  // [0..3]: root offset placeholder
  push32LE(0);

  // Align vtable to 4 bytes (already at offset 4, which is aligned)
  const vtablePos = buf.length;

  // Write vtable
  push16LE(vtableSize);
  push16LE(tableSize);
  for (let i = 0; i < numFields; i++) {
    if (fieldPresent[i]) {
      push16LE(4 + i * 4);
    } else {
      push16LE(0);
    }
  }
  // Pad vtable to 4-byte alignment
  while (buf.length % 4 !== 0) buf.push(0);

  // Write table
  const tablePos = buf.length;
  push32LE(tablePos - vtablePos); // soffset to vtable

  // field 0: version
  push32LE(opts.version ?? 0);

  // field 1: world_name — placeholder, will patch after writing string
  const worldNameFieldPos = buf.length;
  push32LE(0);

  // field 2: mission_name — placeholder
  const missionNameFieldPos = buf.length;
  push32LE(0);

  // field 3: frame_count
  push32LE(opts.frameCount ?? 0);

  // field 4: chunk_size
  push32LE(opts.chunkSize ?? 0);

  // field 5: capture_delay_ms
  push32LE(opts.captureDelayMs ?? 0);

  // field 6: chunk_count
  push32LE(opts.chunkCount ?? 0);

  // Write strings after the table and patch the offsets
  if (opts.worldName !== undefined) {
    const strPos = pushString(opts.worldName);
    patch32LE(worldNameFieldPos, strPos - worldNameFieldPos);
  }
  if (opts.missionName !== undefined) {
    const strPos = pushString(opts.missionName);
    patch32LE(missionNameFieldPos, strPos - missionNameFieldPos);
  }

  // Patch root offset
  patch32LE(0, tablePos);

  return new Uint8Array(buf).buffer;
}

// ─── FlatBufferReader tests ───

describe("FlatBufferReader", () => {
  it("reads root offset from buffer", () => {
    const buf = new ArrayBuffer(8);
    const view = new DataView(buf);
    view.setUint32(0, 42, true);
    const reader = new FlatBufferReader(buf);
    expect(reader.getRootOffset()).toBe(42);
  });

  it("reads uint8, uint16, uint32, float32, and bool", () => {
    const buf = new ArrayBuffer(16);
    const view = new DataView(buf);
    view.setUint8(0, 255);
    view.setUint16(2, 1234, true);
    view.setUint32(4, 0xdeadbeef, true);
    view.setFloat32(8, 3.14, true);
    view.setUint8(12, 1); // bool true
    view.setUint8(13, 0); // bool false

    const reader = new FlatBufferReader(buf);
    expect(reader.readUint8(0)).toBe(255);
    expect(reader.readUint16(2)).toBe(1234);
    expect(reader.readUint32(4)).toBe(0xdeadbeef);
    expect(reader.readFloat32(8)).toBeCloseTo(3.14, 5);
    expect(reader.readBool(12)).toBe(true);
    expect(reader.readBool(13)).toBe(false);
  });

  it("reads a string via indirect offset", () => {
    // Layout: at offset 0 we store a uint32 pointing forward to the string
    // String at offset 4: [length(uint32)] [bytes] [null]
    const text = "hello";
    const encoded = new TextEncoder().encode(text);
    const buf = new ArrayBuffer(4 + 4 + encoded.length + 1);
    const view = new DataView(buf);

    // Offset at position 0 points to position 4 (relative: 4 - 0 = 4)
    view.setUint32(0, 4, true);
    // String length
    view.setUint32(4, encoded.length, true);
    // String bytes
    const bytes = new Uint8Array(buf);
    bytes.set(encoded, 8);

    const reader = new FlatBufferReader(buf);
    expect(reader.readString(0)).toBe("hello");
  });

  it("reads vector length", () => {
    // Offset at position 0 → points to position 4
    // Vector at position 4: [length(uint32)] [elements...]
    const buf = new ArrayBuffer(12);
    const view = new DataView(buf);
    view.setUint32(0, 4, true); // indirect offset (4-0=4)
    view.setUint32(4, 3, true); // vector length = 3
    // elements would follow

    const reader = new FlatBufferReader(buf);
    expect(reader.readVectorLength(0)).toBe(3);
  });

  it("reads uint32 vector", () => {
    // Offset at position 0 → vector at position 4
    // Vector: [length=2] [val1] [val2]
    const buf = new ArrayBuffer(4 + 4 + 8);
    const view = new DataView(buf);
    view.setUint32(0, 4, true); // indirect offset
    view.setUint32(4, 2, true); // length
    view.setUint32(8, 100, true);
    view.setUint32(12, 200, true);

    const reader = new FlatBufferReader(buf);
    expect(reader.readUint32Vector(0)).toEqual([100, 200]);
  });
});

// ─── FlatBuffersDecoder manifest tests ───

describe("FlatBuffersDecoder.decodeManifest", () => {
  const decoder = new FlatBuffersDecoder();

  it("decodes a minimal manifest with scalar fields", () => {
    const buffer = buildMinimalManifest({
      version: 1,
      worldName: "Altis",
      missionName: "Test Op",
      frameCount: 500,
      chunkSize: 300,
      captureDelayMs: 1000,
      chunkCount: 2,
    });

    const manifest = decoder.decodeManifest(buffer);

    expect(manifest.version).toBe(1);
    expect(manifest.worldName).toBe("Altis");
    expect(manifest.missionName).toBe("Test Op");
    expect(manifest.frameCount).toBe(500);
    expect(manifest.chunkSize).toBe(300);
    expect(manifest.captureDelayMs).toBe(1000);
    expect(manifest.chunkCount).toBe(2);
    expect(manifest.entities).toEqual([]);
    expect(manifest.events).toEqual([]);
    expect(manifest.markers).toEqual([]);
    expect(manifest.times).toEqual([]);
  });

  it("handles missing optional fields", () => {
    const buffer = buildMinimalManifest({
      version: 1,
    });

    const manifest = decoder.decodeManifest(buffer);

    expect(manifest.version).toBe(1);
    expect(manifest.worldName).toBe("");
    expect(manifest.missionName).toBe("");
    expect(manifest.frameCount).toBe(0);
  });
});

// ─── FlatBuffersDecoder - DecoderStrategy interface ───

describe("FlatBuffersDecoder - DecoderStrategy interface", () => {
  it("has both required methods", () => {
    const decoder = new FlatBuffersDecoder();
    expect(typeof decoder.decodeManifest).toBe("function");
    expect(typeof decoder.decodeChunk).toBe("function");
  });
});
