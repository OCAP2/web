/**
 * LoaderV1 - Schema version 1 loader
 *
 * Handles decoding of manifest and chunk data for schema version 1.
 * Wraps the existing ProtobufDecoder with version prefix handling.
 */

const LoaderV1 = (function() {
    const SCHEMA_VERSION = 1;

    /**
     * Get the schema version this loader handles
     * @returns {number}
     */
    function getVersion() {
        return SCHEMA_VERSION;
    }

    /**
     * Decode manifest from binary data
     *
     * @param {ArrayBuffer} buffer - Raw binary manifest data (may include version prefix)
     * @returns {Object} Decoded manifest
     */
    function decodeManifest(buffer) {
        // Strip version prefix if present
        const data = LoaderUtils.stripVersionPrefix(buffer);
        return ProtobufDecoder.decodeManifest(data);
    }

    /**
     * Decode chunk from binary data
     *
     * @param {ArrayBuffer} buffer - Raw binary chunk data (may include version prefix)
     * @returns {Object} Decoded chunk
     */
    function decodeChunk(buffer) {
        // Strip version prefix if present
        const data = LoaderUtils.stripVersionPrefix(buffer);
        return ProtobufDecoder.decodeChunk(data);
    }

    // Public API
    return {
        getVersion,
        decodeManifest,
        decodeChunk
    };
})();

// Export for use in browser
if (typeof window !== 'undefined') {
    window.LoaderV1 = LoaderV1;
}
