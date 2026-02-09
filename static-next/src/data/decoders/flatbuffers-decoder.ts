import type { ArmaCoord } from "../../utils/coordinates";
import type {
  AliveState,
  ChunkData,
  EntityDef,
  EntityState,
  EntityType,
  EventDef,
  Manifest,
  Side,
} from "../types";
import type { DecoderStrategy } from "./decoder.interface";

// ───────── Enum look-ups ─────────

const SIDE_MAP: Record<number, Side> = {
  1: "WEST",
  2: "EAST",
  3: "GUER",
  4: "CIV",
};

const ENTITY_TYPE_MAP: Record<number, "unknown" | "unit" | "vehicle"> = {
  0: "unknown",
  1: "unit",
  2: "vehicle",
};

// ───────── FlatBufferReader ─────────

/**
 * Low-level FlatBuffers binary reader operating on an ArrayBuffer.
 * Exported so tests can exercise it independently.
 */
export class FlatBufferReader {
  readonly buffer: ArrayBuffer;
  readonly view: DataView;

  constructor(buffer: ArrayBuffer) {
    this.buffer = buffer;
    this.view = new DataView(buffer);
  }

  /** Read root table offset (first 4 bytes of the buffer). */
  getRootOffset(): number {
    return this.view.getUint32(0, true);
  }

  /**
   * Read a field offset from the vtable.
   * Returns 0 if the field is not present.
   */
  getFieldOffset(tableOffset: number, fieldIndex: number): number {
    const vtableOffset =
      tableOffset - this.view.getInt32(tableOffset, true);
    const vtableSize = this.view.getUint16(vtableOffset, true);
    const fieldOffsetPos = vtableOffset + 4 + fieldIndex * 2;

    if (fieldOffsetPos >= vtableOffset + vtableSize) {
      return 0; // Field not present
    }

    return this.view.getUint16(fieldOffsetPos, true);
  }

  readUint8(offset: number): number {
    return this.view.getUint8(offset);
  }

  readUint16(offset: number): number {
    return this.view.getUint16(offset, true);
  }

  readUint32(offset: number): number {
    return this.view.getUint32(offset, true);
  }

  readInt32(offset: number): number {
    return this.view.getInt32(offset, true);
  }

  readFloat32(offset: number): number {
    return this.view.getFloat32(offset, true);
  }

  readBool(offset: number): boolean {
    return this.view.getUint8(offset) !== 0;
  }

  /** Read a string at the given offset (indirect via offset pointer). */
  readString(offset: number): string {
    const strOffset = offset + this.view.getUint32(offset, true);
    const length = this.view.getUint32(strOffset, true);
    const bytes = new Uint8Array(this.buffer, strOffset + 4, length);
    return new TextDecoder().decode(bytes);
  }

  /** Read the length of a vector at the given offset. */
  readVectorLength(offset: number): number {
    const vecOffset = offset + this.view.getUint32(offset, true);
    return this.view.getUint32(vecOffset, true);
  }

  /** Get the offset of a vector element (for scalar vectors). */
  getVectorElementOffset(offset: number, index: number): number {
    const vecOffset = offset + this.view.getUint32(offset, true);
    return vecOffset + 4 + index * 4;
  }

  /** Read a table from a vector of tables at the given index. */
  readTableFromVector(offset: number, index: number): number {
    const vecOffset = offset + this.view.getUint32(offset, true);
    const elemOffset = vecOffset + 4 + index * 4;
    return elemOffset + this.view.getUint32(elemOffset, true);
  }

  /** Read a vector of uint32 values. */
  readUint32Vector(offset: number): number[] {
    const vecOffset = offset + this.view.getUint32(offset, true);
    const length = this.view.getUint32(vecOffset, true);
    const result: number[] = [];
    for (let i = 0; i < length; i++) {
      result.push(this.view.getUint32(vecOffset + 4 + i * 4, true));
    }
    return result;
  }
}

// ───────── Internal raw types ─────────

