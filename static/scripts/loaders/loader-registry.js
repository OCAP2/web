/**
 * LoaderRegistry - Registry of versioned loaders
 *
 * Provides access to loaders by schema version.
 * Falls back to the latest known loader version if an exact match isn't found.
 */

const LoaderRegistry = (function() {
    // Registry of loaders by version
    const loaders = new Map();

    /**
     * Register a loader for a specific version
     * @param {number} version - Schema version
     * @param {Object} loader - Loader object with decodeManifest and decodeChunk methods
     */
    function register(version, loader) {
        loaders.set(version, loader);
    }

    /**
     * Get loader for a specific version
     * @param {number} version - Schema version
     * @returns {Object} Loader object
     * @throws {Error} If no loader is registered for the version
     */
    function getLoader(version) {
        if (loaders.has(version)) {
            return loaders.get(version);
        }

        // Fallback: try to find the closest lower version
        const versions = Array.from(loaders.keys()).sort((a, b) => b - a);
        const fallback = versions.find(v => v <= version);

        if (fallback !== undefined) {
            console.warn(`No loader for schema version ${version}, falling back to version ${fallback}`);
            return loaders.get(fallback);
        }

        throw new Error(`No loader registered for schema version ${version}`);
    }

    /**
     * Check if a loader is registered for a version
     * @param {number} version - Schema version
     * @returns {boolean}
     */
    function hasLoader(version) {
        return loaders.has(version);
    }

    /**
     * Get all registered versions
     * @returns {number[]}
     */
    function getVersions() {
        return Array.from(loaders.keys()).sort((a, b) => a - b);
    }

    /**
     * Get the latest registered version
     * @returns {number}
     */
    function getLatestVersion() {
        const versions = getVersions();
        return versions.length > 0 ? versions[versions.length - 1] : 0;
    }

    // Public API
    return {
        register,
        getLoader,
        hasLoader,
        getVersions,
        getLatestVersion
    };
})();

// Register built-in loaders
if (typeof LoaderV1 !== 'undefined') {
    LoaderRegistry.register(1, LoaderV1);
}

// Export for use in browser
if (typeof window !== 'undefined') {
    window.LoaderRegistry = LoaderRegistry;
}
