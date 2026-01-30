/**
 * StorageManager - Browser-side storage layer for chunked recordings
 *
 * Provides OPFS (Origin Private File System) as primary storage with
 * IndexedDB as fallback for browsers without OPFS support.
 */

class StorageManager {
    constructor() {
        this._backend = null;
        this._initialized = false;
    }

    /**
     * Initialize the storage backend
     * @returns {Promise<void>}
     */
    async init() {
        if (this._initialized) return;

        // Try OPFS first (Chrome, Edge, Firefox 111+)
        if (await OPFSStorage.isSupported()) {
            this._backend = new OPFSStorage();
            console.log('StorageManager: Using OPFS backend');
        } else {
            // Fallback to IndexedDB
            this._backend = new IndexedDBStorage();
            console.log('StorageManager: Using IndexedDB backend (OPFS not supported)');
        }

        await this._backend.init();
        this._initialized = true;
    }

    /**
     * Check if manifest exists for a mission
     * @param {string} missionId
     * @param {string} format - Storage format ('protobuf' or 'flatbuffers')
     * @returns {Promise<boolean>}
     */
    async hasManifest(missionId, format = 'protobuf') {
        await this._ensureInitialized();
        return this._backend.hasManifest(missionId, format);
    }

    /**
     * Get manifest for a mission
     * @param {string} missionId
     * @param {string} format - Storage format ('protobuf' or 'flatbuffers')
     * @returns {Promise<ArrayBuffer|null>}
     */
    async getManifest(missionId, format = 'protobuf') {
        await this._ensureInitialized();
        return this._backend.getManifest(missionId, format);
    }

    /**
     * Save manifest for a mission
     * @param {string} missionId
     * @param {ArrayBuffer} data
     * @param {string} format - Storage format ('protobuf' or 'flatbuffers')
     * @returns {Promise<void>}
     */
    async saveManifest(missionId, data, format = 'protobuf') {
        await this._ensureInitialized();
        return this._backend.saveManifest(missionId, data, format);
    }

    /**
     * Check if chunk exists
     * @param {string} missionId
     * @param {number} chunkIndex
     * @param {string} format - Storage format ('protobuf' or 'flatbuffers')
     * @returns {Promise<boolean>}
     */
    async hasChunk(missionId, chunkIndex, format = 'protobuf') {
        await this._ensureInitialized();
        return this._backend.hasChunk(missionId, chunkIndex, format);
    }

    /**
     * Get chunk data
     * @param {string} missionId
     * @param {number} chunkIndex
     * @param {string} format - Storage format ('protobuf' or 'flatbuffers')
     * @returns {Promise<ArrayBuffer|null>}
     */
    async getChunk(missionId, chunkIndex, format = 'protobuf') {
        await this._ensureInitialized();
        return this._backend.getChunk(missionId, chunkIndex, format);
    }

    /**
     * Save chunk data
     * @param {string} missionId
     * @param {number} chunkIndex
     * @param {ArrayBuffer} data
     * @param {string} format - Storage format ('protobuf' or 'flatbuffers')
     * @returns {Promise<void>}
     */
    async saveChunk(missionId, chunkIndex, data, format = 'protobuf') {
        await this._ensureInitialized();
        return this._backend.saveChunk(missionId, chunkIndex, data, format);
    }

    /**
     * Evict old chunks based on LRU policy
     * @param {number} maxBytes - Maximum storage to keep
     * @returns {Promise<void>}
     */
    async evictOldChunks(maxBytes = 500 * 1024 * 1024) {
        await this._ensureInitialized();
        return this._backend.evictOldChunks(maxBytes);
    }

    /**
     * Clear all data for a mission
     * @param {string} missionId
     * @returns {Promise<void>}
     */
    async clearMission(missionId) {
        await this._ensureInitialized();
        return this._backend.clearMission(missionId);
    }

    /**
     * Get total storage usage
     * @returns {Promise<{used: number, quota: number}>}
     */
    async getStorageUsage() {
        await this._ensureInitialized();
        return this._backend.getStorageUsage();
    }

