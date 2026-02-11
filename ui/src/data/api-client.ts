import type { Operation, WorldConfig } from "./types";

// ─── Response types for endpoints not covered in types.ts ───

export interface CustomizeConfig {
  websiteURL?: string;
  websiteLogo?: string;
  websiteLogoSize?: string;
  disableKillCount?: boolean;
}

export interface BuildInfo {
  BuildVersion: string;
  BuildCommit: string;
  BuildDate: string;
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

interface RawOperation {
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
}

function mapOperation(raw: RawOperation): Operation {
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
  };
}

// ─── Query filter parameters for operations endpoint ───

export interface OperationFilters {
  tag?: string;
  name?: string;
  newer?: string;
  older?: string;
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
   * Fetch the list of operations, optionally filtered.
   * GET {baseUrl}/api/v1/operations
   */
  async getOperations(filters?: OperationFilters): Promise<Operation[]> {
    const params = new URLSearchParams();
    if (filters?.tag) params.set("tag", filters.tag);
    if (filters?.name) params.set("name", filters.name);
    if (filters?.newer) params.set("newer", filters.newer);
    if (filters?.older) params.set("older", filters.older);

    const qs = params.toString();
    const url = `${this.baseUrl}/api/v1/operations${qs ? `?${qs}` : ""}`;
    const data = await this.fetchJson<RawOperation[]>(url);
    return data.map(mapOperation);
  }

  /**
   * Fetch raw mission data (gzipped JSON served as a static file).
   * GET {baseUrl}/data/{filename}.json.gz
   */
  async getMissionData(filename: string): Promise<ArrayBuffer> {
    const url = `${this.baseUrl}/data/${encodeURIComponent(filename)}.json.gz`;
    return this.fetchBuffer(url);
  }

  /**
   * Fetch UI customization config.
   * GET {baseUrl}/api/v1/customize
   */
  async getCustomize(): Promise<CustomizeConfig> {
    return this.fetchJson<CustomizeConfig>(
      `${this.baseUrl}/api/v1/customize`,
    );
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
