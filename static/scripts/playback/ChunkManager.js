/**
 * ChunkManager - Manages on-demand chunk loading for playback
 *
 * Handles loading chunks from network/cache, LRU eviction,
 * and prefetching for smooth playback.
 */

class ChunkManager {
    /**
     * @param {string} missionId - The mission identifier
     * @param {Object} manifest - The decoded manifest object
     * @param {StorageManager} storageManager - Storage backend
     * @param {string} baseUrl - Base URL for chunk fetching
     * @param {Object} options - Configuration options
     * @param {string} options.format - Storage format ('protobuf' or 'flatbuffers')
     * @param {boolean} options.enableBrowserCache - Enable browser storage caching (default: false)
     */
    constructor(missionId, manifest, storageManager, baseUrl, options = {}) {
        this._missionId = missionId;
        this._manifest = manifest;
        this._storage = storageManager;
        this._baseUrl = baseUrl;
        this._format = options.format || 'protobuf';
        this._enableBrowserCache = options.enableBrowserCache || false;

        // Chunk cache with LRU eviction (max 3 in memory)
        this._maxChunksInMemory = 3;
        this._loadedChunks = new Map(); // chunkIndex -> decoded chunk data
        this._chunkAccessOrder = []; // LRU tracking

        // Loading state
        this._loadingChunks = new Map(); // chunkIndex -> Promise

        // Prefetch settings
        this._prefetchThreshold = 0.8; // Prefetch next chunk at 80% progress
        this._prefetchingChunk = null;

        // Stats
        this._cacheHits = 0;
        this._networkFetches = 0;
    }

    /**
     * Get the chunk index for a given frame number
     * @param {number} frameNum
     * @returns {number}
     */
    getChunkIndex(frameNum) {
        const chunkSize = this._manifest.chunkSize || 300;
        return Math.floor(frameNum / chunkSize);
    }

    /**
     * Ensure the chunk containing the frame is loaded
     * @param {number} frameNum
     * @returns {Promise<void>}
     */
    async ensureLoaded(frameNum) {
        const chunkIndex = this.getChunkIndex(frameNum);
        await this.loadChunk(chunkIndex);

        // Check if we should prefetch the next chunk
        this._checkPrefetch(frameNum, chunkIndex);
    }

    /**
     * Load a specific chunk (from cache or network)
     * @param {number} chunkIndex
     * @returns {Promise<Object>} The decoded chunk data
     */
    async loadChunk(chunkIndex) {
        // Already loaded in memory?
        if (this._loadedChunks.has(chunkIndex)) {
            this._updateAccessOrder(chunkIndex);
            return this._loadedChunks.get(chunkIndex);
        }

        // Already loading?
        if (this._loadingChunks.has(chunkIndex)) {
            return this._loadingChunks.get(chunkIndex);
        }

        // Start loading
        const loadPromise = this._loadChunkInternal(chunkIndex);
        this._loadingChunks.set(chunkIndex, loadPromise);

        try {
            const chunk = await loadPromise;
            this._loadingChunks.delete(chunkIndex);
            return chunk;
        } catch (e) {
            this._loadingChunks.delete(chunkIndex);
            throw e;
        }
    }