    /**
     * Get the name of the current storage backend
     * @returns {string}
     */
    getBackendName() {
        return this._backend?.constructor.name || 'Not initialized';
    }

    async _ensureInitialized() {
        if (!this._initialized) {
            await this.init();
        }
    }
}

/**
 * OPFS Storage Backend - Uses Origin Private File System
 * Provides fast, synchronous-like access to file storage
 */
class OPFSStorage {
    constructor() {
        this._root = null;
        this._accessTimes = new Map(); // Track access times for LRU
    }

    static async isSupported() {
        try {
            if (!navigator.storage || !navigator.storage.getDirectory) {
                return false;
            }
            // Try to actually get the root
            await navigator.storage.getDirectory();
            return true;
        } catch (e) {
            return false;
        }
    }

    async init() {
        this._root = await navigator.storage.getDirectory();
        await this._loadAccessTimes();
    }

    async hasManifest(missionId, format = 'protobuf') {
        try {
            const missionDir = await this._getMissionDir(missionId, false);
            if (!missionDir) return false;
            const filename = format === 'flatbuffers' ? 'manifest.fb' : 'manifest.pb';
            await missionDir.getFileHandle(filename);
            return true;
        } catch (e) {
            return false;
        }
    }

    async getManifest(missionId, format = 'protobuf') {
        try {
            const missionDir = await this._getMissionDir(missionId, false);
            if (!missionDir) return null;
            const filename = format === 'flatbuffers' ? 'manifest.fb' : 'manifest.pb';
            const fileHandle = await missionDir.getFileHandle(filename);
            const file = await fileHandle.getFile();
            await this._updateAccessTime(missionId, 'manifest');
            return file.arrayBuffer();
        } catch (e) {
            return null;
        }
    }

    async saveManifest(missionId, data, format = 'protobuf') {
        const missionDir = await this._getMissionDir(missionId, true);
        const filename = format === 'flatbuffers' ? 'manifest.fb' : 'manifest.pb';
        const fileHandle = await missionDir.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(data);
        await writable.close();
        await this._updateAccessTime(missionId, 'manifest');
    }

    async hasChunk(missionId, chunkIndex, format = 'protobuf') {
        try {
            const chunksDir = await this._getChunksDir(missionId, false);
            if (!chunksDir) return false;
            await chunksDir.getFileHandle(this._chunkFileName(chunkIndex, format));
            return true;
        } catch (e) {
            return false;
        }
    }

    async getChunk(missionId, chunkIndex, format = 'protobuf') {
        try {
            const chunksDir = await this._getChunksDir(missionId, false);
            if (!chunksDir) return null;
            const fileHandle = await chunksDir.getFileHandle(this._chunkFileName(chunkIndex, format));
            const file = await fileHandle.getFile();
            await this._updateAccessTime(missionId, `chunk_${chunkIndex}`);
            return file.arrayBuffer();
        } catch (e) {
            return null;
        }
    }

