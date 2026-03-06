import type { ArmaCoord } from "../../utils/coordinates";
import {
  FRAME_FOREVER,
  type AliveState,
  type ChunkData,
  type EntityDef as AppEntityDef,
  type EntityState as AppEntityState,
  type EntityType,
  type EventDef,
  type Manifest as AppManifest,
  type MarkerDef as AppMarkerDef,
  type Side,
} from "../types";
import type { DecoderStrategy } from "./decoder.interface";
import {
  Manifest as PbManifest,
  Chunk as PbChunk,
  EntityType as PbEntityType,
  Side as PbSide,
  type EntityDef as PbEntityDef,
  type EntityState as PbEntityState,
  type Event as PbEvent,
  type MarkerDef as PbMarkerDef,
  type MarkerPosition as PbMarkerPosition,
} from "./generated/ocap.pb";

// ───────── Enum mapping ─────────

const ENTITY_SIDE_MAP: Record<number, Side> = {
  [PbSide.SIDE_WEST]: "WEST",
  [PbSide.SIDE_EAST]: "EAST",
  [PbSide.SIDE_GUER]: "GUER",
  [PbSide.SIDE_CIV]: "CIV",
};

const MARKER_SIDE_MAP: Record<number, string> = {
  ...ENTITY_SIDE_MAP,
  [PbSide.SIDE_GLOBAL]: "GLOBAL",
};

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

/** Map a raw side string (from per-frame protobuf field) to the canonical Side type. */
function mapSideString(raw: string): Side {
  switch (raw) {
    case "WEST": return "WEST";
    case "EAST": return "EAST";
    case "GUER":
    case "INDEPENDENT": return "GUER";
    case "CIV":
    case "CIVILIAN": return "CIV";
    default: return "CIV";
  }
}

// ───────── Conversion helpers ─────────

function convertEntityDef(pb: PbEntityDef): AppEntityDef {
  let entityType: EntityType;
  if (pb.type === PbEntityType.ENTITY_TYPE_UNIT) {
    entityType = "man";
  } else if (pb.type === PbEntityType.ENTITY_TYPE_VEHICLE && pb.vehicleClass) {
    entityType = mapVehicleClass(pb.vehicleClass);
  } else {
    entityType = "unknown";
  }

  const def: AppEntityDef = {
    id: pb.id,
    type: entityType,
    name: pb.name,
    side: ENTITY_SIDE_MAP[pb.side] ?? "CIV",
    groupName: pb.groupName,
    isPlayer: pb.isPlayer,
    startFrame: pb.startFrame,
    endFrame: pb.endFrame,
  };
  if (pb.role) def.role = pb.role;
  if (pb.framesFired.length > 0) {
    def.framesFired = pb.framesFired.map((ff) => [
      ff.frameNum,
      [ff.posX, ff.posY] as ArmaCoord,
    ]);
  }
  return def;
}

function convertEntityState(pb: PbEntityState): AppEntityState {
  const state: AppEntityState = {
    position: [pb.posX, pb.posY, pb.posZ] as ArmaCoord,
    direction: pb.direction,
    alive: (pb.alive & 0x3) as AliveState,
  };
  if (pb.name) state.name = pb.name;
  if (pb.crewIds.length > 0) state.crewIds = [...pb.crewIds];
  if (pb.vehicleId) state.vehicleId = pb.vehicleId;
  if (pb.isInVehicle) state.isInVehicle = pb.isInVehicle;
  if (pb.isPlayer) state.isPlayer = pb.isPlayer;
  if (pb.groupName) state.groupName = pb.groupName;
  if (pb.side) state.side = mapSideString(pb.side);
  return state;
}

function convertEvent(pb: PbEvent): EventDef | null {
  const { frameNum, type } = pb;

  switch (type) {
    case "hit":
    case "killed":
      return {
        frameNum,
        type,
        victimId: pb.targetId,
        causedById: pb.sourceId,
        distance: pb.distance,
        weapon: pb.weapon,
      };
    case "connected":
    case "disconnected":
      return { frameNum, type, unitName: pb.message };
    case "respawnTickets":
    case "counterInit":
    case "counterSet":
      return {
        frameNum,
        type,
        data: pb.message ? pb.message.split(",").map(Number) : [],
      };
    case "endMission":
      return {
        frameNum,
        type,
        side: pb.message?.split(",")[0] ?? "",
        message: pb.message?.split(",").slice(1).join(",") ?? "",
      };
    case "generalEvent":
      return { frameNum, type, message: pb.message ?? "" };
    case "captured":
    case "capturedFlag":
      return {
        frameNum,
        type,
        unitName: pb.message?.split(",")[0] ?? "",
        objectType: pb.message?.split(",")[1] ?? (type === "capturedFlag" ? "flag" : ""),
        position: pb.posX || pb.posY ? [pb.posX, pb.posY] as [number, number] : undefined,
      };
    case "terminalHackStarted":
    case "terminalHackCanceled":
      return { frameNum, type, unitName: pb.message ?? "" };
    default:
      return null;
  }
}

