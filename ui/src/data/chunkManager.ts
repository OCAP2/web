import type { ChunkData, EventDef, Manifest } from "./types";
import type { DecoderStrategy } from "./decoders/decoder.interface";
import type { ApiClient } from "./apiClient";

// ─── Options & callbacks ───

export interface ChunkManagerCallbacks {
  onChunkLoaded?: (chunkIndex: number) => void;
  onChunkEvicted?: (chunkIndex: number) => void;
}

// ─── ChunkManager ───

/**
 * Manages on-demand chunk loading for streaming playback.
 *
 * Handles loading chunks from network, LRU eviction,
 * and prefetching for smooth playback.
 */
export class ChunkManager {
  private readonly decoder: DecoderStrategy;
  private readonly api: ApiClient;

  /** Max decoded chunks kept in memory. */
  private readonly maxChunksInMemory = 3;

  /** chunkIndex -> decoded chunk data. */
  private readonly loadedChunks = new Map<number, ChunkData>();

  /** LRU access order (oldest first). */
  private chunkAccessOrder: number[] = [];

  /** chunkIndex -> in-flight load promise (dedup concurrent requests). */
  private readonly loadingChunks = new Map<number, Promise<ChunkData>>();

  /** Prefetch settings. */
  private readonly prefetchThreshold = 0.8;
  private prefetchingChunk: number | null = null;

  /** Mission state (set after loadManifest). */
  private manifest: Manifest | null = null;
  private filename: string | null = null;

  /** Optional callbacks. */
  private callbacks: ChunkManagerCallbacks = {};

  /** unitId -> in-flight or settled player-snapshot fetch (loaded at most once). */
  private readonly playerSnapshots = new Map<number, Promise<EventDef[]>>();

  constructor(decoder: DecoderStrategy, api: ApiClient) {
    this.decoder = decoder;
    this.api = api;
  }

  // ─── Callbacks ───

  setCallbacks(cbs: ChunkManagerCallbacks): void {
    this.callbacks = cbs;
  }

  // ─── Public API ───

  /**
   * Fetch and decode the manifest for a mission.
   * Must be called before any chunk operations.
   */
  async loadManifest(filename: string): Promise<Manifest> {
    this.filename = filename;

    const buffer = await this.api.getManifest(filename);
    this.manifest = this.decoder.decodeManifest(buffer);
    return this.manifest;
  }

  /**
   * Load a specific chunk (from cache or network).
   */
  async loadChunk(chunkIndex: number): Promise<ChunkData> {
    // Already in memory?
    if (this.loadedChunks.has(chunkIndex)) {
      this.updateAccessOrder(chunkIndex);
      return this.loadedChunks.get(chunkIndex)!;
    }

    // Already loading? (dedup)
    const inFlight = this.loadingChunks.get(chunkIndex);
    if (inFlight) {
      return inFlight;
    }

    // Start loading
    const loadPromise = this.loadChunkInternal(chunkIndex);
    this.loadingChunks.set(chunkIndex, loadPromise);

    try {
      const chunk = await loadPromise;
      this.loadingChunks.delete(chunkIndex);
      return chunk;
    } catch (e) {
      this.loadingChunks.delete(chunkIndex);
      throw e;
    }
  }

  /**
   * Ensure the chunk containing the given frame is loaded.
   * Also triggers prefetch of the next chunk at 80% progress.
   */
  async ensureLoaded(frame: number): Promise<void> {
    this.requireManifest();
    const chunkIndex = this.getChunkIndex(frame);
    await this.loadChunk(chunkIndex);
    this.checkPrefetch(frame, chunkIndex);
  }

  /**
   * Get the decoded chunk containing the given frame, or null if not in memory.
   */
  getChunkForFrame(frame: number): ChunkData | null {
    this.requireManifest();
    const chunkIndex = this.getChunkIndex(frame);
    return this.loadedChunks.get(chunkIndex) ?? null;
  }

