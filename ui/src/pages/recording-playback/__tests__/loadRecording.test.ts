import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadRecording } from "../loadRecording";
import type { Recording, WorldConfig, Manifest } from "../../../data/types";
import type { ApiClient } from "../../../data/apiClient";
import type { PlaybackEngine } from "../../../playback/engine";
import type { MarkerManager } from "../../../playback/markerManager";
import { ChunkManager } from "../../../data/chunkManager";
import { JsonDecoder } from "../../../data/decoders/jsonDecoder";
import { ProtobufDecoder } from "../../../data/decoders/protobufDecoder";

// ─── Mock modules ───

// We need mocks that act as constructors.
// vi.mock returns a factory whose replacement must be usable with `new`.

const mockChunkMgr = {
  loadManifest: vi.fn(),
  loadChunk: vi.fn(),
};

vi.mock("../../../data/chunkManager", () => {
  return {
    ChunkManager: vi.fn().mockImplementation(function () {
      return mockChunkMgr;
    }),
  };
});

const mockJsonDecoder = {
  decodeManifest: vi.fn(),
};

vi.mock("../../../data/decoders/jsonDecoder", () => {
  return {
    JsonDecoder: vi.fn().mockImplementation(function () {
      return mockJsonDecoder;
    }),
  };
});

vi.mock("../../../data/decoders/protobufDecoder", () => {
  return {
    ProtobufDecoder: vi.fn().mockImplementation(function () {
      return {};
    }),
  };
});

// ─── Helpers ───

function makeWorldConfig(overrides: Partial<WorldConfig> = {}): WorldConfig {
  return {
    worldName: "Altis",
    worldSize: 30720,
    maxZoom: 6,
    minZoom: 0,
    ...overrides,
  };
}

function makeManifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    version: 1,
    worldName: "Altis",
    missionName: "Test Mission",
    frameCount: 100,
    chunkSize: 300,
    captureDelayMs: 1000,
    chunkCount: 1,
    entities: [],
    events: [],
    markers: [],
    times: [],
    extensionVersion: "1.2.3",
    addonVersion: "4.5.6",
    ...overrides,
  };
}

function makeRecording(overrides: Partial<Recording> = {}): Recording {
  return {
    id: "42",
    worldName: "Altis",
    missionName: "Test Mission",
    missionDuration: 3600,
    date: "2024-01-15",
    filename: "test-recording",
    ...overrides,
  };
}

function makeMockApi(worldConfig: WorldConfig, recordingData?: ArrayBuffer): ApiClient {
  return {
    getWorldConfig: vi.fn().mockResolvedValue(worldConfig),
    getRecordingData: vi.fn().mockResolvedValue(recordingData ?? new ArrayBuffer(0)),
  } as unknown as ApiClient;
}

function makeMockEngine(): PlaybackEngine {
  return {
    loadRecording: vi.fn(),
    entityManager: {
      getEntity: vi.fn().mockReturnValue(null),
    },
  } as unknown as PlaybackEngine;
}

function makeMockMarkerManager(): MarkerManager {
  return {
    loadMarkers: vi.fn(),
  } as unknown as MarkerManager;
}

// ─── Tests ───

