import type { Recording, WorldConfig } from "./types";

// ─── Response types for endpoints not covered in types.ts ───

export interface CustomizeConfig {
  websiteURL?: string;
  websiteLogo?: string;
  websiteLogoSize?: string;
  disableKillCount?: boolean;
  headerTitle?: string;
  headerSubtitle?: string;
  cssOverrides?: Record<string, string>;
}

export interface BuildInfo {
  BuildVersion: string;
  BuildCommit: string;
  BuildDate: string;
}

export interface AuthState {
  authenticated: boolean;
  steamId?: string;
  steamName?: string;
  steamAvatar?: string;
}

// ─── Error types ───

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly statusText: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ─── Raw server response shape (snake_case from Go JSON tags) ───

interface RawRecording {
  id: number;
  world_name: string;
  mission_name: string;
  mission_duration: number;
  filename: string;
  date: string;
  tag?: string;
  storageFormat?: string;
  conversionStatus?: string;
  schemaVersion?: number;
  chunkCount?: number;
  player_count?: number;
  kill_count?: number;
  player_kill_count?: number;
  side_composition?: Record<string, { players: number; units: number; dead: number; kills: number }>;
}

function mapRecording(raw: RawRecording): Recording {
  return {
    id: String(raw.id),
    worldName: raw.world_name,
    missionName: raw.mission_name,
    missionDuration: raw.mission_duration,
    date: raw.date,
    tag: raw.tag,
    filename: raw.filename,
    storageFormat: raw.storageFormat,
    conversionStatus: raw.conversionStatus,
    schemaVersion: raw.schemaVersion,
    chunkCount: raw.chunkCount,
    playerCount: raw.player_count,
    killCount: raw.kill_count,
    playerKillCount: raw.player_kill_count,
    sideComposition: raw.side_composition,
  };
}

// ─── Query filter parameters for recordings endpoint ───

export interface RecordingFilters {
  tag?: string;
  name?: string;
  newer?: string;
  older?: string;
}

// ─── API Client ───

// ─── JWT token store ───

const TOKEN_KEY = "ocap_token";

let authToken: string | null = sessionStorage.getItem(TOKEN_KEY);

export function setAuthToken(token: string | null): void {
  authToken = token;
  if (token) {
    sessionStorage.setItem(TOKEN_KEY, token);
  } else {
    sessionStorage.removeItem(TOKEN_KEY);
  }
}

export function getAuthToken(): string | null {
  return authToken;
}

function authHeaders(): Record<string, string> {
  return authToken ? { Authorization: `Bearer ${authToken}` } : {};
}

// ─── API Client ───

export class ApiClient {
  private readonly baseUrl: string;

