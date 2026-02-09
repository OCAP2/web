import { describe, expect, it, vi, beforeEach } from "vitest";
import type { StorageBackend } from "../storage.interface";

// ─── Helper: in-memory StorageBackend for contract tests ───

class MemoryStorage implements StorageBackend {
  private _data = new Map<string, ArrayBuffer>();
  private _accessTimes = new Map<string, number>();
  private _totalUsed = 0;

  async hasManifest(missionId: string, format: string): Promise<boolean> {
    return this._data.has(this._manifestKey(missionId, format));
  }

  async getManifest(
    missionId: string,
    format: string,
  ): Promise<ArrayBuffer | null> {
    const key = this._manifestKey(missionId, format);
    const buf = this._data.get(key);
    if (buf) {
      this._touch(missionId);
      return buf;
    }
    return null;
  }

  async saveManifest(
    missionId: string,
    format: string,
    data: ArrayBuffer,
  ): Promise<void> {
    const key = this._manifestKey(missionId, format);
    this._addBytes(key, data);
    this._touch(missionId);
  }

  async hasChunk(missionId: string, chunkIndex: number): Promise<boolean> {
    return this._data.has(this._chunkKey(missionId, chunkIndex));
  }

  async getChunk(
    missionId: string,
    chunkIndex: number,
  ): Promise<ArrayBuffer | null> {
    const key = this._chunkKey(missionId, chunkIndex);
    const buf = this._data.get(key);
    if (buf) {
      this._touch(missionId);
      return buf;
    }
    return null;
  }

  async saveChunk(
    missionId: string,
    chunkIndex: number,
    data: ArrayBuffer,
  ): Promise<void> {
    const key = this._chunkKey(missionId, chunkIndex);
    this._addBytes(key, data);
    this._touch(missionId);
  }

  async evictOldChunks(maxBytes: number): Promise<void> {
    if (this._totalUsed <= maxBytes) return;

    // Sort missions oldest-first
    const sorted = [...this._accessTimes.entries()].sort(
      (a, b) => a[1] - b[1],
    );

    for (const [missionId] of sorted) {
      this._removeMission(missionId);
      if (this._totalUsed <= maxBytes) break;
    }
  }

  async getStorageUsage(): Promise<{ used: number; available: number }> {
    return { used: this._totalUsed, available: 1024 * 1024 - this._totalUsed };
  }

  // --- internals ---

  private _manifestKey(missionId: string, format: string): string {
    return `${missionId}/manifest-${format}`;
  }

  private _chunkKey(missionId: string, chunkIndex: number): string {
    return `${missionId}/chunk-${chunkIndex}`;
  }

  private _touch(missionId: string): void {
    this._accessTimes.set(missionId, Date.now());
  }

  private _addBytes(key: string, data: ArrayBuffer): void {
    const prev = this._data.get(key);
    if (prev) {
      this._totalUsed -= prev.byteLength;
    }
    this._data.set(key, data);
    this._totalUsed += data.byteLength;
  }

  private _removeMission(missionId: string): void {
    const prefix = `${missionId}/`;
    for (const key of [...this._data.keys()]) {
      if (key.startsWith(prefix)) {
        this._totalUsed -= this._data.get(key)!.byteLength;
        this._data.delete(key);
      }
    }
    this._accessTimes.delete(missionId);
  }
}

// ─── StorageBackend interface contract tests ───

describe("StorageBackend interface contract", () => {
  it("MemoryStorage implements all required methods", () => {
    const storage: StorageBackend = new MemoryStorage();
    expect(typeof storage.hasManifest).toBe("function");
    expect(typeof storage.getManifest).toBe("function");
    expect(typeof storage.saveManifest).toBe("function");
    expect(typeof storage.hasChunk).toBe("function");
    expect(typeof storage.getChunk).toBe("function");
    expect(typeof storage.saveChunk).toBe("function");
    expect(typeof storage.evictOldChunks).toBe("function");
    expect(typeof storage.getStorageUsage).toBe("function");
  });
});

// ─── Manifest operations ───

