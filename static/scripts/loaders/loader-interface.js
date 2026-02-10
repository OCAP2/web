/**
 * Loader Interface - Base class for versioned loaders
 *
 * Loaders handle decoding of manifest and chunk data for a specific schema version.
 * The binary data may include a 4-byte version prefix that identifies the schema version.
 */

/**
 * @typedef {Object} LoaderInterface
 * @property {function(ArrayBuffer): Object} decodeManifest - Decode manifest from binary data
 * @property {function(ArrayBuffer): Object} decodeChunk - Decode chunk from binary data
 * @property {function(): number} getVersion - Get the schema version this loader handles
 */

/**
 * Version prefix size in bytes (4-byte little-endian uint32)
 */
const VERSION_PREFIX_SIZE = 4;

/**
 * Read the version prefix from binary data.
 * The version prefix is a 4-byte little-endian uint32 at the start of the data.
 *
 * @param {ArrayBuffer} buffer - The binary data
 * @returns {number|null} The version number, or null if no version prefix detected
 */
function readVersionPrefix(buffer) {
    if (buffer.byteLength < VERSION_PREFIX_SIZE) {
        return null;
    }

    const view = new DataView(buffer);

    // Check if this looks like a version prefix.
    // Version prefix is 4 bytes little-endian. For small version numbers (1-255),
    // bytes 2, 3, 4 will be zero: [version, 0x00, 0x00, 0x00]
    //
    // Legacy protobuf files start with a field tag. Common first bytes:
    // - 0x08 (field 1, varint)
    // - 0x0A (field 1, length-delimited)
    //
    const byte0 = view.getUint8(0);
    const byte1 = view.getUint8(1);
    const byte2 = view.getUint8(2);
    const byte3 = view.getUint8(3);

    // For protobuf: check if bytes 2-4 are all zero (indicates version prefix)
    const hasVersionPrefix = byte0 < 16 && byte1 === 0 && byte2 === 0 && byte3 === 0;

    if (!hasVersionPrefix) {
        return null; // Legacy file without version prefix
    }

    // Read the version (little-endian uint32)
    return view.getUint32(0, true);
}

/**
 * Strip the version prefix from binary data if present.
 *
 * @param {ArrayBuffer} buffer - The binary data
 * @returns {ArrayBuffer} The data without version prefix
 */
function stripVersionPrefix(buffer) {
    const version = readVersionPrefix(buffer);
    if (version === null || version === 0) {
        return buffer; // No version prefix or version 0 (legacy)
    }
    return buffer.slice(VERSION_PREFIX_SIZE);
}

// Export for use in browser
if (typeof window !== 'undefined') {
    window.LoaderUtils = {
        VERSION_PREFIX_SIZE,
        readVersionPrefix,
        stripVersionPrefix
    };
}
