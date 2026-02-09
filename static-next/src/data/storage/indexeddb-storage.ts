import type { StorageBackend } from "./storage.interface";

const DB_NAME = "ocap_storage";
const DB_VERSION = 1;
const STORE_DATA = "data";
const STORE_META = "meta";

/**
 * IndexedDB Storage Backend - fallback for browsers without OPFS.
 *
 * Uses a single object store keyed by a composite string:
 *   manifest  -> "{missionId}/manifest-{format}"
 *   chunk     -> "{missionId}/chunk-{N}"
 *
 * A separate "meta" store tracks per-mission access times for LRU eviction.
 */
export class IndexedDBStorage implements StorageBackend {
  private _db: IDBDatabase | null = null;

  /** Feature-detect IndexedDB. */
  static isSupported(): boolean {
    return typeof indexedDB !== "undefined";
  }

  /** Open (or create) the database. */
  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this._db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_DATA)) {
          db.createObjectStore(STORE_DATA);
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META);
        }
      };
    });
  }

  // ─── Manifest ────────────────────────────────────────────

  async hasManifest(missionId: string, format: string): Promise<boolean> {
    const key = this._manifestKey(missionId, format);
    const result = await this._get(STORE_DATA, key);
    return result !== undefined;
  }

  async getManifest(
    missionId: string,
    format: string,
  ): Promise<ArrayBuffer | null> {
    const key = this._manifestKey(missionId, format);
    const result = await this._get(STORE_DATA, key);
    if (result !== undefined) {
      await this._touch(missionId);
      return result as ArrayBuffer;
    }
    return null;
  }

  async saveManifest(
    missionId: string,
    format: string,
    data: ArrayBuffer,
  ): Promise<void> {
    const key = this._manifestKey(missionId, format);
    await this._put(STORE_DATA, key, data);
    await this._touch(missionId);
  }

  // ─── Chunks ──────────────────────────────────────────────

  async hasChunk(missionId: string, chunkIndex: number): Promise<boolean> {
    const key = this._chunkKey(missionId, chunkIndex);
    const result = await this._get(STORE_DATA, key);
    return result !== undefined;
  }

  async getChunk(
    missionId: string,
    chunkIndex: number,
  ): Promise<ArrayBuffer | null> {
    const key = this._chunkKey(missionId, chunkIndex);
    const result = await this._get(STORE_DATA, key);
    if (result !== undefined) {
      await this._touch(missionId);
      return result as ArrayBuffer;
    }
    return null;
  }

  async saveChunk(
    missionId: string,
    chunkIndex: number,
    data: ArrayBuffer,
  ): Promise<void> {
    const key = this._chunkKey(missionId, chunkIndex);
    await this._put(STORE_DATA, key, data);
    await this._touch(missionId);
  }

  // ─── Eviction ────────────────────────────────────────────

  async evictOldChunks(maxBytes: number): Promise<void> {
    const usage = await this.getStorageUsage();
    if (usage.used <= maxBytes) return;

    // Get all mission access times, sorted oldest first
    const allMeta = await this._getAllKeys(STORE_META);
    const entries: Array<{ missionId: string; time: number }> = [];
    for (const missionId of allMeta) {
      const time = (await this._get(STORE_META, missionId)) as
        | number
        | undefined;
      if (time !== undefined) {
        entries.push({ missionId, time });
      }
    }
    entries.sort((a, b) => a.time - b.time);

    for (const { missionId } of entries) {
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

  private _manifestKey(missionId: string, format: string): string {
    return `${missionId}/manifest-${format}`;
  }

  private _chunkKey(missionId: string, chunkIndex: number): string {
    return `${missionId}/chunk-${chunkIndex}`;
  }

  private async _touch(missionId: string): Promise<void> {
    await this._put(STORE_META, missionId, Date.now());
  }

  private async _removeMission(missionId: string): Promise<void> {
    // Remove all data keys that start with this missionId prefix
    const allKeys = await this._getAllKeys(STORE_DATA);
    const prefix = `${missionId}/`;
    for (const key of allKeys) {
      if (key.startsWith(prefix)) {
        await this._delete(STORE_DATA, key);
      }
    }
    await this._delete(STORE_META, missionId);
  }

  // ─── Low-level IDB helpers ───────────────────────────────

  private _get(storeName: string, key: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const tx = this._db!.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private _put(storeName: string, key: string, value: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this._db!.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const request = store.put(value, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  private _delete(storeName: string, key: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this._db!.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  private _getAllKeys(storeName: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const tx = this._db!.transaction(storeName, "readonly");
      const store = tx.objectStore(storeName);
      const request = store.getAllKeys();
      request.onsuccess = () => resolve(request.result as string[]);
      request.onerror = () => reject(request.error);
    });
  }
}
