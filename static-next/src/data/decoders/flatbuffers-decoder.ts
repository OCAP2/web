import * as flatbuffers from "flatbuffers";
import type { ArmaCoord } from "../../utils/coordinates";
import type {
  AliveState,
  ChunkData,
  EntityDef as AppEntityDef,
  EntityState as AppEntityState,
  EntityType,
  EventDef,
  Manifest as AppManifest,
  MarkerDef as AppMarkerDef,
  Side,
} from "../types";
import type { DecoderStrategy } from "./decoder.interface";
import { Manifest as FbManifest } from "./generated/fb/manifest";
import { Chunk as FbChunk } from "./generated/fb/chunk";
import { EntityType as FbEntityType } from "./generated/fb/entity-type";
import { Side as FbSide } from "./generated/fb/side";
import type { EntityDef as FbEntityDef } from "./generated/fb/entity-def";
import type { EntityState as FbEntityState } from "./generated/fb/entity-state";
import type { Event as FbEvent } from "./generated/fb/event";
import type { MarkerDef as FbMarkerDef } from "./generated/fb/marker-def";

// ───────── Enum mapping ─────────

const SIDE_MAP: Record<number, Side> = {
  [FbSide.West]: "WEST",
  [FbSide.East]: "EAST",
  [FbSide.Guer]: "GUER",
  [FbSide.Civ]: "CIV",
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

// ───────── Conversion helpers ─────────

function convertEntityDef(fb: FbEntityDef): AppEntityDef {
  let entityType: EntityType;
  const fbType = fb.type();
  const vehicleClass = fb.vehicleClass() ?? "";

  if (fbType === FbEntityType.Unit) {
    entityType = "man";
  } else if (fbType === FbEntityType.Vehicle && vehicleClass) {
    entityType = mapVehicleClass(vehicleClass);
  } else {
    entityType = "unknown";
  }

  const def: AppEntityDef = {
    id: fb.id(),
    type: entityType,
    name: fb.name() ?? "",
    side: SIDE_MAP[fb.side()] ?? "CIV",
    groupName: fb.groupName() ?? "",
    isPlayer: fb.isPlayer(),
    startFrame: fb.startFrame(),
    endFrame: fb.endFrame(),
  };
  const role = fb.role();
  if (role) def.role = role;
  return def;
}

function convertEntityState(fb: FbEntityState): { entityId: number; state: AppEntityState } {
  const state: AppEntityState = {
    position: [fb.posX(), fb.posY()] as ArmaCoord,
    direction: fb.direction(),
    alive: (fb.alive() & 0x3) as AliveState,
  };
  const name = fb.name();
  if (name) state.name = name;
  const crewLen = fb.crewIdsLength();
  if (crewLen > 0) {
    state.crewIds = [];
    for (let i = 0; i < crewLen; i++) {
      state.crewIds.push(fb.crewIds(i)!);
    }
  }
  if (fb.vehicleId()) state.vehicleId = fb.vehicleId();
  if (fb.isInVehicle()) state.isInVehicle = fb.isInVehicle();
  if (fb.isPlayer()) state.isPlayer = fb.isPlayer();
  return { entityId: fb.entityId(), state };
}

function convertEvent(fb: FbEvent): EventDef | null {
  const frameNum = fb.frameNum();
  const type = fb.type() ?? "";

  switch (type) {
    case "hit":
    case "killed":
      return {
        frameNum,
        type,
        victimId: fb.targetId(),
        causedById: fb.sourceId(),
        distance: fb.distance(),
        weapon: fb.weapon() ?? "",
      };
    case "connected":
    case "disconnected":
      return { frameNum, type, unitName: fb.message() ?? "" };
    case "respawnTickets":
    case "counterInit":
    case "counterSet": {
      const msg = fb.message() ?? "";
      return {
        frameNum,
        type,
        data: msg ? msg.split(",").map(Number) : [],
      };
    }
    case "endMission": {
      const msg = fb.message() ?? "";
      return {
        frameNum,
        type,
        side: msg.split(",")[0] ?? "",
        message: msg.split(",").slice(1).join(",") ?? "",
      };
    }
    default:
      return null;
  }
}

function convertMarkerDef(fb: FbMarkerDef): AppMarkerDef {
  const positions: Array<[number, ...any]> = [];
  let alpha = 1;

  for (let i = 0; i < fb.positionsLength(); i++) {
    const p = fb.positions(i)!;
    const lineCoords: number[] = [];
    for (let j = 0; j < p.lineCoordsLength(); j++) {
      lineCoords.push(p.lineCoords(j)!);
    }
    if (i === 0) alpha = p.alpha();
    positions.push([p.frameNum(), p.posX(), p.posY(), p.posZ(), p.direction(), p.alpha(), ...lineCoords]);
  }

  const sizeArr: number[] = [];
  for (let i = 0; i < fb.sizeLength(); i++) {
    sizeArr.push(fb.size(i)!);
  }

  const side = SIDE_MAP[fb.side()] ?? String(fb.side());

  const marker: AppMarkerDef = {
    shape: (fb.shape() || "ICON") as AppMarkerDef["shape"],
    type: fb.type() ?? "",
    side,
    color: fb.color() ?? "",
    positions,
    player: fb.playerId(),
    alpha,
  };
  const text = fb.text();
  if (text) marker.text = text;
  if (sizeArr.length >= 2) marker.size = [sizeArr[0], sizeArr[1]];
  const brush = fb.brush();
  if (brush) marker.brush = brush;
  return marker;
}

// ───────── Public decoder ─────────

export class FlatBuffersDecoder implements DecoderStrategy {
  decodeManifest(buffer: ArrayBuffer): AppManifest {
    const bb = new flatbuffers.ByteBuffer(new Uint8Array(buffer));
    const fb = FbManifest.getRootAsManifest(bb);

    const entities: AppEntityDef[] = [];
    for (let i = 0; i < fb.entitiesLength(); i++) {
      entities.push(convertEntityDef(fb.entities(i)!));
    }

    const times: Array<{ frameNum: number; systemTimeUtc: string }> = [];
    for (let i = 0; i < fb.timesLength(); i++) {
      const t = fb.times(i)!;
      times.push({ frameNum: t.frameNum(), systemTimeUtc: t.systemTimeUtc() ?? "" });
    }

    const events: EventDef[] = [];
    for (let i = 0; i < fb.eventsLength(); i++) {
      const evt = convertEvent(fb.events(i)!);
      if (evt) events.push(evt);
    }

    const markers: AppMarkerDef[] = [];
    for (let i = 0; i < fb.markersLength(); i++) {
      markers.push(convertMarkerDef(fb.markers(i)!));
    }

    return {
      version: fb.version(),
      worldName: fb.worldName() ?? "",
      missionName: fb.missionName() ?? "",
      frameCount: fb.frameCount(),
      chunkSize: fb.chunkSize(),
      captureDelayMs: fb.captureDelayMs(),
      chunkCount: fb.chunkCount(),
      entities,
      events,
      markers,
      times,
      extensionVersion: fb.extensionVersion() ?? undefined,
      addonVersion: fb.addonVersion() ?? undefined,
    };
  }

  decodeChunk(buffer: ArrayBuffer): ChunkData {
    const bb = new flatbuffers.ByteBuffer(new Uint8Array(buffer));
    const chunk = FbChunk.getRootAsChunk(bb);

    const entities = new Map<number, AppEntityState[]>();

    for (let i = 0; i < chunk.framesLength(); i++) {
      const frame = chunk.frames(i)!;
      for (let j = 0; j < frame.entitiesLength(); j++) {
        const { entityId, state } = convertEntityState(frame.entities(j)!);
        let arr = entities.get(entityId);
        if (!arr) {
          arr = [];
          entities.set(entityId, arr);
        }
        arr.push(state);
      }
    }

    return { entities };
  }
}
