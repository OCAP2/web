/**
 * FlatBuffers Decoder for OCAP recordings
 *
 * This is a minimal FlatBuffers reader specifically for the OCAP schema.
 * It reads the binary format directly without needing the full FlatBuffers library.
 */

// FlatBuffers binary format reader
class FlatBufferReader {
    constructor(buffer) {
        this.buffer = buffer;
        this.view = new DataView(buffer);
        this.pos = 0;
    }

    // Read root table offset
    getRootOffset() {
        return this.view.getUint32(0, true);
    }

    // Read a value from vtable
    getFieldOffset(tableOffset, fieldIndex) {
        const vtableOffset = tableOffset - this.view.getInt32(tableOffset, true);
        const vtableSize = this.view.getUint16(vtableOffset, true);
        const fieldOffsetPos = vtableOffset + 4 + fieldIndex * 2;

        if (fieldOffsetPos >= vtableOffset + vtableSize) {
            return 0; // Field not present
        }

        return this.view.getUint16(fieldOffsetPos, true);
    }

    // Read scalar types
    readUint8(offset) {
        return this.view.getUint8(offset);
    }

    readUint16(offset) {
        return this.view.getUint16(offset, true);
    }

    readUint32(offset) {
        return this.view.getUint32(offset, true);
    }

    readInt32(offset) {
        return this.view.getInt32(offset, true);
    }

    readFloat32(offset) {
        return this.view.getFloat32(offset, true);
    }

    readBool(offset) {
        return this.view.getUint8(offset) !== 0;
    }

    // Read string
    readString(offset) {
        const strOffset = offset + this.view.getUint32(offset, true);
        const length = this.view.getUint32(strOffset, true);
        const bytes = new Uint8Array(this.buffer, strOffset + 4, length);
        return new TextDecoder().decode(bytes);
    }

    // Read vector length
    readVectorLength(offset) {
        const vecOffset = offset + this.view.getUint32(offset, true);
        return this.view.getUint32(vecOffset, true);
    }

    // Get vector element offset
    getVectorElementOffset(offset, index) {
        const vecOffset = offset + this.view.getUint32(offset, true);
        return vecOffset + 4 + index * 4;
    }

    // Read table from vector
    readTableFromVector(offset, index) {
        const vecOffset = offset + this.view.getUint32(offset, true);
        const elemOffset = vecOffset + 4 + index * 4;
        return elemOffset + this.view.getUint32(elemOffset, true);
    }

    // Read uint32 vector
    readUint32Vector(offset) {
        const vecOffset = offset + this.view.getUint32(offset, true);
        const length = this.view.getUint32(vecOffset, true);
        const result = [];
        for (let i = 0; i < length; i++) {
            result.push(this.view.getUint32(vecOffset + 4 + i * 4, true));
        }
        return result;
    }
}

/**
 * FlatBuffers Decoder for OCAP format
 */
