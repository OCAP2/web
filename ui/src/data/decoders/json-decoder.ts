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

// ───────── Legacy JSON shape ─────────

/**
 * Raw entity as it appears in legacy JSON files.
 * Units have positions like [[pos, dir, alive, isInVehicle, name, isPlayer], ...]
 * Vehicles have positions like [[pos, dir, alive, crew, frames?], ...]
 */
interface RawJsonEntity {
  id: number;
  type: string; // "unit" | "vehicle"
  name: string;
  side: string; // "WEST" | "EAST" | "GUER" | "CIV"
  group?: string;
  isPlayer?: number; // 0 or 1
  startFrameNum: number;
  role?: string;
  class?: string; // vehicle class
  positions: unknown[][];
  framesFired?: Array<[number, number[]]>;
}

/**
 * Events in legacy JSON are arrays:
 * hit/killed: [frameNum, type, victimId, [causedById, weapon], distance]
 * connected/disconnected: [frameNum, type, unitName]
 * counter events: [frameNum, type, data[]]
 */
type RawJsonEvent = unknown[];

/**
 * Markers in legacy JSON are arrays:
 * [type, text, startFrame, endFrame, player, color, side(number), positions, size?, shape?, brush?]
 */
type RawJsonMarker = unknown[];

/** Top-level legacy JSON operation structure. */
interface RawJsonOperation {
  worldName: string;
  missionName: string;
  missionAuthor?: string;
  endFrame: number;
  captureDelay: number;
  extensionVersion?: string;
  addonVersion?: string;
  entities?: RawJsonEntity[];
  events?: RawJsonEvent[];
  Markers?: RawJsonMarker[];
  times?: Array<{ frameNum: number; systemTimeUTC: string; date?: string; timeMultiplier?: number }>;
}

// ───────── Side index lookup ─────────

const SIDE_INDEX: Record<number, string> = {
  "-1": "GLOBAL",
  0: "EAST",
  1: "WEST",
  2: "GUER",
  3: "CIV",
};

// Offset used in legacy JSON: arrSide = ["GLOBAL", "EAST", "WEST", "GUER", "CIV"]
// markerJSON[6] + 1 is the index into arrSide
const MARKER_SIDE_MAP: string[] = ["GLOBAL", "EAST", "WEST", "GUER", "CIV"];

// ───────── Conversion helpers ─────────

function mapEntityType(rawType: string): EntityType {
  switch (rawType) {
    case "unit":
      return "man";
    case "car":
      return "car";
    case "tank":
      return "tank";
    case "apc":
      return "apc";
    case "truck":
      return "truck";
    case "sea":
      return "ship";
    case "heli":
      return "heli";
    case "plane":
      return "plane";
    case "parachute":
      return "parachute";
    case "static-weapon":
      return "staticWeapon";
    case "static-mortar":
      return "staticMortar";
    default:
      return "unknown";
  }
}

function mapSide(rawSide: string): Side {
  switch (rawSide) {
    case "WEST":
      return "WEST";
    case "EAST":
      return "EAST";
    case "GUER":
      return "GUER";
    case "CIV":
      return "CIV";
    default:
      return "CIV";
  }
}

function convertUnitPosition(frame: unknown[]): EntityState {
  const pos = frame[0] as number[];
  const dir = (frame[1] as number) ?? 0;
  const alive = (frame[2] as AliveState) ?? 1;
  // field[3] is 0 when not in vehicle, or the vehicle entity ID when in one
  const vehicleField = typeof frame[3] === "number" ? frame[3] : 0;
  const isInVehicle = vehicleField !== 0;
  const name = typeof frame[4] === "string" ? frame[4] : undefined;
  const isPlayer = frame[5] === 1 || frame[5] === true;
  return {
    position: [pos[0], pos[1]] as ArmaCoord,
    direction: dir,
    alive,
    isInVehicle,
    vehicleId: isInVehicle ? vehicleField : undefined,
    name: name || undefined,
    isPlayer,
  };
}