describe("loadRecording", () => {
  let world: WorldConfig;
  let api: ApiClient;
  let engine: PlaybackEngine;
  let markerManager: MarkerManager;

  beforeEach(() => {
    vi.clearAllMocks();

    world = makeWorldConfig();
    api = makeMockApi(world);
    engine = makeMockEngine();
    markerManager = makeMockMarkerManager();
  });

  // ─── JSON path ───

  describe("JSON storage format", () => {
    it("fetches world config and recording data", async () => {
      const manifest = makeManifest();
      mockJsonDecoder.decodeManifest.mockReturnValue(manifest);

      const rec = makeRecording({ storageFormat: "json" });
      await loadRecording(api, engine, markerManager, rec);

      expect(api.getWorldConfig).toHaveBeenCalledWith("Altis");
      expect(api.getRecordingData).toHaveBeenCalledWith("test-recording");
    });

    it("creates a JsonDecoder and decodes the manifest", async () => {
      const manifest = makeManifest();
      mockJsonDecoder.decodeManifest.mockReturnValue(manifest);

      const rec = makeRecording({ storageFormat: "json" });
      await loadRecording(api, engine, markerManager, rec);

      expect(JsonDecoder).toHaveBeenCalledOnce();
      expect(mockJsonDecoder.decodeManifest).toHaveBeenCalledOnce();
    });

    it("calls engine.loadRecording with manifest (no chunkManager)", async () => {
      const manifest = makeManifest();
      mockJsonDecoder.decodeManifest.mockReturnValue(manifest);

      const rec = makeRecording({ storageFormat: "json" });
      await loadRecording(api, engine, markerManager, rec);

      expect(engine.loadRecording).toHaveBeenCalledWith(manifest);
    });

    it("loads markers with entity name lookup", async () => {
      const manifest = makeManifest({
        markers: [
          {
            shape: "ICON",
            type: "mil_dot",
            side: "WEST",
            color: "#0000ff",
            positions: [[0, 100, 200, 0, 0, 1]],
            player: 1,
            alpha: 1,
            startFrame: 0,
            endFrame: 99,
          },
        ],
      });
      mockJsonDecoder.decodeManifest.mockReturnValue(manifest);

      const mockEntity = { name: "Player1" };
      (engine.entityManager.getEntity as ReturnType<typeof vi.fn>).mockReturnValue(mockEntity);

      const rec = makeRecording({ storageFormat: "json" });
      await loadRecording(api, engine, markerManager, rec);

      expect(markerManager.loadMarkers).toHaveBeenCalledOnce();
      const [markers, nameLookup] = (markerManager.loadMarkers as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(markers).toBe(manifest.markers);

      // Test the name lookup function
      const name = nameLookup(1);
      expect(name).toBe("Player1");
      expect(engine.entityManager.getEntity).toHaveBeenCalledWith(1);
    });

    it("name lookup returns null for missing entity", async () => {
      const manifest = makeManifest();
      mockJsonDecoder.decodeManifest.mockReturnValue(manifest);

      (engine.entityManager.getEntity as ReturnType<typeof vi.fn>).mockReturnValue(null);

      const rec = makeRecording({ storageFormat: "json" });
      await loadRecording(api, engine, markerManager, rec);

      const [, nameLookup] = (markerManager.loadMarkers as ReturnType<typeof vi.fn>).mock.calls[0];
      const name = nameLookup(999);
      expect(name).toBeNull();
    });

    it("returns correct LoadResult", async () => {
      const manifest = makeManifest({
        extensionVersion: "1.2.3",
        addonVersion: "4.5.6",
      });
      mockJsonDecoder.decodeManifest.mockReturnValue(manifest);

      const rec = makeRecording({
        id: "42",
        missionName: "Test Mission",
        filename: "test-recording",
      });
      const result = await loadRecording(api, engine, markerManager, rec);

      expect(result).toEqual({
        worldConfig: world,
        missionName: "Test Mission",
        recordingId: "42",
        recordingFilename: "test-recording",
        extensionVersion: "1.2.3",
        addonVersion: "4.5.6",
      });
    });

    it("uses String(rec.id) when filename is undefined", async () => {
      const manifest = makeManifest();
      mockJsonDecoder.decodeManifest.mockReturnValue(manifest);

      const rec = makeRecording({ filename: undefined });
      const result = await loadRecording(api, engine, markerManager, rec);

      expect(api.getRecordingData).toHaveBeenCalledWith("42");
      expect(result.recordingFilename).toBe("42");
    });

    it("handles undefined storageFormat (defaults to JSON path)", async () => {
      const manifest = makeManifest();
      mockJsonDecoder.decodeManifest.mockReturnValue(manifest);

      const rec = makeRecording({ storageFormat: undefined });
      await loadRecording(api, engine, markerManager, rec);

      expect(JsonDecoder).toHaveBeenCalledOnce();
      expect(api.getRecordingData).toHaveBeenCalled();
    });
  });

  // ─── Protobuf path ───

  describe("protobuf storage format", () => {
    it("creates ProtobufDecoder and ChunkManager", async () => {
      const manifest = makeManifest();
      mockChunkMgr.loadManifest.mockResolvedValue(manifest);
      mockChunkMgr.loadChunk.mockResolvedValue(undefined);

      const rec = makeRecording({ storageFormat: "protobuf" });
      await loadRecording(api, engine, markerManager, rec);

      expect(ProtobufDecoder).toHaveBeenCalledOnce();
      expect(ChunkManager).toHaveBeenCalledOnce();
    });

    it("loads manifest and chunk 0 via ChunkManager", async () => {
      const manifest = makeManifest();
      mockChunkMgr.loadManifest.mockResolvedValue(manifest);
      mockChunkMgr.loadChunk.mockResolvedValue(undefined);

      const rec = makeRecording({ storageFormat: "protobuf", filename: "my-recording" });
      await loadRecording(api, engine, markerManager, rec);

      expect(mockChunkMgr.loadManifest).toHaveBeenCalledWith("my-recording");
      expect(mockChunkMgr.loadChunk).toHaveBeenCalledWith(0);
    });

    it("calls engine.loadRecording with manifest and chunkManager", async () => {
      const manifest = makeManifest();
      mockChunkMgr.loadManifest.mockResolvedValue(manifest);
      mockChunkMgr.loadChunk.mockResolvedValue(undefined);

      const rec = makeRecording({ storageFormat: "protobuf" });
      await loadRecording(api, engine, markerManager, rec);

      expect(engine.loadRecording).toHaveBeenCalledWith(manifest, mockChunkMgr);
    });

    it("returns correct LoadResult for protobuf path", async () => {
      const manifest = makeManifest({
        extensionVersion: "2.0.0",
        addonVersion: "3.0.0",
      });
      mockChunkMgr.loadManifest.mockResolvedValue(manifest);
      mockChunkMgr.loadChunk.mockResolvedValue(undefined);

      const rec = makeRecording({ storageFormat: "protobuf" });
      const result = await loadRecording(api, engine, markerManager, rec);

      expect(result).toEqual({
        worldConfig: world,
        missionName: "Test Mission",
        recordingId: "42",
        recordingFilename: "test-recording",
        extensionVersion: "2.0.0",
        addonVersion: "3.0.0",
      });
    });
  });

  // ─── onWorldResolved callback ───

  describe("onWorldResolved callback", () => {
    it("calls onWorldResolved with world config before loading", async () => {
      const manifest = makeManifest();
      mockJsonDecoder.decodeManifest.mockReturnValue(manifest);

      const onWorldResolved = vi.fn();
      const rec = makeRecording();
      await loadRecording(api, engine, markerManager, rec, onWorldResolved);

      expect(onWorldResolved).toHaveBeenCalledWith(world);
    });

    it("works without onWorldResolved callback (optional)", async () => {
      const manifest = makeManifest();
      mockJsonDecoder.decodeManifest.mockReturnValue(manifest);

      const rec = makeRecording();
      // Should not throw when onWorldResolved is undefined
      const result = await loadRecording(api, engine, markerManager, rec);
      expect(result.worldConfig).toEqual(world);
    });
  });

  // ─── Manifest version fields ───

  describe("version fields", () => {
    it("returns undefined extensionVersion when manifest has none", async () => {
      const manifest = makeManifest({
        extensionVersion: undefined,
        addonVersion: undefined,
      });
      mockJsonDecoder.decodeManifest.mockReturnValue(manifest);

      const rec = makeRecording();
      const result = await loadRecording(api, engine, markerManager, rec);

      expect(result.extensionVersion).toBeUndefined();
      expect(result.addonVersion).toBeUndefined();
    });
  });
});