  /**
   * @param baseUrl - Base URL prefix for all API calls (default: "").
   *   Matches the Go server's prefixURL setting. A trailing slash is normalised internally.
   */
  constructor(baseUrl = "") {
    // Ensure no trailing slash so we can append /api/... cleanly
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  // ─── Public helpers ───

  /**
   * Fetch the list of recordings, optionally filtered.
   * GET {baseUrl}/api/v1/operations
   */
  async getRecordings(filters?: RecordingFilters): Promise<Recording[]> {
    const params = new URLSearchParams();
    if (filters?.tag) params.set("tag", filters.tag);
    if (filters?.name) params.set("name", filters.name);
    if (filters?.newer) params.set("newer", filters.newer);
    if (filters?.older) params.set("older", filters.older);

    const qs = params.toString();
    const url = `${this.baseUrl}/api/v1/operations${qs ? `?${qs}` : ""}`;
    const data = await this.fetchJson<RawRecording[]>(url);
    return data.map(mapRecording);
  }

  /**
   * Fetch a single recording by ID or filename.
   * GET {baseUrl}/api/v1/operations/{id}
   */
  async getRecording(id: string): Promise<Recording> {
    const url = `${this.baseUrl}/api/v1/operations/${encodeURIComponent(id)}`;
    const data = await this.fetchJson<RawRecording>(url);
    return mapRecording(data);
  }

  /**
   * Fetch raw recording data (gzipped JSON served as a static file).
   * GET {baseUrl}/data/{filename}.json.gz
   */
  async getRecordingData(filename: string): Promise<ArrayBuffer> {
    const url = `${this.baseUrl}/data/${encodeURIComponent(filename)}.json.gz`;
    return this.fetchBuffer(url);
  }

  /**
   * Fetch UI customization config.
   * GET {baseUrl}/api/v1/customize
   */
  async getCustomize(): Promise<CustomizeConfig> {
    const response = await fetch(`${this.baseUrl}/api/v1/customize`, {
      cache: "no-cache",
    });
    if (response.status === 204) {
      return {};
    }
    if (!response.ok) {
      throw new ApiError(
        `GET customize failed: ${response.status} ${response.statusText}`,
        response.status,
        response.statusText,
      );
    }
    return response.json() as Promise<CustomizeConfig>;
  }

  /**
   * Fetch server build/version info.
   * GET {baseUrl}/api/version
   */
  async getVersion(): Promise<BuildInfo> {
    return this.fetchJson<BuildInfo>(`${this.baseUrl}/api/version`);
  }

  /**
   * Probe for per-world map configuration with fallback chain:
   * 1. Local server: /images/maps/{worldName}/map.json
   * 2. PMTiles CDN: https://pmtiles.ocap2.com/{worldName}/map.json
   * 3. Legacy raster CDN: https://maps.ocap2.com/{worldName}/map.json
   * 4. Blank placeholder if nothing found
   */
  async getWorldConfig(worldName: string): Promise<WorldConfig> {
    const defaults: WorldConfig = {
      worldName,
      worldSize: 16384,
      imageSize: 16384,
      multiplier: 1,
      maxZoom: 6,
      minZoom: 0,
    };

    const normalizedName = worldName.toLowerCase();

    // 1. Try local map data
    try {
      const localUrl = `${this.baseUrl}/images/maps/${encodeURIComponent(normalizedName)}/map.json`;
      const local = await this.fetchJson<Partial<WorldConfig>>(localUrl);
      return {
        ...defaults,
        ...local,
        tileBaseUrl: `${this.baseUrl}/images/maps/${encodeURIComponent(normalizedName)}`,
        worldName,
      };
    } catch {
      // Local not available, try CDN
    }

    // 2. Try PMTiles CDN (MapLibre-capable)
    try {
      const pmtilesUrl = `https://pmtiles.ocap2.com/${encodeURIComponent(normalizedName)}/map.json`;
      const res = await fetch(pmtilesUrl, { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as Partial<WorldConfig>;
        return {
          ...defaults,
          ...data,
          maplibre: true,
          tileBaseUrl: `https://pmtiles.ocap2.com/${encodeURIComponent(normalizedName)}`,
          worldName,
        };
      }
    } catch {
      // PMTiles CDN not available
    }

    // 3. Try legacy raster CDN
    try {
      const rasterUrl = `https://maps.ocap2.com/${encodeURIComponent(normalizedName)}/map.json`;
      const res = await fetch(rasterUrl, { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as Partial<WorldConfig>;
        return {
          ...defaults,
          ...data,
          tileBaseUrl: `https://maps.ocap2.com/${encodeURIComponent(normalizedName)}`,
          worldName,
        };
      }
    } catch {
      // Raster CDN not available
    }

    // 4. Fallback — blank placeholder
    console.warn(`Map for world "${worldName}" not found locally or on CDN, using placeholder`);
    return { ...defaults, worldSize: 30720, imageSize: 30720 };
  }

  /**
   * Fetch a protobuf manifest as raw bytes (static file).
   * GET {baseUrl}/data/{filename}/manifest.pb
   */
  async getManifest(filename: string): Promise<ArrayBuffer> {
    const url = `${this.baseUrl}/data/${encodeURIComponent(filename)}/manifest.pb`;
    return this.fetchBuffer(url);
  }

  /**
   * Fetch a protobuf chunk as raw bytes (static file).
   * GET {baseUrl}/data/{filename}/chunks/{NNNN}.pb
   */
  async getChunk(
    filename: string,
    chunkIndex: number,
  ): Promise<ArrayBuffer> {
    const idx = String(chunkIndex).padStart(4, "0");
    const url = `${this.baseUrl}/data/${encodeURIComponent(filename)}/chunks/${idx}.pb`;
    return this.fetchBuffer(url);
  }

  // ─── Auth methods ───

  getSteamLoginUrl(returnTo?: string): string {
    if (returnTo) {
      sessionStorage.setItem("ocap_return_to", returnTo);
    }
    return `${this.baseUrl}/api/v1/auth/steam`;
  }

  /**
   * Pops the saved return-to path (if any) from sessionStorage.
   * Returns null if nothing was saved.
   */
  popReturnTo(): string | null {
    const path = sessionStorage.getItem("ocap_return_to");
    if (path) {
      sessionStorage.removeItem("ocap_return_to");
    }
    return path;
  }

  consumeAuthToken(params: URLSearchParams): boolean {
    const token = params.get("auth_token");
    if (!token) return false;
    setAuthToken(token);
    return true;
  }

  async getMe(): Promise<AuthState> {
    const response = await fetch(`${this.baseUrl}/api/v1/auth/me`, {
      headers: authHeaders(),
      cache: "no-cache",
    });
    if (!response.ok) {
      return { authenticated: false };
    }
    return response.json() as Promise<AuthState>;
  }

  async logout(): Promise<void> {
    await fetch(`${this.baseUrl}/api/v1/auth/logout`, {
      method: "POST",
      headers: authHeaders(),
    });
    setAuthToken(null);
  }

  // ─── Admin recording methods ───

  async editRecording(
    id: string,
    data: { missionName?: string; tag?: string; date?: string },
  ): Promise<Recording> {
    const response = await fetch(
      `${this.baseUrl}/api/v1/operations/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(data),
      },
    );
    if (!response.ok) {
      throw new ApiError(
        `Edit failed: ${response.status} ${response.statusText}`,
        response.status,
        response.statusText,
      );
    }
    const raw = (await response.json()) as RawRecording;
    return mapRecording(raw);
  }

  async deleteRecording(id: string): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/api/v1/operations/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        headers: authHeaders(),
      },
    );
    if (!response.ok) {
      throw new ApiError(
        `Delete failed: ${response.status} ${response.statusText}`,
        response.status,
        response.statusText,
      );
    }
  }

  async retryConversion(id: string): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/api/v1/operations/${encodeURIComponent(id)}/retry`,
      {
        method: "POST",
        headers: authHeaders(),
      },
    );
    if (!response.ok) {
      throw new ApiError(
        `Retry failed: ${response.status} ${response.statusText}`,
        response.status,
        response.statusText,
      );
    }
  }

  async uploadRecording(formData: FormData): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/v1/operations/add`, {
      method: "POST",
      headers: authHeaders(),
      body: formData,
    });
    if (!response.ok) {
      throw new ApiError(
        `Upload failed: ${response.status} ${response.statusText}`,
        response.status,
        response.statusText,
      );
    }
  }

  // ─── Marker blacklist methods ───

  async getMarkerBlacklist(operationId: string): Promise<number[]> {
    return this.fetchJson<number[]>(
      `${this.baseUrl}/api/v1/operations/${encodeURIComponent(operationId)}/marker-blacklist`,
    );
  }

  async addMarkerBlacklist(
    operationId: string,
    playerEntityId: number,
  ): Promise<void> {
    return this.fetchBlacklistUpdate(operationId, playerEntityId, "PUT");
  }

  async removeMarkerBlacklist(
    operationId: string,
    playerEntityId: number,
  ): Promise<void> {
    return this.fetchBlacklistUpdate(operationId, playerEntityId, "DELETE");
  }

  private async fetchBlacklistUpdate(
    operationId: string,
    playerEntityId: number,
    method: "PUT" | "DELETE",
  ): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/api/v1/operations/${encodeURIComponent(operationId)}/marker-blacklist/${playerEntityId}`,
      {
        method,
        headers: authHeaders(),
      },
    );
    if (!response.ok) {
      const action = method === "PUT" ? "Add" : "Remove";
      throw new ApiError(
        `${action} blacklist failed: ${response.status} ${response.statusText}`,
        response.status,
        response.statusText,
      );
    }
  }

  // ─── Internal fetch helpers ───

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url, { cache: "no-cache" });
    if (!response.ok) {
      throw new ApiError(
        `GET ${url} failed: ${response.status} ${response.statusText}`,
        response.status,
        response.statusText,
      );
    }
    return response.json() as Promise<T>;
  }

  private async fetchBuffer(url: string): Promise<ArrayBuffer> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new ApiError(
        `GET ${url} failed: ${response.status} ${response.statusText}`,
        response.status,
        response.statusText,
      );
    }
    return response.arrayBuffer();
  }
}
