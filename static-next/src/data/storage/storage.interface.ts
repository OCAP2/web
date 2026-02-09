export interface StorageBackend {
  hasManifest(missionId: string, format: string): Promise<boolean>;
  getManifest(missionId: string, format: string): Promise<ArrayBuffer | null>;
  saveManifest(
    missionId: string,
    format: string,
    data: ArrayBuffer,
  ): Promise<void>;
  hasChunk(missionId: string, chunkIndex: number): Promise<boolean>;
  getChunk(
    missionId: string,
    chunkIndex: number,
  ): Promise<ArrayBuffer | null>;
  saveChunk(
    missionId: string,
    chunkIndex: number,
    data: ArrayBuffer,
  ): Promise<void>;
  evictOldChunks(maxBytes: number): Promise<void>;
  getStorageUsage(): Promise<{ used: number; available: number }>;
}