    /**
     * Internal chunk loading logic
     * @private
     */
    async _loadChunkInternal(chunkIndex) {
        // Try storage cache first (if enabled)
        if (this._enableBrowserCache) {
            const cached = await this._storage.getChunk(this._missionId, chunkIndex, this._format);
            if (cached) {
                this._cacheHits++;
                const chunk = await this._decodeChunk(cached);
                this._storeInMemory(chunkIndex, chunk);
                return chunk;
            }
        }

        // Fetch from network
        this._networkFetches++;
        const url = `${this._baseUrl}/api/v1/operations/${this._missionId}/chunk/${chunkIndex}`;
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Failed to fetch chunk ${chunkIndex}: ${response.status}`);
        }

        const data = await response.arrayBuffer();

        // Save to storage cache (async, don't wait) - only if enabled
        if (this._enableBrowserCache) {
            this._storage.saveChunk(this._missionId, chunkIndex, data, this._format).catch(e => {
                console.warn('Failed to cache chunk:', e);
            });
        }

        const chunk = await this._decodeChunk(data);
        this._storeInMemory(chunkIndex, chunk);
        return chunk;
    }

    /**
     * Decode chunk data based on format
     * @param {ArrayBuffer} data
     * @returns {Promise<Object>}
     * @private
     */
    async _decodeChunk(data) {
        if (this._format === 'flatbuffers') {
            if (typeof FlatBuffersDecoder !== 'undefined') {
                return FlatBuffersDecoder.decodeChunk(data);
            }
            console.warn('FlatBuffersDecoder not available');
        } else {
            // Default to protobuf
            if (typeof ProtobufDecoder !== 'undefined') {
                return ProtobufDecoder.decodeChunk(data);
            }
            console.warn('ProtobufDecoder not available');
        }

        // Fallback: return raw data if decoder not available
        console.warn('No decoder available, returning raw data');
        return { raw: data };
    }

    /**
     * Store chunk in memory with LRU eviction
     * @private
     */
    _storeInMemory(chunkIndex, chunk) {
        // Evict if at capacity
        while (this._loadedChunks.size >= this._maxChunksInMemory) {
            const oldest = this._chunkAccessOrder.shift();
            if (oldest !== undefined && oldest !== chunkIndex) {
                this._loadedChunks.delete(oldest);
            }
        }

        this._loadedChunks.set(chunkIndex, chunk);
        this._updateAccessOrder(chunkIndex);
    }

    /**
     * Update LRU access order
     * @private
     */
    _updateAccessOrder(chunkIndex) {
        const idx = this._chunkAccessOrder.indexOf(chunkIndex);
        if (idx > -1) {
            this._chunkAccessOrder.splice(idx, 1);
        }
        this._chunkAccessOrder.push(chunkIndex);
    }

    /**
     * Check if we should prefetch the next chunk
     * @private
     */
    _checkPrefetch(frameNum, currentChunkIndex) {
        const chunkSize = this._manifest.chunkSize || 300;
        const chunkStartFrame = currentChunkIndex * chunkSize;
        const positionInChunk = frameNum - chunkStartFrame;
        const progress = positionInChunk / chunkSize;

        const nextChunkIndex = currentChunkIndex + 1;

        // Prefetch at threshold if next chunk exists and not already loaded/loading
        if (progress >= this._prefetchThreshold &&
            nextChunkIndex < this._manifest.chunkCount &&
            !this._loadedChunks.has(nextChunkIndex) &&
            !this._loadingChunks.has(nextChunkIndex) &&
            this._prefetchingChunk !== nextChunkIndex) {

            this._prefetchingChunk = nextChunkIndex;
            this.loadChunk(nextChunkIndex).then(() => {
                this._prefetchingChunk = null;
            }).catch(e => {
                console.warn('Prefetch failed:', e);
                this._prefetchingChunk = null;
            });
        }
    }

    /**
     * Prefetch a specific chunk (for seeking)
     * @param {number} chunkIndex
     * @returns {Promise<void>}
     */
    async prefetch(chunkIndex) {
        if (chunkIndex < 0 || chunkIndex >= this._manifest.chunkCount) return;
        if (this._loadedChunks.has(chunkIndex) || this._loadingChunks.has(chunkIndex)) return;

        await this.loadChunk(chunkIndex);
    }

    /**
     * Get frame data for a specific frame
     * @param {number} frameNum
     * @returns {Object|null} Frame data or null if not loaded
     */
    getFrameData(frameNum) {
        const chunkIndex = this.getChunkIndex(frameNum);
        const chunk = this._loadedChunks.get(chunkIndex);

        if (!chunk || !chunk.frames) return null;

        const chunkSize = this._manifest.chunkSize || 300;
        const chunkStartFrame = chunkIndex * chunkSize;
        const frameIndexInChunk = frameNum - chunkStartFrame;

        return chunk.frames[frameIndexInChunk] || null;
    }

    /**
     * Check if the chunk for a frame is currently loading
     * @param {number} frameNum
     * @returns {boolean}
     */
    isChunkLoading(frameNum) {
        const chunkIndex = this.getChunkIndex(frameNum);
        return this._loadingChunks.has(chunkIndex);
    }

    /**
     * Check if the chunk for a frame is loaded
     * @param {number} frameNum
     * @returns {boolean}
     */
    isChunkLoaded(frameNum) {
        const chunkIndex = this.getChunkIndex(frameNum);
        return this._loadedChunks.has(chunkIndex);
    }

    /**
     * Get entity state from a frame
     * @param {number} frameNum
     * @param {number} entityId
     * @returns {Object|null}
     */
    getEntityState(frameNum, entityId) {
        const frame = this.getFrameData(frameNum);
        if (!frame || !frame.entities) return null;

        return frame.entities.find(e => e.entityId === entityId) || null;
    }

    /**
     * Check if a frame is currently available in memory
     * @param {number} frameNum
     * @returns {boolean}
     */
    isFrameLoaded(frameNum) {
        const chunkIndex = this.getChunkIndex(frameNum);
        return this._loadedChunks.has(chunkIndex);
    }

    /**
     * Clear all loaded chunks
     */
    clear() {
        this._loadedChunks.clear();
        this._chunkAccessOrder = [];
        this._loadingChunks.clear();
        this._prefetchingChunk = null;
    }

    /**
     * Get statistics
     * @returns {Object}
     */
    getStats() {
        return {
            loadedChunks: this._loadedChunks.size,
            cacheHits: this._cacheHits,
            networkFetches: this._networkFetches,
            hitRate: this._cacheHits / (this._cacheHits + this._networkFetches) || 0,
            browserCacheEnabled: this._enableBrowserCache
        };
    }

    /**
     * Get manifest information
     * @returns {Object}
     */
    getManifest() {
        return this._manifest;
    }
}

// Export for use
if (typeof window !== 'undefined') {
    window.ChunkManager = ChunkManager;
}
