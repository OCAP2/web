import type { ArmaCoord } from "../../utils/coordinates";
import type {
  AliveState,
  ChunkData,
  EntityDef,
  EntityState,
  EntityType,
  EventDef,
  Manifest,
  MarkerDef,
  Side,
} from "../types";
import type { DecoderStrategy } from "./decoder.interface";

// ───────── Wire types ─────────

const WIRE_VARINT = 0;
const WIRE_64BIT = 1;
const WIRE_LENGTH_DELIMITED = 2;
const WIRE_32BIT = 5;

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

// ───────── Low-level reader ─────────

interface Tag {
  fieldNumber: number;
  wireType: number;
}

/**
 * Low-level protobuf wire-format reader operating on an ArrayBuffer.
 * Exported so tests can exercise it independently.
 */
export class ProtobufReader {
  readonly view: DataView;
  pos: number;
  readonly len: number;

  constructor(buffer: ArrayBuffer, offset = 0, length?: number) {
    this.view = new DataView(buffer, offset, length);
    this.pos = 0;
    this.len = length ?? buffer.byteLength - offset;
  }

  /** Read a base-128 varint (unsigned). */
  readVarint(): number {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      if (this.pos >= this.len) throw new Error("Buffer overflow");
      byte = this.view.getUint8(this.pos++);
      result |= (byte & 0x7f) << shift;
      shift += 7;
    } while (byte & 0x80);
    return result >>> 0; // ensure unsigned 32-bit
  }

  /** Read a ZigZag-encoded signed varint. */
  readSignedVarint(): number {
    const value = this.readVarint();
    return (value >>> 1) ^ -(value & 1);
  }

  readFixed32(): number {
    if (this.pos + 4 > this.len) throw new Error("Buffer overflow");
    const value = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return value;
  }

  readFixed64(): number {
    const low = this.readFixed32();
    const high = this.readFixed32();
    return low + high * 0x100000000;
  }

  readFloat(): number {
    if (this.pos + 4 > this.len) throw new Error("Buffer overflow");
    const value = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return value;
  }

  readDouble(): number {
    if (this.pos + 8 > this.len) throw new Error("Buffer overflow");
    const value = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return value;
  }

  readBytes(length: number): Uint8Array {
    if (this.pos + length > this.len) throw new Error("Buffer overflow");
    const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.pos, length);
    this.pos += length;
    return bytes;
  }

  readString(): string {
    const length = this.readVarint();
    const bytes = this.readBytes(length);
    return new TextDecoder().decode(bytes);
  }

  readTag(): Tag | null {
    if (this.pos >= this.len) return null;
    const tag = this.readVarint();
    return {
      fieldNumber: tag >>> 3,
      wireType: tag & 0x7,
    };
  }

  skip(wireType: number): void {
    switch (wireType) {
      case WIRE_VARINT:
        this.readVarint();
        break;
      case WIRE_64BIT:
        this.pos += 8;
        break;
      case WIRE_LENGTH_DELIMITED: {
        const len = this.readVarint();
        this.pos += len;
        break;
      }
      case WIRE_32BIT:
        this.pos += 4;
        break;
      default:
        throw new Error(`Unknown wire type: ${wireType}`);
    }
  }
}

// ───────── Internal raw types from the proto wire format ─────────

interface RawEvent {
  frameNum: number;
  type: string;
  sourceId: number;
  targetId: number;
  message: string;
  distance: number;
  weapon: string;
}

interface RawMarkerPosition {
  frameNum: number;
  posX: number;
  posY: number;
  posZ: number;
  direction: number;
  alpha: number;
  lineCoords: number[];
}

interface RawEntityState {
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

interface RawFrame {
  frameNum: number;
  entities: RawEntityState[];
}

interface RawTimeSample {
  frameNum: number;
  systemTimeUtc: string;
  date: string;
  timeMultiplier: number;
  time: number;
}

// ───────── Conversion helpers ─────────

function rawEventToEventDef(raw: RawEvent): EventDef | null {
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
      // Unknown event types: skip
      return null;
  }
}

