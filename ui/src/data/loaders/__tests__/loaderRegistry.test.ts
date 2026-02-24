import { describe, expect, it } from "vitest";
import type { DecoderStrategy } from "../../decoders/decoder.interface";
import type { ChunkData, Manifest } from "../../types";
import { LoaderRegistry } from "../loaderRegistry";

/** Minimal stub decoder for testing the registry. */
function makeStubDecoder(label: string): DecoderStrategy {
  return {
    decodeManifest(_buffer: ArrayBuffer): Manifest {
      return {
        version: 0,
        worldName: label,
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
    decodeChunk(_buffer: ArrayBuffer): ChunkData {
      return { entities: new Map() };
    },
  };
}

describe("LoaderRegistry", () => {
  it("registers and retrieves a decoder by version", () => {
    const registry = new LoaderRegistry();
    const decoder = makeStubDecoder("v1");
    registry.register(1, decoder);

    expect(registry.getLoader(1)).toBe(decoder);
  });

  it("throws for unknown version with no fallback", () => {
    const registry = new LoaderRegistry();
    expect(() => registry.getLoader(5)).toThrow(
      "No loader registered for schema version 5",
    );
  });

  it("falls back to closest lower version", () => {
    const registry = new LoaderRegistry();
    const v1 = makeStubDecoder("v1");
    const v3 = makeStubDecoder("v3");
    registry.register(1, v1);
    registry.register(3, v3);

    // Version 2 should fall back to version 1
    expect(registry.getLoader(2)).toBe(v1);

    // Version 4 should fall back to version 3
    expect(registry.getLoader(4)).toBe(v3);

    // Version 100 should fall back to version 3
    expect(registry.getLoader(100)).toBe(v3);
  });

  it("hasLoader returns true for registered versions", () => {
    const registry = new LoaderRegistry();
    registry.register(1, makeStubDecoder("v1"));

    expect(registry.hasLoader(1)).toBe(true);
    expect(registry.hasLoader(2)).toBe(false);
  });

  it("getVersions returns sorted array", () => {
    const registry = new LoaderRegistry();
    registry.register(3, makeStubDecoder("v3"));
    registry.register(1, makeStubDecoder("v1"));
    registry.register(5, makeStubDecoder("v5"));

    expect(registry.getVersions()).toEqual([1, 3, 5]);
  });

  it("getLatestVersion returns highest version", () => {
    const registry = new LoaderRegistry();
    registry.register(1, makeStubDecoder("v1"));
    registry.register(3, makeStubDecoder("v3"));

    expect(registry.getLatestVersion()).toBe(3);
  });

  it("getLatestVersion returns 0 for empty registry", () => {
    const registry = new LoaderRegistry();
    expect(registry.getLatestVersion()).toBe(0);
  });

  it("getVersions returns empty array for empty registry", () => {
    const registry = new LoaderRegistry();
    expect(registry.getVersions()).toEqual([]);
  });

  it("overwrites decoder when re-registering same version", () => {
    const registry = new LoaderRegistry();
    const v1a = makeStubDecoder("v1a");
    const v1b = makeStubDecoder("v1b");
    registry.register(1, v1a);
    registry.register(1, v1b);

    expect(registry.getLoader(1)).toBe(v1b);
  });
});