function convertMarkerPosition(pb: PbMarkerPosition): [number, ...any] {
  // Output JSON-style format: [frame, pos, dir, alpha, text, color, size, type, brush]
  // so markerManager.parseMarkerPosition handles both JSON and protobuf identically.
  const pos: any[] = [pb.frameNum];

  if (pb.lineCoords.length > 0) {
    // Convert flat lineCoords to nested [[x1,y1], [x2,y2], ...]
    const points: number[][] = [];
    for (let i = 0; i < pb.lineCoords.length - 1; i += 2) {
      points.push([pb.lineCoords[i], pb.lineCoords[i + 1]]);
    }
    pos.push(points);
  } else {
    pos.push([pb.posX, pb.posY, pb.posZ]);
  }

  pos.push(pb.direction, pb.alpha);

  // Append style overrides if any field is non-default
  if (pb.text || pb.color || pb.type || pb.brush || pb.size.length > 0) {
    pos.push(pb.text ?? "");
    pos.push(pb.color ?? "");
    pos.push(pb.size.length >= 2 ? [pb.size[0], pb.size[1]] : undefined);
    pos.push(pb.type ?? "");
    pos.push(pb.brush ?? "");
  }

  return pos as [number, ...any];
}

function convertMarkerDef(pb: PbMarkerDef): AppMarkerDef {
  const positions = pb.positions.map(convertMarkerPosition);
  const alpha = pb.positions.length > 0 ? pb.positions[0].alpha : 1;
  const side = MARKER_SIDE_MAP[pb.side] ?? String(pb.side);

  const marker: AppMarkerDef = {
    shape: (pb.shape || "ICON") as AppMarkerDef["shape"],
    type: pb.type,
    side,
    color: pb.color,
    positions,
    player: pb.playerId,
    alpha,
    startFrame: pb.startFrame,
    endFrame: pb.endFrame === 0 ? FRAME_FOREVER : pb.endFrame,
  };
  if (pb.text) marker.text = pb.text;
  if (pb.size.length >= 2) marker.size = [pb.size[0], pb.size[1]];
  if (pb.brush) marker.brush = pb.brush;
  return marker;
}

// ───────── Public decoder ─────────

export class ProtobufDecoder implements DecoderStrategy {
  decodeManifest(buffer: ArrayBuffer): AppManifest {
    const pb = PbManifest.decode(new Uint8Array(buffer));

    return {
      version: pb.version,
      worldName: pb.worldName,
      missionName: pb.missionName,
      frameCount: pb.frameCount,
      chunkSize: pb.chunkSize,
      captureDelayMs: pb.captureDelayMs,
      chunkCount: pb.chunkCount,
      entities: pb.entities.map(convertEntityDef),
      events: pb.events.map(convertEvent).filter((e): e is EventDef => e !== null),
      markers: pb.markers.map(convertMarkerDef),
      times: pb.times.map((t) => ({
        frameNum: t.frameNum,
        systemTimeUtc: t.systemTimeUtc,
        date: t.date || undefined,
        timeMultiplier: t.timeMultiplier || undefined,
      })),
      extensionVersion: pb.extensionVersion || undefined,
      addonVersion: pb.addonVersion || undefined,
    };
  }

  decodeChunk(buffer: ArrayBuffer): ChunkData {
    const pb = PbChunk.decode(new Uint8Array(buffer));

    const entities = new Map<number, AppEntityState[]>();
    for (const frame of pb.frames) {
      const idx = frame.frameNum - pb.startFrame;
      for (const raw of frame.entities) {
        let arr = entities.get(raw.entityId);
        if (!arr) {
          arr = new Array(pb.frameCount);
          entities.set(raw.entityId, arr);
        }
        arr[idx] = convertEntityState(raw);
      }
    }

    return { entities };
  }
}