function rawEntityStateToEntityState(raw: RawEntityState): EntityState {
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

// ───────── Vehicle class mapping ─────────

function mapVehicleClass(vehicleClass: string): EntityType {
  switch (vehicleClass) {
    case "car": return "car";
    case "tank": return "tank";
    case "apc": return "apc";
    case "truck": return "truck";
    case "sea": return "ship";
    case "heli": return "heli";
    case "plane": return "plane";
    case "parachute": return "parachute";
    case "static-weapon": return "staticWeapon";
    case "static-mortar": return "staticMortar";
    default: return "unknown";
  }
}

// ───────── Sub-message decoders ─────────

function decodeFiredFrame(
  reader: ProtobufReader,
  endPos: number,
): [number, ArmaCoord] {
  let frameNum = 0;
  let posX = 0;
  let posY = 0;

  while (reader.pos < endPos) {
    const tag = reader.readTag();
    if (!tag || reader.pos > endPos) break;
    switch (tag.fieldNumber) {
      case 1: frameNum = reader.readVarint(); break;
      case 2: posX = reader.readFloat(); break;
      case 3: posY = reader.readFloat(); break;
      case 4: reader.readFloat(); break; // posZ — consumed but not stored
      default: reader.skip(tag.wireType);
    }
  }

  return [frameNum, [posX, posY]];
}

function decodeEntityDef(reader: ProtobufReader, endPos: number): EntityDef {
  let id = 0;
  let protoType = 0;
  let name = "";
  let sideNum = 0;
  let groupName = "";
  let role = "";
  let startFrame = 0;
  let endFrame = 0;
  let isPlayer = false;
  let vehicleClass = "";
  const framesFired: Array<[number, ArmaCoord]> = [];

  while (reader.pos < endPos) {
    const tag = reader.readTag();
    if (!tag || reader.pos > endPos) break;
    switch (tag.fieldNumber) {
      case 1: id = reader.readVarint(); break;
      case 2: protoType = reader.readVarint(); break;
      case 3: name = reader.readString(); break;
      case 4: sideNum = reader.readVarint(); break;
      case 5: groupName = reader.readString(); break;
      case 6: role = reader.readString(); break;
      case 7: startFrame = reader.readVarint(); break;
      case 8: endFrame = reader.readVarint(); break;
      case 9: isPlayer = reader.readVarint() !== 0; break;
      case 10: vehicleClass = reader.readString(); break;
      case 11: {
        const len = reader.readVarint();
        const end = reader.pos + len;
        framesFired.push(decodeFiredFrame(reader, end));
        break;
      }
      default: reader.skip(tag.wireType);
    }
  }

  // Map proto EntityType enum to application EntityType.
  // The proto only distinguishes unknown/unit/vehicle; for vehicles
  // we use vehicleClass to determine the specific type.
  const typeStr = ENTITY_TYPE_MAP[protoType] ?? "unknown";
  let entityType: EntityType;
  if (typeStr === "unit") {
    entityType = "man";
  } else if (typeStr === "vehicle" && vehicleClass) {
    entityType = mapVehicleClass(vehicleClass);
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
  if (framesFired.length > 0) def.framesFired = framesFired;
  return def;
}

function decodeTimeSample(
  reader: ProtobufReader,
  endPos: number,
): RawTimeSample {
  const sample: RawTimeSample = {
    frameNum: 0,
    systemTimeUtc: "",
    date: "",
    timeMultiplier: 1.0,
    time: 0,
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

function decodeRawEvent(reader: ProtobufReader, endPos: number): RawEvent {
  const event: RawEvent = {
    frameNum: 0,
    type: "",
    sourceId: 0,
    targetId: 0,
    message: "",
    distance: 0,
    weapon: "",
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

function decodeMarkerPosition(
  reader: ProtobufReader,
  endPos: number,
): RawMarkerPosition {
  const pos: RawMarkerPosition = {
    frameNum: 0,
    posX: 0,
    posY: 0,
    posZ: 0,
    direction: 0,
    alpha: 1.0,
    lineCoords: [],
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
      case 7:
        if (tag.wireType === WIRE_LENGTH_DELIMITED) {
          const len = reader.readVarint();
          const end = reader.pos + len;
          while (reader.pos < end) {
            pos.lineCoords.push(reader.readFloat());
          }
        } else {
          pos.lineCoords.push(reader.readFloat());
        }
        break;
      default: reader.skip(tag.wireType);
    }
  }

  return pos;
}

function decodeMarkerDef(reader: ProtobufReader, endPos: number): MarkerDef {
  let type = "";
  let text = "";
  let startFrame = 0;
  let endFrame = 0;
  let playerId = -1;
  let color = "";
  let sideNum = 0;
  const rawPositions: RawMarkerPosition[] = [];
  const sizeArr: number[] = [];
  let shape = "ICON";
  let brush = "Solid";

  while (reader.pos < endPos) {
    const tag = reader.readTag();
    if (!tag || reader.pos > endPos) break;
    switch (tag.fieldNumber) {
      case 1: type = reader.readString(); break;
      case 2: text = reader.readString(); break;
      case 3: startFrame = reader.readVarint(); break;
      case 4: endFrame = reader.readVarint(); break;
      case 5: playerId = reader.readSignedVarint(); break;
      case 6: color = reader.readString(); break;
      case 7: sideNum = reader.readVarint(); break;
      case 8: {
        const len = reader.readVarint();
        const end = reader.pos + len;
        rawPositions.push(decodeMarkerPosition(reader, end));
        break;
      }
      case 9:
        if (tag.wireType === WIRE_LENGTH_DELIMITED) {
          const len = reader.readVarint();
          const end = reader.pos + len;
          while (reader.pos < end) {
            sizeArr.push(reader.readFloat());
          }
        } else {
          sizeArr.push(reader.readFloat());
        }
        break;
      case 10: shape = reader.readString(); break;
      case 11: brush = reader.readString(); break;
      default: reader.skip(tag.wireType);
    }
  }

  // Convert raw positions to the tuple format: [frameNum, posX, posY, posZ, direction, alpha, ...lineCoords]
  const positions: Array<[number, ...any]> = rawPositions.map((p) => {
    const tuple: [number, ...any] = [
      p.frameNum,
      p.posX,
      p.posY,
      p.posZ,
      p.direction,
      p.alpha,
      ...p.lineCoords,
    ];
    return tuple;
  });

  // Determine alpha from the first position, or default 1
  const alpha = rawPositions.length > 0 ? rawPositions[0].alpha : 1;

  const side = SIDE_MAP[sideNum] ?? String(sideNum);

  const marker: MarkerDef = {
    shape: shape as MarkerDef["shape"],
    type,
    side,
    color,
    positions,
    player: playerId,
    alpha,
  };
  if (text) marker.text = text;
  if (sizeArr.length >= 2) marker.size = [sizeArr[0], sizeArr[1]];
  if (brush) marker.brush = brush;
  return marker;
}

function decodeRawEntityState(
  reader: ProtobufReader,
  endPos: number,
): RawEntityState {
  const state: RawEntityState = {
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

function decodeRawFrame(reader: ProtobufReader, endPos: number): RawFrame {
  const frame: RawFrame = { frameNum: 0, entities: [] };

  while (reader.pos < endPos) {
    const tag = reader.readTag();
    if (!tag || reader.pos > endPos) break;
    switch (tag.fieldNumber) {
      case 1: frame.frameNum = reader.readVarint(); break;
      case 2: {
        const len = reader.readVarint();
        const end = reader.pos + len;
        frame.entities.push(decodeRawEntityState(reader, end));
        break;
      }
      default: reader.skip(tag.wireType);
    }
  }

  return frame;
}

// ───────── Public decoder ─────────

export class ProtobufDecoder implements DecoderStrategy {
  decodeManifest(buffer: ArrayBuffer): Manifest {
    const reader = new ProtobufReader(buffer);

    let version = 0;
    let worldName = "";
    let missionName = "";
    let frameCount = 0;
    let chunkSize = 300;
    let captureDelayMs = 1000;
    let chunkCount = 0;
    let extensionVersion: string | undefined;
    let addonVersion: string | undefined;
    const entities: EntityDef[] = [];
    const rawTimes: RawTimeSample[] = [];
    const rawEvents: RawEvent[] = [];
    const markers: MarkerDef[] = [];

    while (reader.pos < reader.len) {
      const tag = reader.readTag();
      if (!tag) break;
      switch (tag.fieldNumber) {
        case 1: version = reader.readVarint(); break;
        case 2: worldName = reader.readString(); break;
        case 3: missionName = reader.readString(); break;
        case 4: frameCount = reader.readVarint(); break;
        case 5: chunkSize = reader.readVarint(); break;
        case 6: captureDelayMs = reader.readVarint(); break;
        case 7: chunkCount = reader.readVarint(); break;
        case 8: {
          const len = reader.readVarint();
          const end = reader.pos + len;
          entities.push(decodeEntityDef(reader, end));
          break;
        }
        case 9: {
          const len = reader.readVarint();
          const end = reader.pos + len;
          rawTimes.push(decodeTimeSample(reader, end));
          break;
        }
        case 10: {
          const len = reader.readVarint();
          const end = reader.pos + len;
          rawEvents.push(decodeRawEvent(reader, end));
          break;
        }
        case 11: {
          const len = reader.readVarint();
          const end = reader.pos + len;
          markers.push(decodeMarkerDef(reader, end));
          break;
        }
        case 12: extensionVersion = reader.readString(); break;
        case 13: addonVersion = reader.readString(); break;
        default: reader.skip(tag.wireType);
      }
    }

    const times = rawTimes.map((t) => ({
      frameNum: t.frameNum,
      systemTimeUtc: t.systemTimeUtc,
    }));
    const events = rawEvents.map(rawEventToEventDef).filter((e): e is EventDef => e !== null);

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
      markers,
      times,
      extensionVersion,
      addonVersion,
    };
  }

  decodeChunk(buffer: ArrayBuffer): ChunkData {
    const reader = new ProtobufReader(buffer);
    const rawFrames: RawFrame[] = [];

    while (reader.pos < reader.len) {
      const tag = reader.readTag();
      if (!tag) break;
      switch (tag.fieldNumber) {
        case 1: reader.readVarint(); break; // index
        case 2: reader.readVarint(); break; // startFrame
        case 3: reader.readVarint(); break; // frameCount
        case 4: {
          const len = reader.readVarint();
          const end = reader.pos + len;
          rawFrames.push(decodeRawFrame(reader, end));
          break;
        }
        default: reader.skip(tag.wireType);
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