interface RawFbEvent {
  frameNum: number;
  type: string;
  sourceId: number;
  targetId: number;
  message: string;
  distance: number;
  weapon: string;
}

interface RawFbEntityState {
  entityId: number;
  posX: number;
  posY: number;
  direction: number;
  alive: number;
  crewIds: number[];
  vehicleId: number;
  isInVehicle: boolean;
  name: string;
  isPlayer: boolean;
}

// ───────── Conversion helpers ─────────

function rawEventToEventDef(raw: RawFbEvent): EventDef | null {
  const { frameNum, type } = raw;

  switch (type) {
    case "hit":
    case "killed":
      return {
        frameNum,
        type,
        victimId: raw.targetId,
        causedById: raw.sourceId,
        distance: raw.distance,
        weapon: raw.weapon,
      };
    case "connected":
    case "disconnected":
      return {
        frameNum,
        type,
        unitName: raw.message,
      };
    case "respawnTickets":
    case "counterInit":
    case "counterSet":
      return {
        frameNum,
        type,
        data: raw.message ? raw.message.split(",").map(Number) : [],
      };
    case "endMission":
      return {
        frameNum,
        type,
        side: raw.message?.split(",")[0] ?? "",
        message: raw.message?.split(",").slice(1).join(",") ?? "",
      };
    default:
      return null;
  }
}

function rawEntityStateToEntityState(raw: RawFbEntityState): EntityState {
  const state: EntityState = {
    position: [raw.posX, raw.posY] as ArmaCoord,
    direction: raw.direction,
    alive: (raw.alive & 0x3) as AliveState,
  };
  if (raw.name) state.name = raw.name;
  if (raw.crewIds.length > 0) state.crewIds = raw.crewIds;
  if (raw.vehicleId) state.vehicleId = raw.vehicleId;
  if (raw.isInVehicle) state.isInVehicle = raw.isInVehicle;
  if (raw.isPlayer) state.isPlayer = raw.isPlayer;
  return state;
}

// ───────── Sub-message decoders ─────────

function decodeEntityDef(
  reader: FlatBufferReader,
  tableOffset: number,
): EntityDef {
  let id = 0;
  let protoType = 0;
  let name = "";
  let sideNum = 0;
  let groupName = "";
  let role = "";
  let startFrame = 0;
  let endFrame = 0;
  let isPlayer = false;

  // Field indices: 0:id, 1:type, 2:name, 3:side, 4:group_name, 5:role,
  // 6:start_frame, 7:end_frame, 8:is_player, 9:vehicle_class

  let fieldOffset = reader.getFieldOffset(tableOffset, 0);
  if (fieldOffset) id = reader.readUint32(tableOffset + fieldOffset);

  fieldOffset = reader.getFieldOffset(tableOffset, 1);
  if (fieldOffset) protoType = reader.readUint8(tableOffset + fieldOffset);

  fieldOffset = reader.getFieldOffset(tableOffset, 2);
  if (fieldOffset) name = reader.readString(tableOffset + fieldOffset);

  fieldOffset = reader.getFieldOffset(tableOffset, 3);
  if (fieldOffset) sideNum = reader.readUint8(tableOffset + fieldOffset);

  fieldOffset = reader.getFieldOffset(tableOffset, 4);
  if (fieldOffset) groupName = reader.readString(tableOffset + fieldOffset);

  fieldOffset = reader.getFieldOffset(tableOffset, 5);
  if (fieldOffset) role = reader.readString(tableOffset + fieldOffset);

  fieldOffset = reader.getFieldOffset(tableOffset, 6);
  if (fieldOffset) startFrame = reader.readUint32(tableOffset + fieldOffset);

  fieldOffset = reader.getFieldOffset(tableOffset, 7);
  if (fieldOffset) endFrame = reader.readUint32(tableOffset + fieldOffset);

  fieldOffset = reader.getFieldOffset(tableOffset, 8);
  if (fieldOffset) isPlayer = reader.readBool(tableOffset + fieldOffset);

  // Map FB EntityType enum to application EntityType
  const typeStr = ENTITY_TYPE_MAP[protoType] ?? "unknown";
  let entityType: EntityType;
  if (typeStr === "unit") {
    entityType = "man";
  } else {
    entityType = "unknown";
  }

  const def: EntityDef = {
    id,
    type: entityType,
    name,
    side: SIDE_MAP[sideNum] ?? "CIV",
    groupName,
    isPlayer,
    startFrame,
    endFrame,
  };
  if (role) def.role = role;
  return def;
}