function convertVehiclePosition(frame: unknown[]): EntityState {
  const pos = frame[0] as number[];
  const dir = (frame[1] as number) ?? 0;
  const alive = (frame[2] as AliveState) ?? 1;
  const crewIds = Array.isArray(frame[3]) ? (frame[3] as number[]) : undefined;
  return {
    position: [pos[0], pos[1]] as ArmaCoord,
    direction: dir,
    alive,
    crewIds,
  };
}

function convertEntity(raw: RawJsonEntity): EntityDef {
  const isUnit = raw.type === "unit";
  const def: EntityDef = {
    id: raw.id,
    type: mapEntityType(isUnit ? raw.type : (raw.class ?? raw.type)),
    name: raw.name,
    side: mapSide(raw.side),
    groupName: raw.group ?? "",
    isPlayer: raw.isPlayer === 1,
    startFrame: raw.startFrameNum ?? 0,
    endFrame: 0, // JSON format doesn't have explicit endFrame per entity
    role: raw.role,
  };

  // Parse positions into EntityState array
  if (raw.positions && raw.positions.length > 0) {
    if (isUnit) {
      // Units: dense format — one position per frame
      def.endFrame = def.startFrame + raw.positions.length - 1;
      def.positions = raw.positions.map((frame) => convertUnitPosition(frame));
    } else {
      // Vehicles: may use RLE format with [startFrame, endFrame] at index 4.
      // Each RLE entry covers a contiguous frame range with identical state.
      // Expand into one EntityState per frame to match the dense indexing
      // the playback engine expects (positions[relativeFrame]).
      const expanded: EntityState[] = [];
      for (const frame of raw.positions) {
        const state = convertVehiclePosition(frame);
        const frameRange = frame[4];
        if (Array.isArray(frameRange) && frameRange.length >= 2) {
          const rangeStart = frameRange[0] as number;
          const rangeEnd = frameRange[1] as number;
          for (let f = rangeStart; f <= rangeEnd; f++) {
            expanded.push(state);
          }
        } else {
          // Dense: single frame (no frame range field)
          expanded.push(state);
        }
      }
      def.positions = expanded;
      def.endFrame = def.startFrame + expanded.length - 1;
    }
  }

  // Convert framesFired: legacy format is [frameNum, [x, y]] or [frameNum, [x, y, z]]
  if (raw.framesFired && raw.framesFired.length > 0) {
    def.framesFired = raw.framesFired.map((ff) => {
      const frameNum = ff[0] as number;
      const coords = ff[1] as number[];
      return [frameNum, [coords[0], coords[1]] as ArmaCoord];
    });
  }

  return def;
}

function convertEvent(raw: RawJsonEvent): EventDef | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;

  const frameNum = raw[0] as number;
  const type = raw[1] as string;

  switch (type) {
    case "hit":
    case "killed": {
      const victimId = (raw[2] as number) ?? 0;
      const causedByInfo = raw[3] as [number, string] | undefined;
      const distance = (raw[4] as number) ?? 0;
      return {
        frameNum,
        type,
        victimId,
        causedById: causedByInfo?.[0] ?? 0,
        distance,
        weapon: causedByInfo?.[1] ?? "",
      };
    }
    case "connected":
    case "disconnected":
      return {
        frameNum,
        type,
        unitName: (raw[2] as string) ?? "",
      };
    case "respawnTickets":
    case "counterInit":
    case "counterSet":
      return {
        frameNum,
        type,
        data: Array.isArray(raw[2]) ? (raw[2] as number[]) : [],
      };
    case "endMission": {
      const endData = raw[2] as [string, string] | undefined;
      return {
        frameNum,
        type,
        side: endData?.[0] ?? "",
        message: endData?.[1] ?? "",
      };
    }
    case "generalEvent":
      return {
        frameNum,
        type,
        message: (raw[2] as string) ?? "",
      };
    case "capturedFlag": {
      // deprecated: [frameNum, "capturedFlag", [unitName, unitColor, objectPos, unitPos]]
      const capData = raw[2] as string[] | undefined;
      return {
        frameNum,
        type,
        unitName: capData?.[0] ?? "",
        objectType: "flag",
      };
    }
    case "captured": {
      // [frameNum, "captured", [unitName, unitColor, objectType, objectColor, objectPos, unitPos]]
      const capData = raw[2] as string[] | undefined;
      return {
        frameNum,
        type,
        unitName: capData?.[0] ?? "",
        objectType: capData?.[2] ?? "",
      };
    }
    case "terminalHackStarted":
    case "terminalHackCanceled": {
      // [frameNum, type, [unitName, unitColor, terminalColor, terminalID, ...]]
      const hackData = raw[2] as string[] | undefined;
      return {
        frameNum,
        type,
        unitName: hackData?.[0] ?? "",
      };
    }
    default:
      // Unknown event types: skip
      return null;
  }
}

