import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ApiClient, ApiError } from "../api-client";
import type { CustomizeConfig, BuildInfo } from "../api-client";

// ─── Helpers ───

function mockFetchJson(data: unknown, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Not Found",
      json: () => Promise.resolve(data),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    }),
  );
}

function mockFetchBuffer(data: ArrayBuffer, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "Not Found",
      json: () => Promise.resolve(null),
      arrayBuffer: () => Promise.resolve(data),
    }),
  );
}

function mockFetchError(status: number, statusText: string): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      statusText,
      json: () => Promise.reject(new Error("should not read body")),
      arrayBuffer: () => Promise.reject(new Error("should not read body")),
    }),
  );
}

// ─── Tests ───

describe("ApiClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Constructor & URL construction ───

  describe("base URL handling", () => {
    it("defaults to empty prefix", async () => {
      mockFetchJson([]);
      const client = new ApiClient();
      await client.getOperations();
      expect(fetch).toHaveBeenCalledWith(
        "/api/v1/operations",
        expect.anything(),
      );
    });

    it("strips trailing slashes from base URL", async () => {
      mockFetchJson([]);
      const client = new ApiClient("/custom///");
      await client.getOperations();
      expect(fetch).toHaveBeenCalledWith(
        "/custom/api/v1/operations",
        expect.anything(),
      );
    });

    it("works with slash prefix", async () => {
      mockFetchJson([]);
      const client = new ApiClient("/");
      await client.getOperations();
      expect(fetch).toHaveBeenCalledWith(
        "/api/v1/operations",
        expect.anything(),
      );
    });
  });

  // ─── getOperations ───

  describe("getOperations", () => {
    it("fetches operations and maps snake_case to camelCase", async () => {
      mockFetchJson([
        {
          id: 42,
          world_name: "Altis",
          mission_name: "Op Thunder",
          mission_duration: 3600.5,
          filename: "2024_01_01__op_thunder.json",
          date: "2024-01-01",
          tag: "coop",
        },
      ]);

      const client = new ApiClient("/aar/");
      const ops = await client.getOperations();

      expect(ops).toHaveLength(1);
      expect(ops[0]).toEqual({
        id: "42",
        worldName: "Altis",
        missionName: "Op Thunder",
        missionDuration: 3600.5,
        date: "2024-01-01",
        tag: "coop",
        filename: "2024_01_01__op_thunder.json",
      });
    });

    it("passes filter parameters as query string", async () => {
      mockFetchJson([]);
      const client = new ApiClient("/aar/");
      await client.getOperations({
        tag: "tvt",
        name: "thunder",
        newer: "2024-01-01",
        older: "2024-12-31",
      });

      const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(url).toContain("tag=tvt");
      expect(url).toContain("name=thunder");
      expect(url).toContain("newer=2024-01-01");
      expect(url).toContain("older=2024-12-31");
    });

    it("omits empty filter values from query string", async () => {
      mockFetchJson([]);
      const client = new ApiClient("/aar/");
      await client.getOperations({ tag: "", name: "test" });

      const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(url).not.toContain("tag=");
      expect(url).toContain("name=test");
    });

    it("returns empty array when no operations", async () => {
      mockFetchJson([]);
      const client = new ApiClient();
      const ops = await client.getOperations();
      expect(ops).toEqual([]);
    });
  });

  // ─── getMissionData ───

  describe("getMissionData", () => {
    it("fetches binary data for a mission file", async () => {
      const buf = new Uint8Array([1, 2, 3, 4]).buffer;
      mockFetchBuffer(buf);

      const client = new ApiClient("/aar/");
      const result = await client.getMissionData("my_mission");

      expect(fetch).toHaveBeenCalledWith("/aar/data/my_mission.json.gz");
      expect(new Uint8Array(result)).toEqual(new Uint8Array([1, 2, 3, 4]));
    });

    it("encodes special characters in filename", async () => {
      mockFetchBuffer(new ArrayBuffer(0));
      const client = new ApiClient("/aar/");
      await client.getMissionData("mission with spaces");

      const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(url).toContain("mission%20with%20spaces.json.gz");
    });
  });

  // ─── getCustomize ───

  describe("getCustomize", () => {
    it("returns customize config", async () => {
      const data: CustomizeConfig = {
        websiteURL: "https://example.com",
        websiteLogo: "/logo.png",
        websiteLogoSize: "64px",
        disableKillCount: true,
      };
      mockFetchJson(data);

      const client = new ApiClient("/aar/");
      const result = await client.getCustomize();

      expect(fetch).toHaveBeenCalledWith(
        "/aar/api/v1/customize",
        expect.anything(),
      );
      expect(result).toEqual(data);
    });
  });

  // ─── getVersion ───

  describe("getVersion", () => {
    it("returns build info", async () => {
      const data: BuildInfo = {
        BuildVersion: "v2.1.0",
        BuildCommit: "abc123",
        BuildDate: "2024-01-01",
      };
      mockFetchJson(data);

      const client = new ApiClient("/aar/");
      const result = await client.getVersion();

      expect(fetch).toHaveBeenCalledWith(
        "/aar/api/version",
        expect.anything(),
      );
      expect(result.BuildVersion).toBe("v2.1.0");
      expect(result.BuildCommit).toBe("abc123");
      expect(result.BuildDate).toBe("2024-01-01");
    });
  });

  // ─── getWorldConfig ───

  describe("getWorldConfig", () => {
    it("fetches world config from map.json", async () => {
      mockFetchJson({
        worldName: "altis",
        worldSize: 30720,
        maxZoom: 18,
        minZoom: 10,
      });

      const client = new ApiClient("/aar/");
      const result = await client.getWorldConfig("altis");

      expect(fetch).toHaveBeenCalledWith(
        "/aar/images/maps/altis/map.json",
        expect.anything(),
      );
      expect(result.worldName).toBe("altis");
      expect(result.worldSize).toBe(30720);
    });
  });

  // ─── getManifest / getChunk ───

  describe("getManifest", () => {
    it("fetches manifest as ArrayBuffer via static data path", async () => {
      const buf = new Uint8Array([10, 20, 30]).buffer;
      mockFetchBuffer(buf);

      const client = new ApiClient("/aar/");
      const result = await client.getManifest("op-123");

      expect(fetch).toHaveBeenCalledWith(
        "/aar/data/op-123/manifest.pb",
      );
      expect(new Uint8Array(result)).toEqual(new Uint8Array([10, 20, 30]));
    });
  });

  describe("getChunk", () => {
    it("fetches chunk as ArrayBuffer via static data path with zero-padded index", async () => {
      const buf = new Uint8Array([0xaa, 0xbb]).buffer;
      mockFetchBuffer(buf);

      const client = new ApiClient("/aar/");
      const result = await client.getChunk("op-123", 5);

      expect(fetch).toHaveBeenCalledWith(
        "/aar/data/op-123/chunks/0005.pb",
      );
      expect(new Uint8Array(result)).toEqual(new Uint8Array([0xaa, 0xbb]));
    });
  });

  // ─── Error handling ───

  describe("error handling", () => {
    it("throws ApiError on non-OK response", async () => {
      mockFetchError(404, "Not Found");

      const client = new ApiClient("/aar/");
      await expect(client.getOperations()).rejects.toThrow(ApiError);
    });

    it("ApiError contains status code and statusText", async () => {
      mockFetchError(500, "Internal Server Error");

      const client = new ApiClient("/aar/");
      try {
        await client.getVersion();
        expect.fail("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
        const err = e as ApiError;
        expect(err.status).toBe(500);
        expect(err.statusText).toBe("Internal Server Error");
        expect(err.message).toContain("500");
      }
    });

    it("throws ApiError for binary endpoints too", async () => {
      mockFetchError(403, "Forbidden");

      const client = new ApiClient("/aar/");
      await expect(client.getMissionData("x")).rejects.toThrow(ApiError);
    });

    it("propagates network errors as-is", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
      );

      const client = new ApiClient("/aar/");
      await expect(client.getOperations()).rejects.toThrow(TypeError);
    });
  });
});
