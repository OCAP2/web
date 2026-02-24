import { describe, expect, it, vi, beforeEach } from "vitest";
import { ChunkManager } from "../chunkManager";
import type { DecoderStrategy } from "../decoders/decoder.interface";
import type { ApiClient } from "../apiClient";
import type { ChunkData, Manifest } from "../types";

// ─── Helpers ───

function makeManifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    version: 1,
    worldName: "altis",
    missionName: "test",
    frameCount: 1200,
    chunkSize: 300,
    captureDelayMs: 1000,
    chunkCount: 4,
    entities: [],
    events: [],
    markers: [],
    times: [],
    ...overrides,
  };
}

function makeChunkData(label = "default"): ChunkData {
  const map = new Map<number, any[]>();
  // Store a marker so we can distinguish chunks in tests
  map.set(-1, [{ _label: label }]);
  return { entities: map };
}

function makeDecoder(manifest?: Manifest): DecoderStrategy {
  return {
    decodeManifest: vi.fn().mockReturnValue(manifest ?? makeManifest()),
    decodeChunk: vi.fn().mockImplementation(() => makeChunkData()),
  };
}

function makeApi(): ApiClient & {
  getManifest: ReturnType<typeof vi.fn>;
  getChunk: ReturnType<typeof vi.fn>;
} {
  return {
    getManifest: vi
      .fn()
      .mockResolvedValue(new Uint8Array([1, 2, 3]).buffer),
    getChunk: vi.fn().mockImplementation(
      async (_id: string, _idx: number) => new Uint8Array([10, 20]).buffer,
    ),
    // Other methods not used by ChunkManager
    getOperations: vi.fn(),
    getMissionData: vi.fn(),
    getCustomize: vi.fn(),
    getVersion: vi.fn(),
    getWorldConfig: vi.fn(),
  } as any;
}

// ─── Tests ───

