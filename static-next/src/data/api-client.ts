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
}

function mapOperation(raw: RawOperation): Operation {
  return {
    id: String(raw.id),
    worldName: raw.world_name,
    missionName: raw.mission_name,
    missionDuration: raw.mission_duration,
    date: raw.date,
    tag: raw.tag,
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
   * @param baseUrl - Base URL prefix for all API calls (default: "/aar/").
   *   A trailing slash is normalised internally.
   */
  constructor(baseUrl = "/aar/") {
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
   * Fetch raw mission data (gzipped JSON streamed by the server).
   * GET {baseUrl}/data/{filename}
   */
  async getMissionData(filename: string): Promise<ArrayBuffer> {
    const url = `${this.baseUrl}/data/${encodeURIComponent(filename)}`;
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
   * Fetch per-world map configuration.
   * GET {baseUrl}/images/maps/{worldName}/map.json
   */
  async getWorldConfig(worldName: string): Promise<WorldConfig> {
    const url = `${this.baseUrl}/images/maps/${encodeURIComponent(worldName)}/map.json`;
    return this.fetchJson<WorldConfig>(url);
  }

  /**
   * Fetch a manifest as raw bytes.
   * GET {baseUrl}/api/v1/operations/{missionId}/manifest
   */
  async getManifest(missionId: string): Promise<ArrayBuffer> {
    const url = `${this.baseUrl}/api/v1/operations/${encodeURIComponent(missionId)}/manifest`;
    return this.fetchBuffer(url);
  }

  /**
   * Fetch a chunk as raw bytes.
   * GET {baseUrl}/api/v1/operations/{missionId}/chunk/{chunkIndex}
   */
  async getChunk(
    missionId: string,
    chunkIndex: number,
  ): Promise<ArrayBuffer> {
    const url = `${this.baseUrl}/api/v1/operations/${encodeURIComponent(missionId)}/chunk/${chunkIndex}`;
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
