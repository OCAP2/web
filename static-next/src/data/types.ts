import type { ArmaCoord } from "../utils/coordinates";

/** Faction side. */
export type Side = "WEST" | "EAST" | "GUER" | "CIV";

/** Entity class used for icon/behavior selection. */
export type EntityType =
  | "man"
  | "car"
  | "tank"
  | "apc"
  | "truck"
  | "ship"
  | "heli"
  | "plane"
  | "parachute"
  | "staticWeapon"
  | "staticMortar"
  | "unknown";

/** 0 = dead, 1 = alive, 2 = unconscious */
export type AliveState = 0 | 1 | 2;

/** Static definition of an entity loaded from the manifest. */
export interface EntityDef {
  id: number;
  type: EntityType;
  name: string;
  side: Side;
  groupName: string;
  isPlayer: boolean;
  startFrame: number;
  endFrame: number;
  role?: string;
  framesFired?: Array<[number, ArmaCoord]>;
  /** Per-frame states, populated by JSON decoder (not used by streaming decoders). */
  positions?: EntityState[];
}

/** Per-frame state of an entity within a chunk. */
export interface EntityState {
  position: ArmaCoord;
  direction: number;
  alive: AliveState;
  name?: string;
  /** IDs of crew members (for vehicles). */
  crewIds?: number[];
  /** Vehicle ID this entity is riding in. */
  vehicleId?: number;
  /** Whether this entity is currently inside a vehicle. */
  isInVehicle?: boolean;
  /** Whether this entity is a player this frame. */
  isPlayer?: boolean;
}

// --------------- Event discriminated union ---------------

export interface HitKilledEventDef {
  type: "hit" | "killed";
  victimId: number;
  causedById: number;
  distance: number;
  weapon: string;
}

export interface ConnectEventDef {
  type: "connected" | "disconnected";
  unitName: string;
}

export interface CounterEventDef {
  type: "respawnTickets" | "counterInit" | "counterSet";
  data: number[];
}

export interface EndMissionEventDef {
  type: "endMission";
  side: string;
  message: string;
}

export interface GeneralEventDef {
  type: "generalEvent";
  message: string;
}

export interface CapturedEventDef {
  type: "captured" | "capturedFlag";
  unitName: string;
  objectType: string;
}

export interface TerminalHackEventDef {
  type: "terminalHackStarted" | "terminalHackCanceled";
  unitName: string;
}

export type EventDef = { frameNum: number } & (
  | HitKilledEventDef
  | ConnectEventDef
  | CounterEventDef
  | EndMissionEventDef
  | GeneralEventDef
  | CapturedEventDef
  | TerminalHackEventDef
);

// --------------- Markers ---------------

export interface MarkerDef {
  shape: "ICON" | "ELLIPSE" | "RECTANGLE" | "POLYLINE";
  type: string;
  text?: string;
  side: string;
  color: string;
  size?: [number, number];
  positions: Array<[number, ...any]>;
  player: number;
  alpha: number;
  brush?: string;
  startFrame: number;
  endFrame: number;
}

// --------------- Top-level structures ---------------

export interface Manifest {
  version: number;
  worldName: string;
  missionName: string;
  missionAuthor?: string;
  frameCount: number;
  chunkSize: number;
  captureDelayMs: number;
  chunkCount: number;
  entities: EntityDef[];
  events: EventDef[];
  markers: MarkerDef[];
  times: Array<{ frameNum: number; systemTimeUtc: string }>;
  extensionVersion?: string;
  addonVersion?: string;
}

/** A decoded chunk: entity ID -> array of states for this chunk's frames. */
export interface ChunkData {
  entities: Map<number, EntityState[]>;
}

/** Summary row returned by the operations list API. */
export interface Operation {
  id: string;
  worldName: string;
  missionName: string;
  missionDuration: number;
  date: string;
  tag?: string;
  filename?: string;
  storageFormat?: string;
  conversionStatus?: string;
  schemaVersion?: number;
  chunkCount?: number;
}

/** Per-world map configuration (from map.json). */
export interface WorldConfig {
  worldName: string;
  worldSize: number;
  imageSize?: number;
  maxZoom: number;
  minZoom: number;
  tileSize?: number;
  multiplier?: number;
  /** True when MapLibre + PMTiles rendering is available for this world. */
  maplibre?: boolean;
  /** Base URL for tile assets (set during probing). */
  tileBaseUrl?: string;
  /** Raster layer availability flags (from map.json). */
  hasTopo?: boolean;
  hasTopoDark?: boolean;
  hasTopoRelief?: boolean;
  hasColorRelief?: boolean;
  attribution?: string;
}