describe("StorageBackend manifest operations", () => {
  let storage: StorageBackend;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it("returns false for a manifest that does not exist", async () => {
    expect(await storage.hasManifest("m1", "protobuf")).toBe(false);
  });

  it("returns null when getting a non-existent manifest", async () => {
    expect(await storage.getManifest("m1", "protobuf")).toBeNull();
  });

  it("saves and retrieves a manifest", async () => {
    const data = new Uint8Array([1, 2, 3, 4]).buffer;
    await storage.saveManifest("m1", "protobuf", data);

    expect(await storage.hasManifest("m1", "protobuf")).toBe(true);
    const result = await storage.getManifest("m1", "protobuf");
    expect(result).not.toBeNull();
    expect(new Uint8Array(result!)).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("differentiates manifests by format", async () => {
    const pbData = new Uint8Array([10, 20]).buffer;
    const fbData = new Uint8Array([30, 40]).buffer;

    await storage.saveManifest("m1", "protobuf", pbData);
    await storage.saveManifest("m1", "flatbuffers", fbData);

    expect(await storage.hasManifest("m1", "protobuf")).toBe(true);
    expect(await storage.hasManifest("m1", "flatbuffers")).toBe(true);

    const pb = await storage.getManifest("m1", "protobuf");
    const fb = await storage.getManifest("m1", "flatbuffers");
    expect(new Uint8Array(pb!)).toEqual(new Uint8Array([10, 20]));
    expect(new Uint8Array(fb!)).toEqual(new Uint8Array([30, 40]));
  });

  it("differentiates manifests by mission ID", async () => {
    const d1 = new Uint8Array([1]).buffer;
    const d2 = new Uint8Array([2]).buffer;

    await storage.saveManifest("m1", "protobuf", d1);
    await storage.saveManifest("m2", "protobuf", d2);

    expect(await storage.hasManifest("m1", "protobuf")).toBe(true);
    expect(await storage.hasManifest("m2", "protobuf")).toBe(true);
    expect(await storage.hasManifest("m3", "protobuf")).toBe(false);
  });

  it("overwrites an existing manifest", async () => {
    await storage.saveManifest("m1", "protobuf", new Uint8Array([1]).buffer);
    await storage.saveManifest("m1", "protobuf", new Uint8Array([2]).buffer);

    const result = await storage.getManifest("m1", "protobuf");
    expect(new Uint8Array(result!)).toEqual(new Uint8Array([2]));
  });
});

// ─── Chunk operations ───

describe("StorageBackend chunk operations", () => {
  let storage: StorageBackend;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it("returns false for a chunk that does not exist", async () => {
    expect(await storage.hasChunk("m1", 0)).toBe(false);
  });

  it("returns null when getting a non-existent chunk", async () => {
    expect(await storage.getChunk("m1", 0)).toBeNull();
  });

  it("saves and retrieves a chunk", async () => {
    const data = new Uint8Array([10, 20, 30]).buffer;
    await storage.saveChunk("m1", 0, data);

    expect(await storage.hasChunk("m1", 0)).toBe(true);
    const result = await storage.getChunk("m1", 0);
    expect(new Uint8Array(result!)).toEqual(new Uint8Array([10, 20, 30]));
  });

  it("differentiates chunks by index", async () => {
    await storage.saveChunk("m1", 0, new Uint8Array([1]).buffer);
    await storage.saveChunk("m1", 1, new Uint8Array([2]).buffer);
    await storage.saveChunk("m1", 2, new Uint8Array([3]).buffer);

    expect(await storage.hasChunk("m1", 0)).toBe(true);
    expect(await storage.hasChunk("m1", 1)).toBe(true);
    expect(await storage.hasChunk("m1", 2)).toBe(true);
    expect(await storage.hasChunk("m1", 3)).toBe(false);

    expect(new Uint8Array((await storage.getChunk("m1", 1))!)).toEqual(
      new Uint8Array([2]),
    );
  });

  it("differentiates chunks by mission ID", async () => {
    await storage.saveChunk("m1", 0, new Uint8Array([1]).buffer);
    await storage.saveChunk("m2", 0, new Uint8Array([2]).buffer);

    expect(new Uint8Array((await storage.getChunk("m1", 0))!)).toEqual(
      new Uint8Array([1]),
    );
    expect(new Uint8Array((await storage.getChunk("m2", 0))!)).toEqual(
      new Uint8Array([2]),
    );
  });

  it("overwrites an existing chunk", async () => {
    await storage.saveChunk("m1", 0, new Uint8Array([1]).buffer);
    await storage.saveChunk("m1", 0, new Uint8Array([2]).buffer);

    const result = await storage.getChunk("m1", 0);
    expect(new Uint8Array(result!)).toEqual(new Uint8Array([2]));
  });
});

// ─── Eviction logic ───

describe("StorageBackend eviction", () => {
  it("does nothing when under the limit", async () => {
    const storage = new MemoryStorage();
    await storage.saveChunk("m1", 0, new Uint8Array(100).buffer);

    await storage.evictOldChunks(1000);

    expect(await storage.hasChunk("m1", 0)).toBe(true);
  });

  it("evicts oldest mission first to get under limit", async () => {
    const storage = new MemoryStorage();

    // Save m1 first (oldest)
    await storage.saveChunk("m1", 0, new Uint8Array(500).buffer);
    await storage.saveManifest("m1", "protobuf", new Uint8Array(100).buffer);

    // Small delay so m2 gets a newer timestamp
    await new Promise((r) => setTimeout(r, 5));

    // Save m2 second (newer)
    await storage.saveChunk("m2", 0, new Uint8Array(500).buffer);

    // Total = 1100, limit = 600 -> should evict m1
    await storage.evictOldChunks(600);

    expect(await storage.hasChunk("m1", 0)).toBe(false);
    expect(await storage.hasManifest("m1", "protobuf")).toBe(false);
    expect(await storage.hasChunk("m2", 0)).toBe(true);
  });

  it("evicts multiple missions if needed", async () => {
    const storage = new MemoryStorage();

    await storage.saveChunk("m1", 0, new Uint8Array(400).buffer);
    await new Promise((r) => setTimeout(r, 5));
    await storage.saveChunk("m2", 0, new Uint8Array(400).buffer);
    await new Promise((r) => setTimeout(r, 5));
    await storage.saveChunk("m3", 0, new Uint8Array(400).buffer);

    // Total = 1200, limit = 500 -> evict m1 and m2
    await storage.evictOldChunks(500);

    expect(await storage.hasChunk("m1", 0)).toBe(false);
    expect(await storage.hasChunk("m2", 0)).toBe(false);
    expect(await storage.hasChunk("m3", 0)).toBe(true);
  });

  it("removes all data for an evicted mission (manifest + chunks)", async () => {
    const storage = new MemoryStorage();

    await storage.saveManifest("m1", "protobuf", new Uint8Array(100).buffer);
    await storage.saveChunk("m1", 0, new Uint8Array(200).buffer);
    await storage.saveChunk("m1", 1, new Uint8Array(200).buffer);
    await new Promise((r) => setTimeout(r, 5));
    await storage.saveChunk("m2", 0, new Uint8Array(100).buffer);

    // Total = 600, limit = 200 -> evict m1
    await storage.evictOldChunks(200);

    expect(await storage.hasManifest("m1", "protobuf")).toBe(false);
    expect(await storage.hasChunk("m1", 0)).toBe(false);
    expect(await storage.hasChunk("m1", 1)).toBe(false);
    expect(await storage.hasChunk("m2", 0)).toBe(true);
  });
});

// ─── Storage usage ───

describe("StorageBackend getStorageUsage", () => {
  it("reports usage reflecting stored data", async () => {
    const storage = new MemoryStorage();
    const initial = await storage.getStorageUsage();
    expect(initial.used).toBe(0);

    await storage.saveChunk("m1", 0, new Uint8Array(256).buffer);
    const after = await storage.getStorageUsage();
    expect(after.used).toBe(256);
  });

  it("reports available space", async () => {
    const storage = new MemoryStorage();
    const usage = await storage.getStorageUsage();
    expect(usage.available).toBeGreaterThan(0);
    expect(usage.used + usage.available).toBeGreaterThan(0);
  });
});

// ─── storage-factory feature detection ───

describe("createStorage feature detection", () => {
  it("falls back when OPFS is not available", async () => {
    // In jsdom/Node, OPFS is not available, so we test the detection logic
    // by importing and checking that OPFSStorage.isSupported() returns false
    const { OPFSStorage } = await import("../opfs-storage");
    expect(await OPFSStorage.isSupported()).toBe(false);
  });

  it("IndexedDBStorage.isSupported returns boolean", async () => {
    const { IndexedDBStorage } = await import("../indexeddb-storage");
    // In jsdom, indexedDB may or may not be defined; either way it returns a boolean
    const result = IndexedDBStorage.isSupported();
    expect(typeof result).toBe("boolean");
  });

  it("createStorage throws when no backend is available", async () => {
    // Mock both backends as unsupported
    vi.doMock("../opfs-storage", () => ({
      OPFSStorage: {
        isSupported: () => Promise.resolve(false),
      },
    }));
    vi.doMock("../indexeddb-storage", () => ({
      IndexedDBStorage: {
        isSupported: () => false,
      },
    }));

    // Clear module cache so factory picks up mocks
    const { createStorage } = await import("../storage-factory");
    await expect(createStorage()).rejects.toThrow(
      "No supported storage backend",
    );

    vi.doUnmock("../opfs-storage");
    vi.doUnmock("../indexeddb-storage");
  });
});

// ─── OPFSStorage.isSupported in jsdom ───

describe("OPFSStorage", () => {
  it("isSupported returns false in jsdom (no navigator.storage.getDirectory)", async () => {
    const { OPFSStorage } = await import("../opfs-storage");
    const result = await OPFSStorage.isSupported();
    expect(result).toBe(false);
  });
});
