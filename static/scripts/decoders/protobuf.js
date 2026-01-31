/**
 * ProtobufDecoder - Lightweight protobuf decoder for OCAP messages
 *
 * Decodes binary protobuf data matching the ocap.proto schema.
 * No build step required - pure JavaScript implementation.
 */

const ProtobufDecoder = (function() {
    // Wire types
    const WIRE_VARINT = 0;
    const WIRE_64BIT = 1;
    const WIRE_LENGTH_DELIMITED = 2;
    const WIRE_32BIT = 5;

    // Entity types
    const EntityType = {
        0: 'unknown',
        1: 'unit',
        2: 'vehicle'
    };

    // Sides
    const Side = {
        0: 'UNKNOWN',
        1: 'WEST',
        2: 'EAST',
        3: 'GUER',
        4: 'CIV',
        5: 'GLOBAL'
    };

    /**
     * Reader class for parsing protobuf binary data
     */
    class Reader {
        constructor(buffer) {
            this.view = new DataView(buffer);
            this.pos = 0;
            this.len = buffer.byteLength;
        }

        readVarint() {
            let result = 0;
            let shift = 0;
            let byte;
            do {
                if (this.pos >= this.len) throw new Error('Buffer overflow');
                byte = this.view.getUint8(this.pos++);
                result |= (byte & 0x7f) << shift;
                shift += 7;
            } while (byte & 0x80);
            return result >>> 0; // Ensure unsigned
        }

        readSignedVarint() {
            const value = this.readVarint();
            return (value >>> 1) ^ -(value & 1); // ZigZag decode
        }

        readFixed32() {
            if (this.pos + 4 > this.len) throw new Error('Buffer overflow');
            const value = this.view.getUint32(this.pos, true);
            this.pos += 4;
            return value;
        }

        readFixed64() {
            // JavaScript doesn't have native 64-bit integers, read as two 32-bit
            const low = this.readFixed32();
            const high = this.readFixed32();
            return low + high * 0x100000000;
        }

        readFloat() {
            if (this.pos + 4 > this.len) throw new Error('Buffer overflow');
            const value = this.view.getFloat32(this.pos, true);
            this.pos += 4;
            return value;
        }

        readDouble() {
            if (this.pos + 8 > this.len) throw new Error('Buffer overflow');
            const value = this.view.getFloat64(this.pos, true);
            this.pos += 8;
            return value;
        }

        readBytes(length) {
            if (this.pos + length > this.len) throw new Error('Buffer overflow');
            const bytes = new Uint8Array(this.view.buffer, this.pos, length);
            this.pos += length;
            return bytes;
        }

        readString() {
            const length = this.readVarint();
            const bytes = this.readBytes(length);
            return new TextDecoder().decode(bytes);
        }

        readTag() {
            if (this.pos >= this.len) return null;
            const tag = this.readVarint();
            return {
                fieldNumber: tag >>> 3,
                wireType: tag & 0x7
            };
        }

        skip(wireType) {
            switch (wireType) {
                case WIRE_VARINT:
                    this.readVarint();
                    break;
                case WIRE_64BIT:
                    this.pos += 8;
                    break;
                case WIRE_LENGTH_DELIMITED:
                    const len = this.readVarint();
                    this.pos += len;
                    break;
                case WIRE_32BIT:
                    this.pos += 4;
                    break;
                default:
                    throw new Error(`Unknown wire type: ${wireType}`);
            }
        }
    }

    /**
     * Decode Manifest message
     */
    function decodeManifest(buffer) {
        const reader = new Reader(buffer);
        const manifest = {
            version: 0,
            worldName: '',
            missionName: '',
            frameCount: 0,
            chunkSize: 300,
            captureDelayMs: 1000,
            chunkCount: 0,
            entities: [],
            times: [],
            events: [],
            markers: [],
            extensionVersion: '',
            addonVersion: ''
        };

        while (reader.pos < reader.len) {
            const tag = reader.readTag();
            if (!tag) break;

            switch (tag.fieldNumber) {
                case 1: manifest.version = reader.readVarint(); break;
                case 2: manifest.worldName = reader.readString(); break;
                case 3: manifest.missionName = reader.readString(); break;
                case 4: manifest.frameCount = reader.readVarint(); break;
                case 5: manifest.chunkSize = reader.readVarint(); break;
                case 6: manifest.captureDelayMs = reader.readVarint(); break;
                case 7: manifest.chunkCount = reader.readVarint(); break;
                case 8:
                    const entLen = reader.readVarint();
                    const entEnd = reader.pos + entLen;
                    manifest.entities.push(decodeEntityDef(reader, entEnd));
                    break;
                case 9:
                    const timeLen = reader.readVarint();
                    const timeEnd = reader.pos + timeLen;
                    manifest.times.push(decodeTimeSample(reader, timeEnd));
                    break;
                case 10:
                    const evtLen = reader.readVarint();
                    const evtEnd = reader.pos + evtLen;
                    manifest.events.push(decodeEvent(reader, evtEnd));
                    break;
                case 11:
                    const markerLen = reader.readVarint();
                    const markerEnd = reader.pos + markerLen;
                    manifest.markers.push(decodeMarkerDef(reader, markerEnd));
                    break;
                case 12: manifest.extensionVersion = reader.readString(); break;
                case 13: manifest.addonVersion = reader.readString(); break;
                default:
                    reader.skip(tag.wireType);
            }
        }

        return manifest;
    }

    /**
     * Decode EntityDef message
     */
    function decodeEntityDef(reader, endPos) {
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

        while (reader.pos < endPos) {
            const tag = reader.readTag();
            if (!tag || reader.pos > endPos) break;

            switch (tag.fieldNumber) {
                case 1: entity.id = reader.readVarint(); break;
                case 2: entity.type = EntityType[reader.readVarint()] || 'unknown'; break;
                case 3: entity.name = reader.readString(); break;
                case 4: entity.side = Side[reader.readVarint()] || 'UNKNOWN'; break;
                case 5: entity.groupName = reader.readString(); break;
                case 6: entity.role = reader.readString(); break;
                case 7: entity.startFrame = reader.readVarint(); break;
                case 8: entity.endFrame = reader.readVarint(); break;
                case 9: entity.isPlayer = reader.readVarint() !== 0; break;
                case 10: entity.vehicleClass = reader.readString(); break;
                default: reader.skip(tag.wireType);
            }
        }

        return entity;
    }

    /**
     * Decode TimeSample message
     */
    function decodeTimeSample(reader, endPos) {
        const sample = {
            frameNum: 0,
            systemTimeUtc: '',
            date: '',
            timeMultiplier: 1.0,
            time: 0
        };

        while (reader.pos < endPos) {
            const tag = reader.readTag();
            if (!tag || reader.pos > endPos) break;

            switch (tag.fieldNumber) {
                case 1: sample.frameNum = reader.readVarint(); break;
                case 2: sample.systemTimeUtc = reader.readString(); break;
                case 3: sample.date = reader.readString(); break;
                case 4: sample.timeMultiplier = reader.readFloat(); break;
                case 5: sample.time = reader.readFloat(); break;
                default: reader.skip(tag.wireType);
            }
        }

        return sample;
    }

    /**
     * Decode Event message
     */
    function decodeEvent(reader, endPos) {
        const event = {
            frameNum: 0,
            type: '',
            sourceId: 0,
            targetId: 0,
            message: '',
            distance: 0,
            weapon: ''
        };

        while (reader.pos < endPos) {
            const tag = reader.readTag();
            if (!tag || reader.pos > endPos) break;

            switch (tag.fieldNumber) {
                case 1: event.frameNum = reader.readVarint(); break;
                case 2: event.type = reader.readString(); break;
                case 3: event.sourceId = reader.readVarint(); break;
                case 4: event.targetId = reader.readVarint(); break;
                case 5: event.message = reader.readString(); break;
                case 6: event.distance = reader.readFloat(); break;
                case 7: event.weapon = reader.readString(); break;
                default: reader.skip(tag.wireType);
            }
        }

        return event;
    }

    /**
     * Decode MarkerDef message
     */
    function decodeMarkerDef(reader, endPos) {
        const marker = {
            type: '',
            text: '',
            startFrame: 0,
            endFrame: 0,
            playerId: -1,
            color: '',
            side: 'UNKNOWN',
            positions: [],
            size: [],
            shape: 'ICON',
            brush: 'Solid'
        };

        while (reader.pos < endPos) {
            const tag = reader.readTag();
            if (!tag || reader.pos > endPos) break;

            switch (tag.fieldNumber) {
                case 1: marker.type = reader.readString(); break;
                case 2: marker.text = reader.readString(); break;
                case 3: marker.startFrame = reader.readVarint(); break;
                case 4: marker.endFrame = reader.readVarint(); break;
                case 5: marker.playerId = reader.readSignedVarint(); break;
                case 6: marker.color = reader.readString(); break;
                case 7: marker.side = Side[reader.readVarint()] || 'UNKNOWN'; break;
                case 8:
                    const posLen = reader.readVarint();
                    const posEnd = reader.pos + posLen;
                    marker.positions.push(decodeMarkerPosition(reader, posEnd));
                    break;
                case 9:
                    // Packed repeated float
                    if (tag.wireType === WIRE_LENGTH_DELIMITED) {
                        const len = reader.readVarint();
                        const end = reader.pos + len;
                        while (reader.pos < end) {
                            marker.size.push(reader.readFloat());
                        }
                    } else {
                        marker.size.push(reader.readFloat());
                    }
                    break;
                case 10: marker.shape = reader.readString(); break;
                case 11: marker.brush = reader.readString(); break;
                default: reader.skip(tag.wireType);
            }
        }

        return marker;
    }

    /**
     * Decode MarkerPosition message
     */
    function decodeMarkerPosition(reader, endPos) {
        const pos = {
            frameNum: 0,
            posX: 0,
            posY: 0,
            posZ: 0,
            direction: 0,
            alpha: 1.0
        };

        while (reader.pos < endPos) {
            const tag = reader.readTag();
            if (!tag || reader.pos > endPos) break;

            switch (tag.fieldNumber) {
                case 1: pos.frameNum = reader.readVarint(); break;
                case 2: pos.posX = reader.readFloat(); break;
                case 3: pos.posY = reader.readFloat(); break;
                case 4: pos.posZ = reader.readFloat(); break;
                case 5: pos.direction = reader.readFloat(); break;
                case 6: pos.alpha = reader.readFloat(); break;
                default: reader.skip(tag.wireType);
            }
        }

        return pos;
    }

    /**
     * Decode Chunk message
     */
    function decodeChunk(buffer) {
        const reader = new Reader(buffer);
        const chunk = {
            index: 0,
            startFrame: 0,
            frameCount: 0,
            frames: []
        };

        while (reader.pos < reader.len) {
            const tag = reader.readTag();
            if (!tag) break;

            switch (tag.fieldNumber) {
                case 1: chunk.index = reader.readVarint(); break;
                case 2: chunk.startFrame = reader.readVarint(); break;
                case 3: chunk.frameCount = reader.readVarint(); break;
                case 4:
                    const frameLen = reader.readVarint();
                    const frameEnd = reader.pos + frameLen;
                    chunk.frames.push(decodeFrame(reader, frameEnd));
                    break;
                default:
                    reader.skip(tag.wireType);
            }
        }

        return chunk;
    }

    /**
     * Decode Frame message
     */
    function decodeFrame(reader, endPos) {
        const frame = {
            frameNum: 0,
            entities: []
        };

        while (reader.pos < endPos) {
            const tag = reader.readTag();
            if (!tag || reader.pos > endPos) break;

            switch (tag.fieldNumber) {
                case 1: frame.frameNum = reader.readVarint(); break;
                case 2:
                    const entLen = reader.readVarint();
                    const entEnd = reader.pos + entLen;
                    frame.entities.push(decodeEntityState(reader, entEnd));
                    break;
                default: reader.skip(tag.wireType);
            }
        }

        return frame;
    }

    /**
     * Decode EntityState message
     */
    function decodeEntityState(reader, endPos) {
        const state = {
            entityId: 0,
            posX: 0,
            posY: 0,
            direction: 0,
            alive: 1,
            crewIds: [],
            vehicleId: 0,
            isInVehicle: false,
            name: '',
            isPlayer: false
        };

        while (reader.pos < endPos) {
            const tag = reader.readTag();
            if (!tag || reader.pos > endPos) break;

            switch (tag.fieldNumber) {
                case 1: state.entityId = reader.readVarint(); break;
                case 2: state.posX = reader.readFloat(); break;
                case 3: state.posY = reader.readFloat(); break;
                case 4: state.direction = reader.readVarint(); break;
                case 5: state.alive = reader.readVarint(); break;
                case 6:
                    // Packed repeated uint32
                    if (tag.wireType === WIRE_LENGTH_DELIMITED) {
                        const len = reader.readVarint();
                        const end = reader.pos + len;
                        while (reader.pos < end) {
                            state.crewIds.push(reader.readVarint());
                        }
                    } else {
                        state.crewIds.push(reader.readVarint());
                    }
                    break;
                case 7: state.vehicleId = reader.readVarint(); break;
                case 8: state.isInVehicle = reader.readVarint() !== 0; break;
                case 9: state.name = reader.readString(); break;
                case 10: state.isPlayer = reader.readVarint() !== 0; break;
                default: reader.skip(tag.wireType);
            }
        }

        return state;
    }

    // Public API
    return {
        decodeManifest: decodeManifest,
        decodeChunk: decodeChunk,

        // Expose types for reference
        EntityType: EntityType,
        Side: Side
    };
})();

// Export for use
if (typeof window !== 'undefined') {
    window.ProtobufDecoder = ProtobufDecoder;
}