const FlatBuffersDecoder = {
    // Entity type enum
    EntityType: {
        UNKNOWN: 0,
        UNIT: 1,
        VEHICLE: 2
    },

    // Side enum
    Side: {
        UNKNOWN: 0,
        WEST: 1,
        EAST: 2,
        GUER: 3,
        CIV: 4,
        GLOBAL: 5
    },

    entityTypeToString(type) {
        switch (type) {
            case this.EntityType.UNIT: return 'unit';
            case this.EntityType.VEHICLE: return 'vehicle';
            default: return 'unknown';
        }
    },

    sideToString(side) {
        switch (side) {
            case this.Side.WEST: return 'WEST';
            case this.Side.EAST: return 'EAST';
            case this.Side.GUER: return 'GUER';
            case this.Side.CIV: return 'CIV';
            case this.Side.GLOBAL: return 'GLOBAL';
            default: return 'UNKNOWN';
        }
    },

    /**
     * Decode a FlatBuffers manifest
     * @param {ArrayBuffer} buffer - Binary data
     * @returns {Object} Decoded manifest
     */
    decodeManifest(buffer) {
        const reader = new FlatBufferReader(buffer);
        const rootOffset = reader.getRootOffset();

        const manifest = {
            version: 0,
            worldName: '',
            missionName: '',
            frameCount: 0,
            chunkSize: 0,
            captureDelayMs: 0,
            chunkCount: 0,
            entities: [],
            events: [],
            times: [],
            markers: [],
            extensionVersion: '',
            addonVersion: ''
        };

        // Field indices for Manifest table (matching schema order in ocap.fbs)
        // 0: version, 1: world_name, 2: mission_name, 3: frame_count,
        // 4: chunk_size, 5: capture_delay_ms, 6: chunk_count, 7: entities, 8: times, 9: events, 10: markers

        let fieldOffset = reader.getFieldOffset(rootOffset, 0);
        if (fieldOffset) manifest.version = reader.readUint32(rootOffset + fieldOffset);

        fieldOffset = reader.getFieldOffset(rootOffset, 1);
        if (fieldOffset) manifest.worldName = reader.readString(rootOffset + fieldOffset);

        fieldOffset = reader.getFieldOffset(rootOffset, 2);
        if (fieldOffset) manifest.missionName = reader.readString(rootOffset + fieldOffset);

        fieldOffset = reader.getFieldOffset(rootOffset, 3);
        if (fieldOffset) manifest.frameCount = reader.readUint32(rootOffset + fieldOffset);

        fieldOffset = reader.getFieldOffset(rootOffset, 4);
        if (fieldOffset) manifest.chunkSize = reader.readUint32(rootOffset + fieldOffset);

        fieldOffset = reader.getFieldOffset(rootOffset, 5);
        if (fieldOffset) manifest.captureDelayMs = reader.readUint32(rootOffset + fieldOffset);

        fieldOffset = reader.getFieldOffset(rootOffset, 6);
        if (fieldOffset) manifest.chunkCount = reader.readUint32(rootOffset + fieldOffset);

        // Read entities vector (index 7)
        fieldOffset = reader.getFieldOffset(rootOffset, 7);
        if (fieldOffset) {
            const vecOffset = rootOffset + fieldOffset;
            const count = reader.readVectorLength(vecOffset);
            for (let i = 0; i < count; i++) {
                manifest.entities.push(this.decodeEntityDef(reader, reader.readTableFromVector(vecOffset, i)));
            }
        }

        // Read times vector (index 8)
        fieldOffset = reader.getFieldOffset(rootOffset, 8);
        if (fieldOffset) {
            const vecOffset = rootOffset + fieldOffset;
            const count = reader.readVectorLength(vecOffset);
            for (let i = 0; i < count; i++) {
                manifest.times.push(this.decodeTimeSample(reader, reader.readTableFromVector(vecOffset, i)));
            }
        }

        // Read events vector (index 9)
        fieldOffset = reader.getFieldOffset(rootOffset, 9);
        if (fieldOffset) {
            const vecOffset = rootOffset + fieldOffset;
            const count = reader.readVectorLength(vecOffset);
            for (let i = 0; i < count; i++) {
                manifest.events.push(this.decodeEvent(reader, reader.readTableFromVector(vecOffset, i)));
            }
        }

        // Read extension_version (index 11)
        fieldOffset = reader.getFieldOffset(rootOffset, 11);
        if (fieldOffset) manifest.extensionVersion = reader.readString(rootOffset + fieldOffset);

        // Read addon_version (index 12)
        fieldOffset = reader.getFieldOffset(rootOffset, 12);
        if (fieldOffset) manifest.addonVersion = reader.readString(rootOffset + fieldOffset);

        return manifest;
    },

    decodeEntityDef(reader, tableOffset) {
        const entity = {
            id: 0,
            type: 'unknown',
            name: '',
            side: 'UNKNOWN',
            groupName: '',
            role: '',
            startFrame: 0,
            endFrame: 0,
            isPlayer: false,
            vehicleClass: ''
        };

        // Field indices: 0:id, 1:type, 2:name, 3:side, 4:group_name, 5:role,
        // 6:start_frame, 7:end_frame, 8:is_player, 9:vehicle_class

        let fieldOffset = reader.getFieldOffset(tableOffset, 0);
        if (fieldOffset) entity.id = reader.readUint32(tableOffset + fieldOffset);

        fieldOffset = reader.getFieldOffset(tableOffset, 1);
        if (fieldOffset) entity.type = this.entityTypeToString(reader.readUint8(tableOffset + fieldOffset));

        fieldOffset = reader.getFieldOffset(tableOffset, 2);
        if (fieldOffset) entity.name = reader.readString(tableOffset + fieldOffset);

        fieldOffset = reader.getFieldOffset(tableOffset, 3);
        if (fieldOffset) entity.side = this.sideToString(reader.readUint8(tableOffset + fieldOffset));

        fieldOffset = reader.getFieldOffset(tableOffset, 4);
        if (fieldOffset) entity.groupName = reader.readString(tableOffset + fieldOffset);

        fieldOffset = reader.getFieldOffset(tableOffset, 5);
        if (fieldOffset) entity.role = reader.readString(tableOffset + fieldOffset);

        fieldOffset = reader.getFieldOffset(tableOffset, 6);
        if (fieldOffset) entity.startFrame = reader.readUint32(tableOffset + fieldOffset);

        fieldOffset = reader.getFieldOffset(tableOffset, 7);
        if (fieldOffset) entity.endFrame = reader.readUint32(tableOffset + fieldOffset);

        fieldOffset = reader.getFieldOffset(tableOffset, 8);
        if (fieldOffset) entity.isPlayer = reader.readBool(tableOffset + fieldOffset);

        fieldOffset = reader.getFieldOffset(tableOffset, 9);
        if (fieldOffset) entity.vehicleClass = reader.readString(tableOffset + fieldOffset);

        return entity;
    },

    decodeEvent(reader, tableOffset) {
        const event = {
            frameNum: 0,
            type: '',
            sourceId: 0,
            targetId: 0,
            message: '',
            distance: 0,
            weapon: ''
        };

        let fieldOffset = reader.getFieldOffset(tableOffset, 0);
        if (fieldOffset) event.frameNum = reader.readUint32(tableOffset + fieldOffset);

        fieldOffset = reader.getFieldOffset(tableOffset, 1);
        if (fieldOffset) event.type = reader.readString(tableOffset + fieldOffset);

        fieldOffset = reader.getFieldOffset(tableOffset, 2);
        if (fieldOffset) event.sourceId = reader.readUint32(tableOffset + fieldOffset);

        fieldOffset = reader.getFieldOffset(tableOffset, 3);
        if (fieldOffset) event.targetId = reader.readUint32(tableOffset + fieldOffset);

        fieldOffset = reader.getFieldOffset(tableOffset, 4);
        if (fieldOffset) event.message = reader.readString(tableOffset + fieldOffset);

        fieldOffset = reader.getFieldOffset(tableOffset, 5);
        if (fieldOffset) event.distance = reader.readFloat32(tableOffset + fieldOffset);

        fieldOffset = reader.getFieldOffset(tableOffset, 6);
        if (fieldOffset) event.weapon = reader.readString(tableOffset + fieldOffset);

        return event;
    },

    decodeTimeSample(reader, tableOffset) {
        const sample = {
            frameNum: 0,
            systemTimeUtc: '',
            date: '',
            timeMultiplier: 1.0,
            time: 0
        };

        let fieldOffset = reader.getFieldOffset(tableOffset, 0);
        if (fieldOffset) sample.frameNum = reader.readUint32(tableOffset + fieldOffset);

        fieldOffset = reader.getFieldOffset(tableOffset, 1);
        if (fieldOffset) sample.systemTimeUtc = reader.readString(tableOffset + fieldOffset);

        fieldOffset = reader.getFieldOffset(tableOffset, 2);
        if (fieldOffset) sample.date = reader.readString(tableOffset + fieldOffset);

        fieldOffset = reader.getFieldOffset(tableOffset, 3);
        if (fieldOffset) sample.timeMultiplier = reader.readFloat32(tableOffset + fieldOffset);

        fieldOffset = reader.getFieldOffset(tableOffset, 4);
        if (fieldOffset) sample.time = reader.readFloat32(tableOffset + fieldOffset);

        return sample;
    },

    /**
     * Decode a FlatBuffers chunk
     * @param {ArrayBuffer} buffer - Binary data
     * @returns {Object} Decoded chunk
     */
    decodeChunk(buffer) {
        const reader = new FlatBufferReader(buffer);
        const rootOffset = reader.getRootOffset();

        const chunk = {
            index: 0,
            startFrame: 0,
            frameCount: 0,
            frames: []
        };

        // Field indices: 0:index, 1:start_frame, 2:frame_count, 3:frames

        let fieldOffset = reader.getFieldOffset(rootOffset, 0);
        if (fieldOffset) chunk.index = reader.readUint32(rootOffset + fieldOffset);

        fieldOffset = reader.getFieldOffset(rootOffset, 1);
        if (fieldOffset) chunk.startFrame = reader.readUint32(rootOffset + fieldOffset);

        fieldOffset = reader.getFieldOffset(rootOffset, 2);
        if (fieldOffset) chunk.frameCount = reader.readUint32(rootOffset + fieldOffset);

        // Read frames vector
        fieldOffset = reader.getFieldOffset(rootOffset, 3);
        if (fieldOffset) {
            const vecOffset = rootOffset + fieldOffset;
            const count = reader.readVectorLength(vecOffset);
            for (let i = 0; i < count; i++) {
                chunk.frames.push(this.decodeFrame(reader, reader.readTableFromVector(vecOffset, i)));
            }
        }

        return chunk;
    },

    decodeFrame(reader, tableOffset) {
        const frame = {
            frameNum: 0,
            entities: []
        };

        let fieldOffset = reader.getFieldOffset(tableOffset, 0);
        if (fieldOffset) frame.frameNum = reader.readUint32(tableOffset + fieldOffset);

        // Read entities vector
        fieldOffset = reader.getFieldOffset(tableOffset, 1);
        if (fieldOffset) {
            const vecOffset = tableOffset + fieldOffset;
            const count = reader.readVectorLength(vecOffset);
            for (let i = 0; i < count; i++) {
                frame.entities.push(this.decodeEntityState(reader, reader.readTableFromVector(vecOffset, i)));
            }
        }

        return frame;
    },

    decodeEntityState(reader, tableOffset) {
        const state = {
            entityId: 0,
            posX: 0,
            posY: 0,
            direction: 0,
            alive: 0,
            crewIds: [],
            vehicleId: 0,
            isInVehicle: false,
            name: '',
            isPlayer: false
        };

        // Field indices: 0:entity_id, 1:pos_x, 2:pos_y, 3:direction, 4:alive,
        // 5:crew_ids, 6:vehicle_id, 7:is_in_vehicle, 8:name, 9:is_player

        let fieldOffset = reader.getFieldOffset(tableOffset, 0);
        if (fieldOffset) state.entityId = reader.readUint32(tableOffset + fieldOffset);

        fieldOffset = reader.getFieldOffset(tableOffset, 1);
        if (fieldOffset) state.posX = reader.readFloat32(tableOffset + fieldOffset);

        fieldOffset = reader.getFieldOffset(tableOffset, 2);
        if (fieldOffset) state.posY = reader.readFloat32(tableOffset + fieldOffset);

        fieldOffset = reader.getFieldOffset(tableOffset, 3);
        if (fieldOffset) state.direction = reader.readUint32(tableOffset + fieldOffset);

        fieldOffset = reader.getFieldOffset(tableOffset, 4);
        if (fieldOffset) state.alive = reader.readUint32(tableOffset + fieldOffset);

        fieldOffset = reader.getFieldOffset(tableOffset, 5);
        if (fieldOffset) state.crewIds = reader.readUint32Vector(tableOffset + fieldOffset);

        fieldOffset = reader.getFieldOffset(tableOffset, 6);
        if (fieldOffset) state.vehicleId = reader.readUint32(tableOffset + fieldOffset);

        fieldOffset = reader.getFieldOffset(tableOffset, 7);
        if (fieldOffset) state.isInVehicle = reader.readBool(tableOffset + fieldOffset);

        fieldOffset = reader.getFieldOffset(tableOffset, 8);
        if (fieldOffset) state.name = reader.readString(tableOffset + fieldOffset);

        fieldOffset = reader.getFieldOffset(tableOffset, 9);
        if (fieldOffset) state.isPlayer = reader.readBool(tableOffset + fieldOffset);

        return state;
    }
};

// Make available globally
if (typeof window !== 'undefined') {
    window.FlatBuffersDecoder = FlatBuffersDecoder;
}