  /**
   * Load one player's snapshot sidecar. Snapshots are the bulk of a recording's
   * event stream. Profiles load one unit at a time; the transmission overlay
   * and Comms tab load all radio owners. Each unit is fetched at most once.
   *
   * Returns an empty list for a unit the manifest does not index — either the
   * player has no snapshots, or this is a recording whose snapshots are still
   * in the manifest and therefore already loaded.
   */
  async loadPlayerSnapshots(unitId: number): Promise<EventDef[]> {
    this.requireManifest();
    if (!this.manifest!.snapshotUnitIds?.includes(unitId)) return [];

    const inFlight = this.playerSnapshots.get(unitId);
    if (inFlight) return inFlight;

    const filename = this.filename!;
    const loadPromise = this.api
      .getPlayerSnapshots(filename, unitId)
      .then((buffer) => this.decoder.decodePlayerSnapshots(buffer));

    // Cache the promise, not the result, so concurrent opens share one request.
    // A failed fetch is forgotten so reopening the card retries it.
    this.playerSnapshots.set(unitId, loadPromise);
    loadPromise.catch(() => this.playerSnapshots.delete(unitId));
    return loadPromise;
  }

  /**
   * Clear all loaded chunks and reset state.
   */
  clear(): void {
    this.loadedChunks.clear();
    this.chunkAccessOrder = [];
    this.loadingChunks.clear();
    this.playerSnapshots.clear();
    this.prefetchingChunk = null;
    this.manifest = null;
    this.filename = null;
  }

  /**
   * Get the currently loaded manifest.
   */
  getManifest(): Manifest | null {
    return this.manifest;
  }

  // ─── Internals ───

  private getChunkIndex(frame: number): number {
    const chunkSize = this.manifest!.chunkSize || 300;
    return Math.floor(frame / chunkSize);
  }

  private async loadChunkInternal(chunkIndex: number): Promise<ChunkData> {
    const filename = this.filename!;

    const buffer = await this.api.getChunk(filename, chunkIndex);
    const chunk = this.decoder.decodeChunk(buffer);
    this.storeInMemory(chunkIndex, chunk);
    return chunk;
  }

  private storeInMemory(chunkIndex: number, chunk: ChunkData): void {
    // Evict if at capacity
    while (this.loadedChunks.size >= this.maxChunksInMemory) {
      const oldest = this.chunkAccessOrder.shift();
      if (oldest !== undefined && oldest !== chunkIndex) {
        this.loadedChunks.delete(oldest);
        this.callbacks.onChunkEvicted?.(oldest);
      }
    }

    this.loadedChunks.set(chunkIndex, chunk);
    this.updateAccessOrder(chunkIndex);
    this.callbacks.onChunkLoaded?.(chunkIndex);
  }

  private updateAccessOrder(chunkIndex: number): void {
    const idx = this.chunkAccessOrder.indexOf(chunkIndex);
    if (idx > -1) {
      this.chunkAccessOrder.splice(idx, 1);
    }
    this.chunkAccessOrder.push(chunkIndex);
  }

  private checkPrefetch(frame: number, currentChunkIndex: number): void {
    const manifest = this.manifest!;
    const chunkSize = manifest.chunkSize || 300;
    const chunkStartFrame = currentChunkIndex * chunkSize;
    const positionInChunk = frame - chunkStartFrame;
    const progress = positionInChunk / chunkSize;

    const nextChunkIndex = currentChunkIndex + 1;

    if (
      progress >= this.prefetchThreshold &&
      nextChunkIndex < manifest.chunkCount &&
      !this.loadedChunks.has(nextChunkIndex) &&
      !this.loadingChunks.has(nextChunkIndex) &&
      this.prefetchingChunk !== nextChunkIndex
    ) {
      this.prefetchingChunk = nextChunkIndex;
      this.loadChunk(nextChunkIndex)
        .then(() => {
          this.prefetchingChunk = null;
        })
        .catch(() => {
          this.prefetchingChunk = null;
        });
    }
  }

  private requireManifest(): void {
    if (!this.manifest) {
      throw new Error(
        "ChunkManager: manifest not loaded. Call loadManifest() first.",
      );
    }
  }
}
