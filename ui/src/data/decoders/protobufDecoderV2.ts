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
  SoldierScores,
  TelemetrySample,
} from "../types";
import type { DecoderStrategy } from "./decoder.interface";
import { ProtobufDecoder, convertEvent as convertV1Event } from "./protobufDecoder";
import { Event as V1Event } from "./generated/ocap.pb";
import { extractRadioPropagation } from "../radioPropagation";
import {
  Manifest as PbManifest,
  Chunk as PbChunk,
  Side as PbSide,
  type SoldierDef as PbSoldierDef,
  type VehicleDef as PbVehicleDef,
  type SoldierState as PbSoldierState,
  type VehicleState as PbVehicleState,
  type Event as PbEvent,
  type MarkerDef as PbMarkerDef,
  type MarkerPosition as PbMarkerPosition,
  type Position3D as PbPosition3D,
} from "./generated/v2/ocap_v2";

// ───────── Enum mapping ─────────

const SIDE_MAP: Record<number, Side> = {
  [PbSide.SIDE_WEST]: "WEST",
  [PbSide.SIDE_EAST]: "EAST",
  [PbSide.SIDE_GUER]: "GUER",
  [PbSide.SIDE_CIV]: "CIV",
};

const MARKER_SIDE_MAP: Record<number, string> = {
  [PbSide.SIDE_UNKNOWN]: "GLOBAL", // markers without a side are visible to all
  ...SIDE_MAP,
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

function mapSideString(raw: string): Side {
  switch (raw) {
    case "WEST": return "WEST";
    case "EAST": return "EAST";
    case "GUER":
    case "INDEPENDENT": return "GUER";
    case "CIV":
    case "CIVILIAN": return "CIV";
    case "VIRTUAL":
    case "LOGIC": return "VIRTUAL";
    default: return "CIV";
  }
}

function posToArma(p: PbPosition3D | undefined): ArmaCoord {
  if (!p) return [0, 0, 0];
  return [p.x, p.y, p.z];
}

// ───────── Entity conversions ─────────

function convertSoldierDef(pb: PbSoldierDef): AppEntityDef {
  const def: AppEntityDef = {
    id: pb.id,
    type: "man",
    name: pb.name,
    side: SIDE_MAP[pb.side] ?? "CIV",
    groupName: pb.groupName,
    isPlayer: pb.isPlayer,
    startFrame: pb.startFrame,
    endFrame: pb.endFrame,
  };
  if (pb.role) def.role = pb.role;
  if (pb.framesFired.length > 0) {
    def.framesFired = pb.framesFired.map((ff) => [
      ff.frameNum,
      posToArma(ff.endPos),
    ]);
  }
  return def;
}

function convertVehicleDef(pb: PbVehicleDef): AppEntityDef {
  return {
    id: pb.id,
    type: mapVehicleClass(pb.vehicleClass),
    name: pb.name,
    side: "CIV", // Vehicles don't have a side in their definition
    groupName: "",
    isPlayer: false,
    startFrame: pb.startFrame,
    endFrame: pb.endFrame,
  };
}

function convertSoldierState(pb: PbSoldierState): AppEntityState {
  const state: AppEntityState = {
    position: posToArma(pb.position),
    direction: pb.bearing,
    alive: (pb.lifestate & 0x3) as AliveState,
    isPlayer: pb.isPlayer,
    isInVehicle: pb.inVehicle,
    vehicleId: pb.inVehicle ? pb.vehicleId : undefined,
    hasStableVitals: pb.hasStableVitals,
    isDraggedCarried: pb.isDraggedCarried,
  };
  if (pb.name) state.name = pb.name;
  if (pb.vehicleId) state.vehicleId = pb.vehicleId;
  if (pb.inVehicle) state.isInVehicle = pb.inVehicle;
  if (pb.isPlayer) state.isPlayer = pb.isPlayer;
  if (pb.groupName) state.groupName = pb.groupName;
  if (pb.side) state.side = mapSideString(pb.side);
  if (pb.role) state.role = pb.role;
  // v2 extensions
  if (pb.vehicleRole) state.vehicleRole = pb.vehicleRole;
  if (pb.stance) state.stance = pb.stance;
  if (pb.hasStableVitals) state.hasStableVitals = pb.hasStableVitals;
  if (pb.isDraggedCarried) state.isDraggedCarried = pb.isDraggedCarried;
  if (pb.scores) {
    state.scores = {
      infantryKills: pb.scores.infantryKills,
      vehicleKills: pb.scores.vehicleKills,
      armorKills: pb.scores.armorKills,
      airKills: pb.scores.airKills,
      deaths: pb.scores.deaths,
      totalScore: pb.scores.totalScore,
    } satisfies SoldierScores;
  }
  return state;
}

function convertVehicleState(pb: PbVehicleState): AppEntityState {
  const state: AppEntityState = {
    position: posToArma(pb.position),
    direction: pb.bearing,
    alive: (pb.alive ? 1 : 0) as AliveState,
    crewIds: [...pb.crewIds],
    fuel:pb.fuel, damage:pb.damage, locked:pb.locked, engineOn:pb.engineOn,
    turretAzimuth:pb.turretAzimuth,turretElevation:pb.turretElevation,
  };
  if (pb.crewIds.length > 0) state.crewIds = [...pb.crewIds];
  if (pb.side) state.side = mapSideString(pb.side);
  // v2 extensions
  if (pb.fuel !== 0) state.fuel = pb.fuel;
  if (pb.damage !== 0) state.damage = pb.damage;
  if (pb.locked) state.locked = pb.locked;
  if (pb.engineOn) state.engineOn = pb.engineOn;
  if (pb.turretAzimuth !== 0) state.turretAzimuth = pb.turretAzimuth;
  if (pb.turretElevation !== 0) state.turretElevation = pb.turretElevation;
  return state;
}

// ───────── Event conversions ─────────

function convertEvent(pb: PbEvent): EventDef | null {
  const { frameNum } = pb;

  if (pb.kill) {
    const k = pb.kill;
    return {
      frameNum,
      type: "killed",
      victimId: k.victimIsVehicle ? k.victimVehicleId : k.victimSoldierId,
      causedById: k.killerIsVehicle ? k.killerVehicleId : k.killerSoldierId,
      distance: k.distance,
      weapon: k.eventText || k.weaponName,
    };
  }
  if (pb.hit) {
    const h = pb.hit;
    return {
      frameNum,
      type: "hit",
      victimId: h.victimIsVehicle ? h.victimVehicleId : h.victimSoldierId,
      causedById: h.shooterIsVehicle ? h.shooterVehicleId : h.shooterSoldierId,
      distance: h.distance,
      weapon: h.eventText || h.weaponName,
    };
  }
  if (pb.connect) {
    return {
      frameNum,
      type: pb.connect.isConnect ? "connected" : "disconnected",
      unitName: pb.connect.unitName,
    };
  }
  if (pb.endMission) {
    return {
      frameNum,
      type: "endMission",
      side: pb.endMission.side,
      message: pb.endMission.message,
    };
  }
  if (pb.telemetry) {
    // Telemetry is performance/metrics data, not a gameplay event.
    // Extracted separately into manifest.telemetry for metrics display.
    return null;
  }
  if (pb.radio) {
    const r=pb.radio;
    return convertV1Event(V1Event.fromPartial({frameNum,type:"radioTransmission",message:JSON.stringify({unitId:r.soldierId,radio:r.radio,type:r.radioType,action:r.startEnd,channel:r.channel,additional:r.isAdditional,frequency:r.frequency,code:r.code})}));
  }
  if (pb.general) {
    const g=pb.general;
    let extra: Record<string, any>={};
    if(g.extraDataJson.length) { try { extra=JSON.parse(new TextDecoder().decode(g.extraDataJson)); } catch { /* Older files need no extra data. */ } }
    const position=extra?.position;
    return convertV1Event(V1Event.fromPartial({frameNum,type:g.name,message:g.message,objectType:g.objectType,unitName:g.unitName,side:g.side || extra?.side,posX:Array.isArray(position)?position[0]:0,posY:Array.isArray(position)?position[1]:0}));
  }
  if (pb.chat) {
    return {
      frameNum,
      type: "generalEvent",
      message: `[${pb.chat.channel}] ${pb.chat.fromName}: ${pb.chat.message}`,
    };
  }
  return null;
}

// ───────── Marker conversions ─────────

function convertMarkerPosition(pb: PbMarkerPosition): [number, ...any] {
  const style = pb.hasStyle ? [pb.text,pb.color,pb.size.length>=2 ? [pb.size[0],pb.size[1]] : undefined,pb.type,pb.brush,pb.shape] : [];
  if (pb.lineCoords.length > 0) {
    const points: number[][] = [];
    for (let i=0;i<pb.lineCoords.length-1;i+=2) points.push([pb.lineCoords[i],pb.lineCoords[i+1]]);
    return [pb.frameNum, points, pb.direction, pb.alpha,...style];
  }
  const pos = pb.position;
  return [
    pb.frameNum,
    pos ? [pos.x,pos.y,pos.z] : [0,0,0],
    pb.direction,
    pb.alpha,
    ...style,
  ];
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
    endFrame: pb.deletedFrame ?? (pb.endFrame || -1),
  };
  if (pb.text) marker.text = pb.text;
  if (pb.size.length >= 2) marker.size = [pb.size[0], pb.size[1]];
  if (pb.brush) marker.brush = pb.brush;
  return marker;
}

