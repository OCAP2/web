import type { StorageBackend } from "./storage.interface";

/**
 * OPFS Storage Backend - Uses Origin Private File System.
 *
 * File layout:
 *   /{missionId}/manifest-{format}
 *   /{missionId}/chunk-{N}
 *
 * Access times are tracked in-memory and periodically persisted to
 * `/_access_times.json` for LRU eviction.
 */
export class OPFSStorage implements StorageBackend {
  private _root: FileSystemDirectoryHandle | null = null;
  private _accessTimes = new Map<string, number>();
  private _writeCounter = 0;

  /** Feature-detect OPFS support. */
  static async isSupported(): Promise<boolean> {
    try {
      if (
        typeof navigator === "undefined" ||
        !navigator.storage ||
        !navigator.storage.getDirectory
      ) {
        return false;
      }
      await navigator.storage.getDirectory();
      return true;
    } catch {
      return false;
    }
  }

  /** Initialise the backend by acquiring the OPFS root and loading persisted access times. */
  async init(): Promise<void> {
    this._root = await navigator.storage.getDirectory();
    await this._loadAccessTimes();
  }

  // ─── Manifest ────────────────────────────────────────────

  async hasManifest(missionId: string, format: string): Promise<boolean> {
    try {
      const dir = await this._getMissionDir(missionId, false);
      if (!dir) return false;
      await dir.getFileHandle(this._manifestName(format));
      return true;
    } catch {
      return false;
    }
  }

  async getManifest(
    missionId: string,
    format: string,
  ): Promise<ArrayBuffer | null> {
    try {
      const dir = await this._getMissionDir(missionId, false);
      if (!dir) return null;
      const handle = await dir.getFileHandle(this._manifestName(format));
      const file = await handle.getFile();
      await this._touch(missionId);
      return file.arrayBuffer();
    } catch {
      return null;
    }
  }

  async saveManifest(
    missionId: string,
    format: string,
    data: ArrayBuffer,
  ): Promise<void> {
    const dir = await this._getMissionDir(missionId, true);
    const handle = await dir!.getFileHandle(this._manifestName(format), {
      create: true,
    });
    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();
    await this._touch(missionId);
  }

  // ─── Chunks ──────────────────────────────────────────────

  async hasChunk(missionId: string, chunkIndex: number): Promise<boolean> {
    try {
      const dir = await this._getMissionDir(missionId, false);
      if (!dir) return false;
      await dir.getFileHandle(this._chunkName(chunkIndex));
      return true;
    } catch {
      return false;
    }
  }

  async getChunk(
    missionId: string,
    chunkIndex: number,
  ): Promise<ArrayBuffer | null> {
    try {
      const dir = await this._getMissionDir(missionId, false);
      if (!dir) return null;
      const handle = await dir.getFileHandle(this._chunkName(chunkIndex));
      const file = await handle.getFile();
      await this._touch(missionId);
      return file.arrayBuffer();
    } catch {
      return null;
    }
  }

  async saveChunk(
    missionId: string,
    chunkIndex: number,
    data: ArrayBuffer,
  ): Promise<void> {
    const dir = await this._getMissionDir(missionId, true);
    const handle = await dir!.getFileHandle(this._chunkName(chunkIndex), {
      create: true,
    });
    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();
    await this._touch(missionId);
  }

  // ─── Eviction ────────────────────────────────────────────

  async evictOldChunks(maxBytes: number): Promise<void> {
    const usage = await this.getStorageUsage();
    if (usage.used <= maxBytes) return;

    // Build per-mission max access time
    const missionLastAccess = new Map<string, number>();
    for (const [key, time] of this._accessTimes) {
      const existing = missionLastAccess.get(key);
      if (existing === undefined || time > existing) {
        missionLastAccess.set(key, time);
      }
    }

    // Sort oldest-first
    const sorted = [...missionLastAccess.entries()].sort(
      (a, b) => a[1] - b[1],
    );

    for (const [missionId] of sorted) {
      await this._removeMission(missionId);
      const newUsage = await this.getStorageUsage();
      if (newUsage.used <= maxBytes) break;
    }
  }

  // ─── Usage ───────────────────────────────────────────────

  async getStorageUsage(): Promise<{ used: number; available: number }> {
    if (
      typeof navigator !== "undefined" &&
      navigator.storage &&
      navigator.storage.estimate
    ) {
      const estimate = await navigator.storage.estimate();
      return {
        used: estimate.usage ?? 0,
        available: (estimate.quota ?? 0) - (estimate.usage ?? 0),
      };
    }
    return { used: 0, available: 0 };
  }

  // ─── Internals ───────────────────────────────────────────

  private _manifestName(format: string): string {
    return `manifest-${format}`;
  }

  private _chunkName(index: number): string {
    return `chunk-${index}`;
  }

  private async _getMissionDir(
    missionId: string,
    create: boolean,
  ): Promise<FileSystemDirectoryHandle | null> {
    try {
      return await this._root!.getDirectoryHandle(missionId, { create });
    } catch {
      if (!create) return null;
      throw new Error(`Failed to create directory for mission ${missionId}`);
    }
  }

  private async _removeMission(missionId: string): Promise<void> {
    try {
      await this._root!.removeEntry(missionId, { recursive: true });
      this._accessTimes.delete(missionId);
      await this._persistAccessTimes();
    } catch {
      // Directory may not exist
    }
  }

  /** Update the access timestamp for a mission and periodically persist. */
  private async _touch(missionId: string): Promise<void> {
    this._accessTimes.set(missionId, Date.now());
    this._writeCounter++;
    if (this._writeCounter % 10 === 0) {
      await this._persistAccessTimes();
    }
  }

  private async _loadAccessTimes(): Promise<void> {
    try {
      const handle = await this._root!.getFileHandle("_access_times.json");
      const file = await handle.getFile();
      const text = await file.text();
      const data = JSON.parse(text) as Record<string, number>;
      this._accessTimes = new Map(Object.entries(data));
    } catch {
      // File doesn't exist yet
    }
  }

  private async _persistAccessTimes(): Promise<void> {
    try {
      const handle = await this._root!.getFileHandle("_access_times.json", {
        create: true,
      });
      const writable = await handle.createWritable();
      await writable.write(JSON.stringify(Object.fromEntries(this._accessTimes)));
      await writable.close();
    } catch {
      // Best-effort
    }
  }
}