function convertMarker(raw: RawJsonMarker): MarkerDef | null {
  if (!Array.isArray(raw) || raw.length < 8) return null;

  const type = raw[0] as string;
  const text = raw[1] as string;
  const startFrame = raw[2] as number;
  const endFrame = raw[3] as number;
  const player = raw[4] as number;
  const color = raw[5] as string;
  const sideIndex = (raw[6] as number) + 1;
  const side = MARKER_SIDE_MAP[sideIndex] ?? "GLOBAL";
  const positions = raw[7] as Array<[number, ...unknown[]]>;

  let shape: MarkerDef["shape"] = "ICON";
  let brush: string | undefined;
  let size: [number, number] | undefined;

  if (raw.length > 8) {
    const rawSize = raw[8];
    if (Array.isArray(rawSize) && rawSize.length >= 2) {
      size = [rawSize[0] as number, rawSize[1] as number];
    }
  }
  if (raw.length > 9) {
    shape = (raw[9] as string as MarkerDef["shape"]) ?? "ICON";
  }
  if (raw.length > 10) {
    brush = raw[10] as string;
  }

  // Determine alpha from first position entry if available
  // Legacy marker positions: [frameNum, [x,y] or [x,y,z], direction?, alpha?, ...]
  const alpha = 1;

  const marker: MarkerDef = {
    shape,
    type,
    side,
    color,
    positions,
    player,
    alpha,
    startFrame,
    endFrame,
  };
  if (text) marker.text = text;
  if (size) marker.size = size;
  if (brush) marker.brush = brush;
  return marker;
}

// ───────── Public decoder ─────────

export class JsonDecoder implements DecoderStrategy {
  decodeManifest(buffer: ArrayBuffer): Manifest {
    const text = new TextDecoder().decode(buffer);
    const data: RawJsonOperation = JSON.parse(text);

    const entities: EntityDef[] = (data.entities ?? []).map(convertEntity);
    const events: EventDef[] = (data.events ?? [])
      .map(convertEvent)
      .filter((e): e is EventDef => e !== null);
    const markers: MarkerDef[] = (data.Markers ?? [])
      .map(convertMarker)
      .filter((m): m is MarkerDef => m !== null);
    const times = (data.times ?? []).map((t) => ({
      frameNum: t.frameNum,
      systemTimeUtc: t.systemTimeUTC,
      date: t.date || undefined,
      timeMultiplier: t.timeMultiplier || undefined,
    }));

    return {
      version: 0,
      worldName: data.worldName ?? "",
      missionName: data.missionName ?? "",
      missionAuthor: data.missionAuthor,
      frameCount: data.endFrame ?? 0,
      chunkSize: data.endFrame ?? 0,
      captureDelayMs: (data.captureDelay ?? 1) * 1000,
      chunkCount: 1,
      entities,
      events,
      markers,
      times,
      extensionVersion: data.extensionVersion,
      addonVersion: data.addonVersion,
    };
  }

  decodeChunk(_buffer: ArrayBuffer): ChunkData {
    throw new Error(
      "JSON decoder does not support chunked loading. " +
        "The entire operation is contained in the manifest.",
    );
  }
}