    async saveChunk(missionId, chunkIndex, data, format = 'protobuf') {
        const chunksDir = await this._getChunksDir(missionId, true);
        const fileHandle = await chunksDir.getFileHandle(this._chunkFileName(chunkIndex, format), { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(data);
        await writable.close();
        await this._updateAccessTime(missionId, `chunk_${chunkIndex}`);
    }

    async evictOldChunks(maxBytes) {
        const usage = await this.getStorageUsage();
        if (usage.used <= maxBytes) return;

        // Sort missions by last access time
        const missions = [];
        for (const [key, time] of this._accessTimes) {
            const [missionId] = key.split(':');
            if (!missions.some(m => m.id === missionId)) {
                missions.push({ id: missionId, lastAccess: time });
            } else {
                const mission = missions.find(m => m.id === missionId);
                if (time > mission.lastAccess) {
                    mission.lastAccess = time;
                }
            }
        }
        missions.sort((a, b) => a.lastAccess - b.lastAccess);

        // Delete oldest missions until under quota
        for (const mission of missions) {
            await this.clearMission(mission.id);
            const newUsage = await this.getStorageUsage();
            if (newUsage.used <= maxBytes) break;
        }
    }

    async clearMission(missionId) {
        try {
            await this._root.removeEntry(missionId, { recursive: true });
            // Clean up access times
            for (const key of this._accessTimes.keys()) {
                if (key.startsWith(missionId + ':')) {
                    this._accessTimes.delete(key);
                }
            }
            await this._saveAccessTimes();
        } catch (e) {
            // Ignore if doesn't exist
        }
    }

    async getStorageUsage() {
        if (navigator.storage && navigator.storage.estimate) {
            const estimate = await navigator.storage.estimate();
            return {
                used: estimate.usage || 0,
                quota: estimate.quota || 0
            };
        }
        return { used: 0, quota: 0 };
    }

    async _getMissionDir(missionId, create = false) {
        try {
            return await this._root.getDirectoryHandle(missionId, { create });
        } catch (e) {
            if (!create) return null;
            throw e;
        }
    }

    async _getChunksDir(missionId, create = false) {
        const missionDir = await this._getMissionDir(missionId, create);
        if (!missionDir) return null;
        try {
            return await missionDir.getDirectoryHandle('chunks', { create });
        } catch (e) {
            if (!create) return null;
            throw e;
        }
    }

    _chunkFileName(index, format = 'protobuf') {
        const ext = format === 'flatbuffers' ? '.fb' : '.pb';
        return String(index).padStart(4, '0') + ext;
    }

    async _updateAccessTime(missionId, item) {
        this._accessTimes.set(`${missionId}:${item}`, Date.now());
        // Save periodically (not on every update for performance)
        if (Math.random() < 0.1) {
            await this._saveAccessTimes();
        }
    }

    async _loadAccessTimes() {
        try {
            const fileHandle = await this._root.getFileHandle('_access_times.json');
            const file = await fileHandle.getFile();
            const text = await file.text();
            const data = JSON.parse(text);
            this._accessTimes = new Map(Object.entries(data));
        } catch (e) {
            // File doesn't exist yet
        }
    }

    async _saveAccessTimes() {
        try {
            const fileHandle = await this._root.getFileHandle('_access_times.json', { create: true });
            const writable = await fileHandle.createWritable();
            const data = Object.fromEntries(this._accessTimes);
            await writable.write(JSON.stringify(data));
            await writable.close();
        } catch (e) {
            console.warn('Failed to save access times:', e);
        }
    }
}

/**
 * IndexedDB Storage Backend - Fallback for browsers without OPFS
 */
class IndexedDBStorage {
    constructor() {
        this._db = null;
        this._dbName = 'ocap_storage';
        this._version = 1;
    }

    static async isSupported() {
        return typeof indexedDB !== 'undefined';
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this._dbName, this._version);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this._db = request.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Manifests store
                if (!db.objectStoreNames.contains('manifests')) {
                    db.createObjectStore('manifests', { keyPath: 'missionId' });
                }

                // Chunks store
                if (!db.objectStoreNames.contains('chunks')) {
                    const chunksStore = db.createObjectStore('chunks', { keyPath: 'id' });
                    chunksStore.createIndex('missionId', 'missionId', { unique: false });
                }

                // Access times store
                if (!db.objectStoreNames.contains('accessTimes')) {
                    const accessStore = db.createObjectStore('accessTimes', { keyPath: 'id' });
                    accessStore.createIndex('time', 'time', { unique: false });
                }
            };
        });
    }

    async hasManifest(missionId, format = 'protobuf') {
        const key = `${missionId}:${format}`;
        return new Promise((resolve) => {
            const tx = this._db.transaction('manifests', 'readonly');
            const store = tx.objectStore('manifests');
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result !== undefined);
            request.onerror = () => resolve(false);
        });
    }

    async getManifest(missionId, format = 'protobuf') {
        const key = `${missionId}:${format}`;
        const record = await this._getRecord('manifests', key);
        if (record) {
            await this._updateAccessTime(missionId, 'manifest');
            return record.data;
        }
        return null;
    }

    async saveManifest(missionId, data, format = 'protobuf') {
        const key = `${missionId}:${format}`;
        await this._putRecord('manifests', { missionId: key, data });
        await this._updateAccessTime(missionId, 'manifest');
    }

    async hasChunk(missionId, chunkIndex, format = 'protobuf') {
        const id = this._chunkId(missionId, chunkIndex, format);
        return new Promise((resolve) => {
            const tx = this._db.transaction('chunks', 'readonly');
            const store = tx.objectStore('chunks');
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result !== undefined);
            request.onerror = () => resolve(false);
        });
    }

    async getChunk(missionId, chunkIndex, format = 'protobuf') {
        const id = this._chunkId(missionId, chunkIndex, format);
        const record = await this._getRecord('chunks', id);
        if (record) {
            await this._updateAccessTime(missionId, `chunk_${chunkIndex}`);
            return record.data;
        }
        return null;
    }

    async saveChunk(missionId, chunkIndex, data, format = 'protobuf') {
        const id = this._chunkId(missionId, chunkIndex, format);
        await this._putRecord('chunks', { id, missionId, chunkIndex, data });
        await this._updateAccessTime(missionId, `chunk_${chunkIndex}`);
    }

    async evictOldChunks(maxBytes) {
        const usage = await this.getStorageUsage();
        if (usage.used <= maxBytes) return;

        // Get all access times sorted by time (oldest first)
        const accessTimes = await this._getAllRecords('accessTimes');
        accessTimes.sort((a, b) => a.time - b.time);

        // Group by mission
        const missionTimes = new Map();
        for (const record of accessTimes) {
            const missionId = record.id.split(':')[0];
            if (!missionTimes.has(missionId) || record.time > missionTimes.get(missionId)) {
                missionTimes.set(missionId, record.time);
            }
        }

        // Sort missions by last access time
        const missions = Array.from(missionTimes.entries())
            .sort((a, b) => a[1] - b[1])
            .map(([id]) => id);

        // Delete oldest missions
        for (const missionId of missions) {
            await this.clearMission(missionId);
            const newUsage = await this.getStorageUsage();
            if (newUsage.used <= maxBytes) break;
        }
    }

    async clearMission(missionId) {
        // Delete manifest
        await this._deleteRecord('manifests', missionId);

        // Delete chunks
        const chunks = await this._getRecordsByIndex('chunks', 'missionId', missionId);
        for (const chunk of chunks) {
            await this._deleteRecord('chunks', chunk.id);
        }

        // Delete access times
        const accessTimes = await this._getAllRecords('accessTimes');
        for (const record of accessTimes) {
            if (record.id.startsWith(missionId + ':')) {
                await this._deleteRecord('accessTimes', record.id);
            }
        }
    }

    async getStorageUsage() {
        if (navigator.storage && navigator.storage.estimate) {
            const estimate = await navigator.storage.estimate();
            return {
                used: estimate.usage || 0,
                quota: estimate.quota || 0
            };
        }
        return { used: 0, quota: 0 };
    }

    _chunkId(missionId, chunkIndex, format = 'protobuf') {
        const ext = format === 'flatbuffers' ? 'fb' : 'pb';
        return `${missionId}:${String(chunkIndex).padStart(4, '0')}:${ext}`;
    }

    async _updateAccessTime(missionId, item) {
        const id = `${missionId}:${item}`;
        await this._putRecord('accessTimes', { id, time: Date.now() });
    }

    _getRecord(storeName, key) {
        return new Promise((resolve, reject) => {
            const tx = this._db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    _putRecord(storeName, record) {
        return new Promise((resolve, reject) => {
            const tx = this._db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.put(record);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    _deleteRecord(storeName, key) {
        return new Promise((resolve, reject) => {
            const tx = this._db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.delete(key);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    _getAllRecords(storeName) {
        return new Promise((resolve, reject) => {
            const tx = this._db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    _getRecordsByIndex(storeName, indexName, value) {
        return new Promise((resolve, reject) => {
            const tx = this._db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const index = store.index(indexName);
            const request = index.getAll(value);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
}

// Export for use
if (typeof window !== 'undefined') {
    window.StorageManager = StorageManager;
}
