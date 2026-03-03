import type { ArmaCoord } from "../utils/coordinates";
import type { Side, AliveState } from "../data/types";

// --------------- Opaque handle types ---------------

/* eslint-disable @typescript-eslint/no-unused-vars -- brand symbols are used only via typeof */
declare const markerBrand: unique symbol;
/** Opaque handle returned by createEntityMarker. */
export type MarkerHandle = { readonly _brand: typeof markerBrand; _internal: unknown };

declare const briefingMarkerBrand: unique symbol;
/** Opaque handle returned by createBriefingMarker. */
export type BriefingMarkerHandle = {
  readonly _brand: typeof briefingMarkerBrand;
  _internal: unknown;
};

declare const lineBrand: unique symbol;
/** Opaque handle returned by addLine. */
export type LineHandle = { readonly _brand: typeof lineBrand; _internal: unknown };

/* eslint-enable @typescript-eslint/no-unused-vars */

// --------------- Entity markers ---------------

/** Crew info for vehicles — renderer decides how to display. */
export interface CrewInfo {
  /** Total crew count (players + AI). */
  count: number;
  /** Player crew member names only. */
  names: string[];
}

export interface EntityMarkerOpts {
  position: ArmaCoord;
  direction: number;
  iconType: string;
  side: Side | null;
  name: string;
  isPlayer: boolean;
  crew?: CrewInfo;
}

export interface EntityMarkerState {
  position: ArmaCoord;
  direction: number;
  alive: AliveState;
  side: Side | null;
  name: string;
  iconType: string;
  isPlayer: boolean;
  isInVehicle: boolean;
  /** When true, show the "hit" flash icon instead of the normal side icon. */
  hit?: boolean;
  crew?: CrewInfo;
}

// --------------- Briefing markers ---------------

export interface BriefingMarkerDef {
  shape: "ICON" | "ELLIPSE" | "RECTANGLE" | "POLYLINE";
  type: string;
  color: string;
  text?: string;
  side: string;
  size?: [number, number];
  brush?: string;
  /** Which layer group to add this marker to. Defaults to "briefingMarkers". */
  layer?: "briefingMarkers" | "systemMarkers" | "projectileMarkers";
}

export interface BriefingMarkerState {
  position: ArmaCoord;
  direction: number;
  alpha: number;
  points?: ArmaCoord[];
}

// --------------- Lines ---------------

export interface LineOpts {
  color: string;
  weight: number;
  opacity: number;
}

// --------------- Enums & config ---------------

export type RenderLayer =
  | "entities"
  | "briefingMarkers"
  | "systemMarkers"
  | "projectileMarkers"
  | "grid"
  | "mapIcons"
  | "buildings3D";

export interface MapStyleInfo {
  label: string;
  available: boolean;
  previewUrl?: string;
}

export type RendererEvent = "zoom" | "dragstart" | "click";

export interface RendererControls {
  container?: HTMLElement;
}
