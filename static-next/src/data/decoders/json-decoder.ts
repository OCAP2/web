import type { ArmaCoord } from "../../utils/coordinates";
import type {
  AliveState,
  ChunkData,
  EntityDef,
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
  times?: Array<{ frameNum: number; systemTimeUtc: string }>;
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
  if (rawType === "unit") return "man";
  return "unknown";
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

function convertEntity(raw: RawJsonEntity): EntityDef {
  const def: EntityDef = {
    id: raw.id,
    type: mapEntityType(raw.type),
    name: raw.name,
    side: mapSide(raw.side),
    groupName: raw.group ?? "",
    isPlayer: raw.isPlayer === 1,
    startFrame: raw.startFrameNum ?? 0,
    endFrame: 0, // JSON format doesn't have explicit endFrame per entity
    role: raw.role,
  };

  // Infer endFrame from positions array length + startFrame
  if (raw.positions && raw.positions.length > 0) {
    def.endFrame = def.startFrame + raw.positions.length - 1;
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
    default:
      // Unknown event types: return as hit-shaped fallback
      return {
        frameNum,
        type: "hit",
        victimId: typeof raw[2] === "number" ? raw[2] : 0,
        causedById: 0,
        distance: 0,
        weapon: "",
      };
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
      systemTimeUtc: t.systemTimeUtc,
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
    };
  }

  decodeChunk(_buffer: ArrayBuffer): ChunkData {
    throw new Error(
      "JSON decoder does not support chunked loading. " +
        "The entire operation is contained in the manifest.",
    );
  }
}
