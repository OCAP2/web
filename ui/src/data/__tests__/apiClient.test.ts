import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ApiClient, ApiError, setAuthToken, getAuthToken } from "../apiClient";
import type { CustomizeConfig, BuildInfo } from "../apiClient";

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
    setAuthToken(null);
  });

  // ─── Constructor & URL construction ───

  describe("base URL handling", () => {
    it("defaults to empty prefix", async () => {
      mockFetchJson([]);
      const client = new ApiClient();
      await client.getRecordings();
      expect(fetch).toHaveBeenCalledWith(
        "/api/v1/operations",
        expect.anything(),
      );
    });

    it("strips trailing slashes from base URL", async () => {
      mockFetchJson([]);
      const client = new ApiClient("/custom///");
      await client.getRecordings();
      expect(fetch).toHaveBeenCalledWith(
        "/custom/api/v1/operations",
        expect.anything(),
      );
    });

    it("works with slash prefix", async () => {
      mockFetchJson([]);
      const client = new ApiClient("/");
      await client.getRecordings();
      expect(fetch).toHaveBeenCalledWith(
        "/api/v1/operations",
        expect.anything(),
      );
    });
  });

  // ─── getRecordings ───

  describe("getRecordings", () => {
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
      const recs = await client.getRecordings();

      expect(recs).toHaveLength(1);
      expect(recs[0]).toEqual({
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
      await client.getRecordings({
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
      await client.getRecordings({ tag: "", name: "test" });

      const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(url).not.toContain("tag=");
      expect(url).toContain("name=test");
    });

    it("returns empty array when no recordings", async () => {
      mockFetchJson([]);
      const client = new ApiClient();
      const recs = await client.getRecordings();
      expect(recs).toEqual([]);
    });
  });

  // ─── getRecordingData ───

  describe("getRecordingData", () => {
    it("fetches binary data for a mission file", async () => {
      const buf = new Uint8Array([1, 2, 3, 4]).buffer;
      mockFetchBuffer(buf);

      const client = new ApiClient("/aar/");
      const result = await client.getRecordingData("my_mission");

      expect(fetch).toHaveBeenCalledWith("/aar/data/my_mission.json.gz");
      expect(new Uint8Array(result)).toEqual(new Uint8Array([1, 2, 3, 4]));
    });

    it("encodes special characters in filename", async () => {
      mockFetchBuffer(new ArrayBuffer(0));
      const client = new ApiClient("/aar/");
      await client.getRecordingData("mission with spaces");

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

    it("returns empty config on 204 No Content", async () => {
      mockFetchJson(null, 204);

      const client = new ApiClient("/aar/");
      const result = await client.getCustomize();

      expect(result).toEqual({});
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

  // ─── getRecording ───

  describe("getRecording", () => {
    it("fetches a single recording by ID", async () => {
      mockFetchJson({
        id: 42,
        world_name: "Altis",
        mission_name: "Op Thunder",
        mission_duration: 3600.5,
        filename: "2024_01_01__op_thunder.json",
        date: "2024-01-01",
        tag: "coop",
      });

      const client = new ApiClient("/aar/");
      const rec = await client.getRecording("42");

      expect(fetch).toHaveBeenCalledWith(
        "/aar/api/v1/operations/42",
        expect.anything(),
      );
      expect(rec.id).toBe("42");
      expect(rec.worldName).toBe("Altis");
      expect(rec.missionName).toBe("Op Thunder");
    });
  });

  // ─── getCustomize error ───

  describe("getCustomize error handling", () => {
    it("throws ApiError on non-204 non-OK response", async () => {
      mockFetchError(500, "Internal Server Error");

      const client = new ApiClient("/aar/");
      await expect(client.getCustomize()).rejects.toThrow(ApiError);
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

    it("falls back to PMTiles CDN when local fetch fails", async () => {
      const fetchMock = vi.fn()
        // 1st call: local map.json → fail
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: "Not Found",
          json: () => Promise.reject(new Error("no body")),
        })
        // 2nd call: pmtiles CDN → success
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: "OK",
          json: () => Promise.resolve({ worldSize: 30720, maxZoom: 18, minZoom: 10 }),
        });
      vi.stubGlobal("fetch", fetchMock);

      const client = new ApiClient("/aar/");
      const result = await client.getWorldConfig("Altis");

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1][0]).toBe("https://pmtiles.ocap2.com/altis/map.json");
      expect(result.worldName).toBe("Altis");
      expect(result.worldSize).toBe(30720);
      expect(result.maplibre).toBe(true);
      expect(result.tileBaseUrl).toBe("https://pmtiles.ocap2.com/altis");
    });

    it("falls back to raster CDN when local and PMTiles fail", async () => {
      const fetchMock = vi.fn()
        // 1st call: local map.json → fail
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: "Not Found",
          json: () => Promise.reject(new Error("no body")),
        })
        // 2nd call: pmtiles CDN → fail
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: "Not Found",
          json: () => Promise.reject(new Error("no body")),
        })
        // 3rd call: raster CDN → success
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: "OK",
          json: () => Promise.resolve({ worldSize: 16384, maxZoom: 6, minZoom: 0 }),
        });
      vi.stubGlobal("fetch", fetchMock);

      const client = new ApiClient("/aar/");
      const result = await client.getWorldConfig("Stratis");

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls[2][0]).toBe("https://maps.ocap2.com/stratis/map.json");
      expect(result.worldName).toBe("Stratis");
      expect(result.worldSize).toBe(16384);
      expect(result.maplibre).toBeUndefined();
      expect(result.tileBaseUrl).toBe("https://maps.ocap2.com/stratis");
    });

    it("returns placeholder when all sources fail", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const fetchMock = vi.fn()
        // 1st call: local → fail
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: "Not Found",
          json: () => Promise.reject(new Error("no body")),
        })
        // 2nd call: pmtiles CDN → fail
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: "Not Found",
          json: () => Promise.reject(new Error("no body")),
        })
        // 3rd call: raster CDN → fail
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: "Not Found",
          json: () => Promise.reject(new Error("no body")),
        });
      vi.stubGlobal("fetch", fetchMock);

      const client = new ApiClient("/aar/");
      const result = await client.getWorldConfig("UnknownWorld");

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(result.worldSize).toBe(30720);
      expect(result.imageSize).toBe(30720);
      expect(result.tileBaseUrl).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("UnknownWorld"),
      );
      warnSpy.mockRestore();
    });

    it("falls back to PMTiles CDN when local fetch throws network error", async () => {
      const fetchMock = vi.fn()
        // 1st call: local → network error (throws)
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        // 2nd call: pmtiles CDN → success
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: "OK",
          json: () => Promise.resolve({ worldSize: 30720 }),
        });
      vi.stubGlobal("fetch", fetchMock);

      const client = new ApiClient("/aar/");
      const result = await client.getWorldConfig("Altis");

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.maplibre).toBe(true);
    });

    it("returns placeholder when all sources throw network errors", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const fetchMock = vi.fn()
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockRejectedValueOnce(new TypeError("Failed to fetch"));
      vi.stubGlobal("fetch", fetchMock);

      const client = new ApiClient("/aar/");
      const result = await client.getWorldConfig("Broken");

      expect(result.worldSize).toBe(30720);
      expect(result.imageSize).toBe(30720);
      warnSpy.mockRestore();
    });

    it("skips PMTiles CDN when res.ok is false and tries raster CDN", async () => {
      const fetchMock = vi.fn()
        // 1st: local → ApiError (non-ok)
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: "Not Found",
          json: () => Promise.reject(new Error("no body")),
        })
        // 2nd: pmtiles CDN → 200 but res.ok = false (e.g. redirect gone wrong)
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          statusText: "Forbidden",
          json: () => Promise.reject(new Error("no body")),
        })
        // 3rd: raster CDN → success
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: "OK",
          json: () => Promise.resolve({ worldSize: 16384 }),
        });
      vi.stubGlobal("fetch", fetchMock);

      const client = new ApiClient("/aar/");
      const result = await client.getWorldConfig("Tanoa");

      expect(result.worldName).toBe("Tanoa");
      expect(result.tileBaseUrl).toBe("https://maps.ocap2.com/tanoa");
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

  // ─── getSteamLoginUrl ───

  describe("getSteamLoginUrl", () => {
    it("returns the Steam auth endpoint URL", () => {
      const client = new ApiClient("/aar/");
      expect(client.getSteamLoginUrl()).toBe("/aar/api/v1/auth/steam");
    });

    it("works with empty base URL", () => {
      const client = new ApiClient();
      expect(client.getSteamLoginUrl()).toBe("/api/v1/auth/steam");
    });

    it("saves returnTo path in sessionStorage when provided", () => {
      const client = new ApiClient();
      client.getSteamLoginUrl("/recording/42/my-mission");
      expect(sessionStorage.getItem("ocap_return_to")).toBe("/recording/42/my-mission");
    });

    it("does not save returnTo when not provided", () => {
      const client = new ApiClient();
      sessionStorage.removeItem("ocap_return_to");
      client.getSteamLoginUrl();
      expect(sessionStorage.getItem("ocap_return_to")).toBeNull();
    });
  });

  // ─── popReturnTo ───

  describe("popReturnTo", () => {
    it("returns and removes saved path", () => {
      const client = new ApiClient();
      sessionStorage.setItem("ocap_return_to", "/recording/7/test");
      expect(client.popReturnTo()).toBe("/recording/7/test");
      expect(sessionStorage.getItem("ocap_return_to")).toBeNull();
    });

    it("returns null when nothing saved", () => {
      const client = new ApiClient();
      sessionStorage.removeItem("ocap_return_to");
      expect(client.popReturnTo()).toBeNull();
    });
  });

  // ─── consumeAuthToken ───

  describe("consumeAuthToken", () => {
    it("returns false when no auth_token param exists", () => {
      const client = new ApiClient();
      const params = new URLSearchParams("");
      expect(client.consumeAuthToken(params)).toBe(false);
      expect(getAuthToken()).toBeNull();
    });

    it("reads auth_token from params and stores in session", () => {
      const client = new ApiClient();
      const params = new URLSearchParams("auth_token=test-jwt-token");
      expect(client.consumeAuthToken(params)).toBe(true);
      expect(getAuthToken()).toBe("test-jwt-token");
    });
  });

  // ─── getMe ───

  describe("getMe", () => {
    it("returns auth state when authenticated", async () => {
      setAuthToken("my-jwt");
      mockFetchJson({ authenticated: true });

      const client = new ApiClient("/aar/");
      const result = await client.getMe();

      expect(fetch).toHaveBeenCalledWith("/aar/api/v1/auth/me", {
        headers: { Authorization: "Bearer my-jwt" },
        cache: "no-cache",
      });
      expect(result).toEqual({ authenticated: true });
    });

    it("sends no auth header when no token stored", async () => {
      mockFetchJson({ authenticated: false });

      const client = new ApiClient("/aar/");
      const result = await client.getMe();

      expect(fetch).toHaveBeenCalledWith("/aar/api/v1/auth/me", {
        headers: {},
        cache: "no-cache",
      });
      expect(result).toEqual({ authenticated: false });
    });

    it("returns {authenticated: false} on non-OK response", async () => {
      mockFetchError(401, "Unauthorized");

      const client = new ApiClient("/aar/");
      const result = await client.getMe();

      expect(result).toEqual({ authenticated: false });
    });
  });

  // ─── logout ───

  describe("logout", () => {
    it("posts to logout endpoint and clears token", async () => {
      setAuthToken("my-jwt");
      mockFetchJson(null);

      const client = new ApiClient("/aar/");
      await client.logout();

      expect(fetch).toHaveBeenCalledWith("/aar/api/v1/auth/logout", {
        method: "POST",
        headers: { Authorization: "Bearer my-jwt" },
      });
      expect(getAuthToken()).toBeNull();
    });
  });

  // ─── editRecording ───

  describe("editRecording", () => {
    it("patches operation and returns mapped result", async () => {
      setAuthToken("admin-jwt");
      mockFetchJson({
        id: 42,
        world_name: "Altis",
        mission_name: "Updated",
        mission_duration: 3600.5,
        filename: "2024_01_01__updated.json",
        date: "2024-01-01",
        tag: "coop",
      });

      const client = new ApiClient("/aar/");
      const result = await client.editRecording("42", {
        missionName: "Updated",
      });

      expect(fetch).toHaveBeenCalledWith("/aar/api/v1/operations/42", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: "Bearer admin-jwt" },
        body: JSON.stringify({ missionName: "Updated" }),
      });
      expect(result).toEqual({
        id: "42",
        worldName: "Altis",
        missionName: "Updated",
        missionDuration: 3600.5,
        filename: "2024_01_01__updated.json",
        date: "2024-01-01",
        tag: "coop",
      });
    });

    it("throws ApiError on failure", async () => {
      mockFetchError(403, "Forbidden");

      const client = new ApiClient("/aar/");
      await expect(
        client.editRecording("42", { missionName: "X" }),
      ).rejects.toThrow(ApiError);
    });
  });

  // ─── deleteRecording ───

  describe("deleteRecording", () => {
    it("sends DELETE request with auth header", async () => {
      setAuthToken("admin-jwt");
      mockFetchJson(null);

      const client = new ApiClient("/aar/");
      await client.deleteRecording("42");

      expect(fetch).toHaveBeenCalledWith("/aar/api/v1/operations/42", {
        method: "DELETE",
        headers: { Authorization: "Bearer admin-jwt" },
      });
    });

    it("throws ApiError on failure", async () => {
      mockFetchError(404, "Not Found");

      const client = new ApiClient("/aar/");
      await expect(client.deleteRecording("42")).rejects.toThrow(ApiError);
    });
  });

  // ─── retryConversion ───

  describe("retryConversion", () => {
    it("posts retry request with auth header", async () => {
      setAuthToken("admin-jwt");
      mockFetchJson(null);

      const client = new ApiClient("/aar/");
      await client.retryConversion("42");

      expect(fetch).toHaveBeenCalledWith("/aar/api/v1/operations/42/retry", {
        method: "POST",
        headers: { Authorization: "Bearer admin-jwt" },
      });
    });

    it("throws ApiError on failure", async () => {
      mockFetchError(500, "Internal Server Error");

      const client = new ApiClient("/aar/");
      await expect(client.retryConversion("42")).rejects.toThrow(ApiError);
    });
  });

  // ─── uploadRecording ───

  describe("uploadRecording", () => {
    it("posts FormData with auth header", async () => {
      setAuthToken("admin-jwt");
      mockFetchJson(null);

      const client = new ApiClient("/aar/");
      const formData = new FormData();
      formData.append("file", new Blob(["data"]), "mission.json");
      await client.uploadRecording(formData);

      expect(fetch).toHaveBeenCalledWith("/aar/api/v1/operations/add", {
        method: "POST",
        headers: { Authorization: "Bearer admin-jwt" },
        body: formData,
      });
    });

    it("throws ApiError on failure", async () => {
      mockFetchError(413, "Payload Too Large");

      const client = new ApiClient("/aar/");
      const formData = new FormData();
      await expect(client.uploadRecording(formData)).rejects.toThrow(ApiError);
    });
  });

  // ─── Marker blacklist ───

  describe("getMarkerBlacklist", () => {
    it("fetches blacklisted player IDs", async () => {
      mockFetchJson([5, 10, 42]);

      const client = new ApiClient("/aar/");
      const result = await client.getMarkerBlacklist("99");

      expect(fetch).toHaveBeenCalledWith(
        "/aar/api/v1/operations/99/marker-blacklist",
        expect.objectContaining({ cache: "no-store" }),
      );
      expect(result).toEqual([5, 10, 42]);
    });

    it("throws ApiError on failure", async () => {
      mockFetchError(500, "Internal Server Error");

      const client = new ApiClient("/aar/");
      await expect(client.getMarkerBlacklist("99")).rejects.toThrow(ApiError);
    });
  });

  describe("addMarkerBlacklist", () => {
    it("sends PUT with auth header", async () => {
      setAuthToken("admin-jwt");
      mockFetchJson(null, 204);

      const client = new ApiClient("/aar/");
      await client.addMarkerBlacklist("99", 42);

      expect(fetch).toHaveBeenCalledWith(
        "/aar/api/v1/operations/99/marker-blacklist/42",
        expect.objectContaining({
          method: "PUT",
          headers: { Authorization: "Bearer admin-jwt" },
        }),
      );
    });

    it("throws ApiError on failure", async () => {
      mockFetchError(401, "Unauthorized");

      const client = new ApiClient("/aar/");
      await expect(client.addMarkerBlacklist("99", 42)).rejects.toThrow(ApiError);
    });
  });

  describe("removeMarkerBlacklist", () => {
    it("sends DELETE with auth header", async () => {
      setAuthToken("admin-jwt");
      mockFetchJson(null, 204);

      const client = new ApiClient("/aar/");
      await client.removeMarkerBlacklist("99", 42);

      expect(fetch).toHaveBeenCalledWith(
        "/aar/api/v1/operations/99/marker-blacklist/42",
        expect.objectContaining({
          method: "DELETE",
          headers: { Authorization: "Bearer admin-jwt" },
        }),
      );
    });

    it("throws ApiError on failure", async () => {
      mockFetchError(401, "Unauthorized");

      const client = new ApiClient("/aar/");
      await expect(client.removeMarkerBlacklist("99", 42)).rejects.toThrow(ApiError);
    });
  });

  // ─── Error handling ───

  describe("error handling", () => {
    it("throws ApiError on non-OK response", async () => {
      mockFetchError(404, "Not Found");

      const client = new ApiClient("/aar/");
      await expect(client.getRecordings()).rejects.toThrow(ApiError);
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
      await expect(client.getRecordingData("x")).rejects.toThrow(ApiError);
    });

    it("propagates network errors as-is", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
      );

      const client = new ApiClient("/aar/");
      await expect(client.getRecordings()).rejects.toThrow(TypeError);
    });
  });

  // ─── MapTool methods ───

  describe("getMapToolTools", () => {
    it("fetches tools from maptool API", async () => {
      const tools = [{ name: "pmtiles", found: true, path: "/usr/bin/pmtiles", required: true }];
      mockFetchJson(tools);
      setAuthToken("tok");

      const client = new ApiClient();
      const result = await client.getMapToolTools();
      expect(result).toEqual(tools);

      const [url, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/v1/maptool/tools");
      expect(opts.headers.Authorization).toBe("Bearer tok");
    });

    it("throws on error", async () => {
      mockFetchError(403, "Forbidden");
      setAuthToken("tok");
      const client = new ApiClient();
      await expect(client.getMapToolTools()).rejects.toThrow(ApiError);
    });
  });

  describe("getMapToolMaps", () => {
    it("fetches maps list", async () => {
      const maps = [{ name: "Altis", status: "complete", worldSize: 30720 }];
      mockFetchJson(maps);
      setAuthToken("tok");

      const client = new ApiClient();
      const result = await client.getMapToolMaps();
      expect(result).toEqual(maps);

      const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/v1/maptool/maps");
    });
  });

  describe("deleteMapToolMap", () => {
    it("sends DELETE with auth header", async () => {
      mockFetchJson(null);
      setAuthToken("tok");

      const client = new ApiClient();
      await client.deleteMapToolMap("Altis");

      const [url, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/v1/maptool/maps/Altis");
      expect(opts.method).toBe("DELETE");
      expect(opts.headers.Authorization).toBe("Bearer tok");
    });

    it("throws on error", async () => {
      mockFetchError(404, "Not Found");
      setAuthToken("tok");
      const client = new ApiClient();
      await expect(client.deleteMapToolMap("NoMap")).rejects.toThrow(ApiError);
    });

    it("encodes map name in URL", async () => {
      mockFetchJson(null);
      setAuthToken("tok");

      const client = new ApiClient();
      await client.deleteMapToolMap("map with spaces");

      const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/v1/maptool/maps/map%20with%20spaces");
    });
  });

  describe("restyleMapToolAll", () => {
    it("sends POST to restyle endpoint", async () => {
      const job = { id: "j1", worldName: "all", status: "pending" };
      mockFetchJson(job);
      setAuthToken("tok");

      const client = new ApiClient();
      const result = await client.restyleMapToolAll();
      expect(result).toEqual(job);

      const [url, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/v1/maptool/maps/restyle");
      expect(opts.method).toBe("POST");
    });
  });

  describe("getMapToolJobs", () => {
    it("fetches jobs list", async () => {
      const jobs = [{ id: "j1", worldName: "Altis", status: "done" }];
      mockFetchJson(jobs);
      setAuthToken("tok");

      const client = new ApiClient();
      const result = await client.getMapToolJobs();
      expect(result).toEqual(jobs);
    });
  });

  describe("cancelMapToolJob", () => {
    it("sends POST to cancel endpoint", async () => {
      mockFetchJson(null);
      setAuthToken("tok");

      const client = new ApiClient();
      await client.cancelMapToolJob("job-123");

      const [url, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe("/api/v1/maptool/jobs/job-123/cancel");
      expect(opts.method).toBe("POST");
    });

    it("throws on error", async () => {
      mockFetchError(404, "Not Found");
      setAuthToken("tok");
      const client = new ApiClient();
      await expect(client.cancelMapToolJob("bad")).rejects.toThrow(ApiError);
    });
  });

  describe("getMapToolEventsUrl", () => {
    it("returns URL without token when not authenticated", () => {
      setAuthToken(null as unknown as string);
      const client = new ApiClient();
      expect(client.getMapToolEventsUrl()).toBe("/api/v1/maptool/events");
    });

    it("returns URL with token when authenticated", () => {
      setAuthToken("my-token");
      const client = new ApiClient();
      expect(client.getMapToolEventsUrl()).toBe(
        "/api/v1/maptool/events?token=my-token",
      );
    });

    it("encodes token in URL", () => {
      setAuthToken("tok/en=special");
      const client = new ApiClient();
      expect(client.getMapToolEventsUrl()).toContain(
        "token=tok%2Fen%3Dspecial",
      );
    });

    it("respects base URL prefix", () => {
      setAuthToken("tok");
      const client = new ApiClient("/aar");
      expect(client.getMapToolEventsUrl()).toBe(
        "/aar/api/v1/maptool/events?token=tok",
      );
    });
  });

  describe("importMapToolZip", () => {
    let lastXhr: {
      open: ReturnType<typeof vi.fn>;
      setRequestHeader: ReturnType<typeof vi.fn>;
      send: ReturnType<typeof vi.fn>;
      upload: { onprogress: ((e: unknown) => void) | null };
      onload: (() => void) | null;
      onerror: (() => void) | null;
      status: number;
      statusText: string;
      responseText: string;
    };

    class MockXHR {
      open = vi.fn();
      setRequestHeader = vi.fn();
      send = vi.fn();
      upload = { onprogress: null as ((e: unknown) => void) | null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      status = 200;
      statusText = "OK";
      responseText = "";
      constructor() {
        lastXhr = this;
      }
    }

    beforeEach(() => {
      vi.stubGlobal("XMLHttpRequest", MockXHR);
    });

    it("sends file via XHR with FormData", async () => {
      setAuthToken("tok");

      const client = new ApiClient();
      const file = new File(["data"], "test.zip", { type: "application/zip" });

      const promise = client.importMapToolZip(file);

      lastXhr.status = 200;
      lastXhr.responseText = JSON.stringify({ id: "j1", worldName: "Altis", status: "pending" });
      lastXhr.onload!();

      const result = await promise;
      expect(result.id).toBe("j1");
      expect(lastXhr.open).toHaveBeenCalledWith("POST", "/api/v1/maptool/maps/import");
      expect(lastXhr.setRequestHeader).toHaveBeenCalledWith("Authorization", "Bearer tok");
    });

    it("rejects on HTTP error", async () => {
      setAuthToken("tok");

      const client = new ApiClient();
      const file = new File(["data"], "test.zip");

      const promise = client.importMapToolZip(file);

      lastXhr.status = 413;
      lastXhr.statusText = "Payload Too Large";
      lastXhr.onload!();

      await expect(promise).rejects.toThrow(ApiError);
    });

    it("rejects on network error", async () => {
      setAuthToken("tok");

      const client = new ApiClient();
      const file = new File(["data"], "test.zip");

      const promise = client.importMapToolZip(file);
      lastXhr.onerror!();

      await expect(promise).rejects.toThrow(ApiError);
    });

    it("calls onProgress callback", async () => {
      setAuthToken("tok");

      const onProgress = vi.fn();
      const client = new ApiClient();
      const file = new File(["data"], "test.zip");

      const promise = client.importMapToolZip(file, onProgress);

      // Simulate progress
      lastXhr.upload.onprogress!({ lengthComputable: true, loaded: 500, total: 1000 });
      expect(onProgress).toHaveBeenCalledWith(500, 1000);

      // Complete
      lastXhr.status = 200;
      lastXhr.responseText = JSON.stringify({ id: "j1", worldName: "Altis", status: "pending" });
      lastXhr.onload!();
      await promise;
    });
  });
});