function decodeFbEvent(
  reader: FlatBufferReader,
  tableOffset: number,
): RawFbEvent {
  const event: RawFbEvent = {
    frameNum: 0,
    type: "",
    sourceId: 0,
    targetId: 0,
    message: "",
    distance: 0,
    weapon: "",
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
}

function decodeTimeSample(
  reader: FlatBufferReader,
  tableOffset: number,
): { frameNum: number; systemTimeUtc: string } {
  let frameNum = 0;
  let systemTimeUtc = "";

  let fieldOffset = reader.getFieldOffset(tableOffset, 0);
  if (fieldOffset) frameNum = reader.readUint32(tableOffset + fieldOffset);

  fieldOffset = reader.getFieldOffset(tableOffset, 1);
  if (fieldOffset) systemTimeUtc = reader.readString(tableOffset + fieldOffset);

  return { frameNum, systemTimeUtc };
}

function decodeFbEntityState(
  reader: FlatBufferReader,
  tableOffset: number,
): RawFbEntityState {
  const state: RawFbEntityState = {
    entityId: 0,
    posX: 0,
    posY: 0,
    direction: 0,
    alive: 0,
    crewIds: [],
    vehicleId: 0,
    isInVehicle: false,
    name: "",
    isPlayer: false,
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

interface RawFbFrame {
  frameNum: number;
  entities: RawFbEntityState[];
}

function decodeFbFrame(
  reader: FlatBufferReader,
  tableOffset: number,
): RawFbFrame {
  const frame: RawFbFrame = { frameNum: 0, entities: [] };

  let fieldOffset = reader.getFieldOffset(tableOffset, 0);
  if (fieldOffset) frame.frameNum = reader.readUint32(tableOffset + fieldOffset);

  // Read entities vector
  fieldOffset = reader.getFieldOffset(tableOffset, 1);
  if (fieldOffset) {
    const vecOffset = tableOffset + fieldOffset;
    const count = reader.readVectorLength(vecOffset);
    for (let i = 0; i < count; i++) {
      frame.entities.push(
        decodeFbEntityState(reader, reader.readTableFromVector(vecOffset, i)),
      );
    }
  }

  return frame;
}

// ───────── Public decoder ─────────

export class FlatBuffersDecoder implements DecoderStrategy {
  decodeManifest(buffer: ArrayBuffer): Manifest {
    const reader = new FlatBufferReader(buffer);
    const rootOffset = reader.getRootOffset();

    let version = 0;
    let worldName = "";
    let missionName = "";
    let frameCount = 0;
    let chunkSize = 0;
    let captureDelayMs = 0;
    let chunkCount = 0;
    const entities: EntityDef[] = [];
    const times: Array<{ frameNum: number; systemTimeUtc: string }> = [];
    const rawEvents: RawFbEvent[] = [];

    // Field indices for Manifest table (matching schema order in ocap.fbs)
    // 0: version, 1: world_name, 2: mission_name, 3: frame_count,
    // 4: chunk_size, 5: capture_delay_ms, 6: chunk_count, 7: entities, 8: times, 9: events, 10: markers

    let fieldOffset = reader.getFieldOffset(rootOffset, 0);
    if (fieldOffset) version = reader.readUint32(rootOffset + fieldOffset);

    fieldOffset = reader.getFieldOffset(rootOffset, 1);
    if (fieldOffset) worldName = reader.readString(rootOffset + fieldOffset);

    fieldOffset = reader.getFieldOffset(rootOffset, 2);
    if (fieldOffset) missionName = reader.readString(rootOffset + fieldOffset);

    fieldOffset = reader.getFieldOffset(rootOffset, 3);
    if (fieldOffset) frameCount = reader.readUint32(rootOffset + fieldOffset);

    fieldOffset = reader.getFieldOffset(rootOffset, 4);
    if (fieldOffset) chunkSize = reader.readUint32(rootOffset + fieldOffset);

    fieldOffset = reader.getFieldOffset(rootOffset, 5);
    if (fieldOffset) captureDelayMs = reader.readUint32(rootOffset + fieldOffset);

    fieldOffset = reader.getFieldOffset(rootOffset, 6);
    if (fieldOffset) chunkCount = reader.readUint32(rootOffset + fieldOffset);

    // Read entities vector (index 7)
    fieldOffset = reader.getFieldOffset(rootOffset, 7);
    if (fieldOffset) {
      const vecOffset = rootOffset + fieldOffset;
      const count = reader.readVectorLength(vecOffset);
      for (let i = 0; i < count; i++) {
        entities.push(
          decodeEntityDef(reader, reader.readTableFromVector(vecOffset, i)),
        );
      }
    }

    // Read times vector (index 8)
    fieldOffset = reader.getFieldOffset(rootOffset, 8);
    if (fieldOffset) {
      const vecOffset = rootOffset + fieldOffset;
      const count = reader.readVectorLength(vecOffset);
      for (let i = 0; i < count; i++) {
        times.push(
          decodeTimeSample(reader, reader.readTableFromVector(vecOffset, i)),
        );
      }
    }

    // Read events vector (index 9)
    fieldOffset = reader.getFieldOffset(rootOffset, 9);
    if (fieldOffset) {
      const vecOffset = rootOffset + fieldOffset;
      const count = reader.readVectorLength(vecOffset);
      for (let i = 0; i < count; i++) {
        rawEvents.push(
          decodeFbEvent(reader, reader.readTableFromVector(vecOffset, i)),
        );
      }
    }

    const events = rawEvents.map(rawEventToEventDef).filter((e): e is EventDef => e !== null);

    // Read extension_version (index 11)
    let extensionVersion: string | undefined;
    fieldOffset = reader.getFieldOffset(rootOffset, 11);
    if (fieldOffset) extensionVersion = reader.readString(rootOffset + fieldOffset);

    // Read addon_version (index 12)
    let addonVersion: string | undefined;
    fieldOffset = reader.getFieldOffset(rootOffset, 12);
    if (fieldOffset) addonVersion = reader.readString(rootOffset + fieldOffset);

    return {
      version,
      worldName,
      missionName,
      frameCount,
      chunkSize,
      captureDelayMs,
      chunkCount,
      entities,
      events,
      markers: [],
      times,
      extensionVersion,
      addonVersion,
    };
  }

  decodeChunk(buffer: ArrayBuffer): ChunkData {
    const reader = new FlatBufferReader(buffer);
    const rootOffset = reader.getRootOffset();

    const rawFrames: RawFbFrame[] = [];

    // Field indices: 0:index, 1:start_frame, 2:frame_count, 3:frames

    // Read frames vector (index 3)
    const fieldOffset = reader.getFieldOffset(rootOffset, 3);
    if (fieldOffset) {
      const vecOffset = rootOffset + fieldOffset;
      const count = reader.readVectorLength(vecOffset);
      for (let i = 0; i < count; i++) {
        rawFrames.push(
          decodeFbFrame(reader, reader.readTableFromVector(vecOffset, i)),
        );
      }
    }

    // Pivot from frame-oriented to entity-oriented
    const entities = new Map<number, EntityState[]>();

    for (const frame of rawFrames) {
      for (const raw of frame.entities) {
        let arr = entities.get(raw.entityId);
        if (!arr) {
          arr = [];
          entities.set(raw.entityId, arr);
        }
        arr.push(rawEntityStateToEntityState(raw));
      }
    }

    return { entities };
  }
}