// ───────── Public decoder ─────────

export class ProtobufDecoderV2 implements DecoderStrategy {
  decodePlayerSnapshots(buffer: ArrayBuffer): EventDef[] {
    return new ProtobufDecoder().decodePlayerSnapshots(buffer);
  }

  decodeManifest(buffer: ArrayBuffer): AppManifest {
    const pb = PbManifest.decode(new Uint8Array(buffer));

    // Merge soldier + vehicle defs into a single entities array.
    const entities: AppEntityDef[] = [
      ...pb.soldiers.map(convertSoldierDef),
      ...pb.vehicles.map(convertVehicleDef),
    ];

    const manifest: AppManifest = {
      version: pb.version,
      worldName: pb.world?.worldName ?? "",
      missionName: pb.mission?.missionName ?? "",
      endFrame: Math.max(0,pb.frameCount-1),
      chunkSize: pb.chunkSize,
      captureDelayMs: pb.captureDelayMs,
      chunkCount: pb.chunkCount,
      entities,
      events: pb.events.map(convertEvent).filter((e): e is EventDef => e !== null),
      markers: pb.markers.map(convertMarkerDef),
      times: pb.times.map((t) => ({
        frameNum: t.frameNum,
        systemTimeUtc: t.systemTimeUtc,
        date: t.date || undefined,
        timeMultiplier: t.timeMultiplier || undefined,
      })),
      extensionVersion: pb.mission?.extensionVersion || undefined,
      addonVersion: pb.mission?.addonVersion || undefined,
      snapshotUnitIds: pb.snapshotUnitIds,
    };

    const extracted=extractRadioPropagation(manifest.events);
    manifest.events=extracted.events;
    manifest.radioPropagation=extracted.radioPropagation;
    manifest.acrePropagation=extracted.acrePropagation;
    // When the addon records native serverFps/weather general events, they are
    // the single source; telemetry-derived samples would duplicate them.
    const nativeFps = pb.events.some((e) => e.general?.name === "serverFps");
    const nativeWeather = pb.events.some((e) => e.general?.name === "weather");
    for (const event of pb.events) {
      if (event.telemetry) {
        const t=event.telemetry;
        if (!nativeFps) {
          manifest.events.push({frameNum:event.frameNum,type:"serverFps",fps:t.fpsAverage});
        }
        if (!nativeWeather && t.weather) {
          const weather=convertV1Event(V1Event.fromPartial({frameNum:event.frameNum,type:"weather",message:JSON.stringify(t.weather)}));
          if (weather) manifest.events.push(weather);
        }
      }
    }

    // Extract telemetry data (separate from gameplay events).
    const telemetrySamples: TelemetrySample[] = [];
    for (const e of pb.events) {
      if (e.telemetry) {
        const t = e.telemetry;
        telemetrySamples.push({
          frameNum: e.frameNum,
          fpsAverage: t.fpsAverage,
          fpsMin: t.fpsMin,
          globalCounts: t.globalCounts ? {
            unitsAlive: t.globalCounts.unitsAlive,
            unitsDead: t.globalCounts.unitsDead,
            groups: t.globalCounts.groups,
            vehicles: t.globalCounts.vehicles,
            weaponHolders: t.globalCounts.weaponHolders,
            playersAlive: t.globalCounts.playersAlive,
            playersDead: t.globalCounts.playersDead,
            playersConnected: t.globalCounts.playersConnected,
          } : undefined,
          weather: t.weather ? {
            fog: t.weather.fog,
            overcast: t.weather.overcast,
            rain: t.weather.rain,
          } : undefined,
          playerCount: t.players.length,
        });
      }
    }
    if (telemetrySamples.length > 0) {
      manifest.telemetry = telemetrySamples;
    }

    // v2 world metadata.
    if (pb.world) {
      manifest.world = {
        worldSize: pb.world.worldSize || undefined,
        latitude: pb.world.latitude || undefined,
        longitude: pb.world.longitude || undefined,
        author: pb.world.author || undefined,
        displayName: pb.world.displayName || undefined,
      };
    }

    // v2 mission metadata.
    if (pb.mission) {
      manifest.mission = {
        serverName: pb.mission.serverName || undefined,
        briefingName: pb.mission.briefingName || undefined,
        extensionBuild: pb.mission.extensionBuild || undefined,
      };
      if (pb.mission.playableSlots) {
        manifest.mission.playableSlots = {
          west: pb.mission.playableSlots.west,
          east: pb.mission.playableSlots.east,
          independent: pb.mission.playableSlots.independent,
          civilian: pb.mission.playableSlots.civilian,
        };
      }
      if (pb.mission.sideFriendly) {
        manifest.mission.sideFriendly = {
          eastWest: pb.mission.sideFriendly.eastWest,
          eastIndependent: pb.mission.sideFriendly.eastIndependent,
          westIndependent: pb.mission.sideFriendly.westIndependent,
        };
      }
      if (pb.mission.addons.length > 0) {
        manifest.mission.addons = pb.mission.addons.map((a) => ({
          name: a.name,
          workshopId: a.workshopId,
        }));
      }
    }

    if (pb.mission?.author) {
      manifest.missionAuthor = pb.mission.author;
    }

    manifest.events.sort((a,b)=>a.frameNum-b.frameNum);
    return manifest;
  }

  decodeChunk(buffer: ArrayBuffer): ChunkData {
    const pb = PbChunk.decode(new Uint8Array(buffer));

    const entities = new Map<number, AppEntityState[]>();
    for (const frame of pb.frames) {
      const idx = frame.frameNum - pb.startFrame;

      // Process soldier states.
      for (const raw of frame.soldiers) {
        let arr = entities.get(raw.id);
        if (!arr) {
          arr = new Array(pb.frameCount);
          entities.set(raw.id, arr);
        }
        arr[idx] = convertSoldierState(raw);
      }

      // Process vehicle states.
      for (const raw of frame.vehicles) {
        let arr = entities.get(raw.id);
        if (!arr) {
          arr = new Array(pb.frameCount);
          entities.set(raw.id, arr);
        }
        arr[idx] = convertVehicleState(raw);
      }
    }

    // v2 stores changes and a seed at each chunk boundary. Expand within this
    // chunk for the existing playback engine, keeping the on-disk format sparse.
    for (const states of entities.values()) {
      let previous: AppEntityState | undefined;
      for (let i=0;i<states.length;i++) { if(states[i]) previous=states[i];else if(previous) states[i]=previous; }
    }
    return { entities };
  }
}