describe("ChunkManager", () => {
  let decoder: ReturnType<typeof makeDecoder>;
  let api: ReturnType<typeof makeApi>;
  let cm: ChunkManager;

  beforeEach(() => {
    decoder = makeDecoder();
    api = makeApi();
    cm = new ChunkManager(decoder, api);
  });

  // ─── loadManifest ───

  describe("loadManifest", () => {
    it("fetches manifest from network and decodes it", async () => {
      const manifest = await cm.loadManifest("op_mission");

      expect(api.getManifest).toHaveBeenCalledWith("op_mission");
      expect(decoder.decodeManifest).toHaveBeenCalled();
      expect(manifest.worldName).toBe("altis");
      expect(cm.getManifest()).toBe(manifest);
    });
  });

  // ─── loadChunk ───

  describe("loadChunk", () => {
    beforeEach(async () => {
      await cm.loadManifest("op_mission");
    });

    it("fetches chunk from network and decodes it", async () => {
      const chunk = await cm.loadChunk(0);

      expect(api.getChunk).toHaveBeenCalledWith("op_mission", 0);
      expect(decoder.decodeChunk).toHaveBeenCalled();
      expect(chunk.entities).toBeInstanceOf(Map);
    });

    it("returns cached chunk on re-request (memory cache hit)", async () => {
      const chunk1 = await cm.loadChunk(0);
      const chunk2 = await cm.loadChunk(0);

      expect(chunk1).toBe(chunk2);
      // Only one network call
      expect(api.getChunk).toHaveBeenCalledTimes(1);
    });

    it("deduplicates concurrent requests for the same chunk", async () => {
      const [c1, c2] = await Promise.all([
        cm.loadChunk(0),
        cm.loadChunk(0),
      ]);

      expect(c1).toBe(c2);
      expect(api.getChunk).toHaveBeenCalledTimes(1);
    });
  });

  // ─── LRU eviction ───

  describe("LRU eviction", () => {
    beforeEach(async () => {
      // 5 chunks so we can test eviction of the max (3) capacity
      decoder = makeDecoder(makeManifest({ chunkCount: 5 }));
      cm = new ChunkManager(decoder, api);
      await cm.loadManifest("op_mission");
    });

    it("evicts oldest chunk when exceeding max capacity", async () => {
      // Make each chunk distinguishable
      let callCount = 0;
      (decoder.decodeChunk as ReturnType<typeof vi.fn>).mockImplementation(
        () => makeChunkData(`chunk-${callCount++}`),
      );

      await cm.loadChunk(0); // [0]
      await cm.loadChunk(1); // [0, 1]
      await cm.loadChunk(2); // [0, 1, 2]

      // All three in memory
      expect(cm.getChunkForFrame(0)).not.toBeNull();
      expect(cm.getChunkForFrame(300)).not.toBeNull();
      expect(cm.getChunkForFrame(600)).not.toBeNull();

      // Load a 4th chunk -> oldest (0) gets evicted
      await cm.loadChunk(3);

      expect(cm.getChunkForFrame(0)).toBeNull(); // evicted
      expect(cm.getChunkForFrame(300)).not.toBeNull();
      expect(cm.getChunkForFrame(600)).not.toBeNull();
      expect(cm.getChunkForFrame(900)).not.toBeNull();
    });

    it("updates LRU order on access", async () => {
      await cm.loadChunk(0);
      await cm.loadChunk(1);
      await cm.loadChunk(2);

      // Access chunk 0 again to make it most-recent
      await cm.loadChunk(0);

      // Load chunk 3 -> should evict chunk 1 (oldest since 0 was refreshed)
      await cm.loadChunk(3);

      expect(cm.getChunkForFrame(0)).not.toBeNull(); // still there
      expect(cm.getChunkForFrame(300)).toBeNull(); // evicted
      expect(cm.getChunkForFrame(600)).not.toBeNull();
      expect(cm.getChunkForFrame(900)).not.toBeNull();
    });

    it("calls onChunkEvicted callback on eviction", async () => {
      const evicted: number[] = [];
      cm.setCallbacks({ onChunkEvicted: (idx) => evicted.push(idx) });

      await cm.loadChunk(0);
      await cm.loadChunk(1);
      await cm.loadChunk(2);
      await cm.loadChunk(3); // evicts 0

      expect(evicted).toContain(0);
    });

    it("calls onChunkLoaded callback when chunk is stored", async () => {
      const loaded: number[] = [];
      cm.setCallbacks({ onChunkLoaded: (idx) => loaded.push(idx) });

      await cm.loadChunk(0);
      await cm.loadChunk(1);

      expect(loaded).toEqual([0, 1]);
    });
  });

  // ─── ensureLoaded ───

  describe("ensureLoaded", () => {
    beforeEach(async () => {
      decoder = makeDecoder(
        makeManifest({ chunkSize: 100, frameCount: 500, chunkCount: 5 }),
      );
      cm = new ChunkManager(decoder, api);
      await cm.loadManifest("op_mission");
    });

    it("loads the chunk containing the requested frame", async () => {
      await cm.ensureLoaded(150); // chunk index 1

      expect(api.getChunk).toHaveBeenCalledWith("op_mission", 1);
      expect(cm.getChunkForFrame(150)).not.toBeNull();
    });

    it("throws if manifest not loaded", async () => {
      const cm2 = new ChunkManager(decoder, api);
      await expect(cm2.ensureLoaded(0)).rejects.toThrow(
        /manifest not loaded/,
      );
    });
  });

  // ─── Prefetch ───

  describe("prefetch at 80%", () => {
    beforeEach(async () => {
      decoder = makeDecoder(
        makeManifest({ chunkSize: 100, frameCount: 500, chunkCount: 5 }),
      );
      cm = new ChunkManager(decoder, api);
      await cm.loadManifest("op_mission");
    });

    it("does NOT prefetch before 80% threshold", async () => {
      await cm.ensureLoaded(70); // 70% through chunk 0

      // Only the current chunk should have been fetched
      expect(api.getChunk).toHaveBeenCalledTimes(1);
      expect(api.getChunk).toHaveBeenCalledWith("op_mission", 0);
    });

    it("triggers prefetch of next chunk at 80%", async () => {
      await cm.ensureLoaded(80); // 80% through chunk 0

      // Wait for async prefetch to complete
      await vi.waitFor(() => {
        expect(api.getChunk).toHaveBeenCalledTimes(2);
      });

      expect(api.getChunk).toHaveBeenCalledWith("op_mission", 0);
      expect(api.getChunk).toHaveBeenCalledWith("op_mission", 1);
    });

    it("does not prefetch beyond last chunk", async () => {
      // Frame 480 is in chunk 4 (the last chunk), 80% through
      await cm.ensureLoaded(480);

      // Should only fetch chunk 4, no prefetch
      await new Promise((r) => setTimeout(r, 10));
      expect(api.getChunk).toHaveBeenCalledTimes(1);
      expect(api.getChunk).toHaveBeenCalledWith("op_mission", 4);
    });

    it("does not prefetch if next chunk already loaded", async () => {
      // Pre-load chunk 1
      await cm.loadChunk(1);

      // Now at 80% in chunk 0
      await cm.ensureLoaded(80);

      // chunk 0 fetched + chunk 1 was already fetched = 2 total
      // No additional prefetch call
      expect(api.getChunk).toHaveBeenCalledTimes(2);
    });
  });

  // ─── getChunkForFrame ───

  describe("getChunkForFrame", () => {
    beforeEach(async () => {
      await cm.loadManifest("op_mission");
    });

    it("returns null for not-yet-loaded chunks", () => {
      expect(cm.getChunkForFrame(0)).toBeNull();
    });

    it("returns chunk data after loading", async () => {
      await cm.loadChunk(0);
      const chunk = cm.getChunkForFrame(100); // frame 100 -> chunk 0 (chunkSize=300)
      expect(chunk).not.toBeNull();
      expect(chunk!.entities).toBeInstanceOf(Map);
    });
  });

  // ─── clear ───

  describe("clear", () => {
    it("removes all loaded chunks and resets state", async () => {
      await cm.loadManifest("op_mission");
      await cm.loadChunk(0);
      await cm.loadChunk(1);

      cm.clear();

      expect(cm.getManifest()).toBeNull();
      // After clear, accessing getChunkForFrame without manifest throws
      expect(() => cm.getChunkForFrame(0)).toThrow(/manifest not loaded/);
    });
  });
});
