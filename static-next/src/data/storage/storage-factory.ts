import type { StorageBackend } from "./storage.interface";
import { OPFSStorage } from "./opfs-storage";
import { IndexedDBStorage } from "./indexeddb-storage";

/**
 * Create the best available StorageBackend.
 * Tries OPFS first, then falls back to IndexedDB.
 */
export async function createStorage(): Promise<StorageBackend> {
  if (await OPFSStorage.isSupported()) {
    const backend = new OPFSStorage();
    await backend.init();
    return backend;
  }

  if (IndexedDBStorage.isSupported()) {
    const backend = new IndexedDBStorage();
    await backend.init();
    return backend;
  }

  throw new Error(
    "No supported storage backend available (need OPFS or IndexedDB)",
  );
}
