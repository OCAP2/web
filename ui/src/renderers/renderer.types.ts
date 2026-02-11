import type { ArmaCoord } from "../utils/coordinates";
import type { Side, AliveState } from "../data/types";

// --------------- Opaque handle types ---------------

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

declare const pulseBrand: unique symbol;
/** Opaque handle returned by addPulse. */
export type PulseHandle = { readonly _brand: typeof pulseBrand; _internal: unknown };

// --------------- Entity markers ---------------

export interface EntityMarkerOpts {
  position: ArmaCoord;
  iconType: string;
  side: Side | null;
  name: string;
  isPlayer: boolean;
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
}

export interface BriefingMarkerState {
  position: ArmaCoord;
  direction: number;
  alpha: number;
  points?: ArmaCoord[];
}

// --------------- Lines & pulses ---------------

export interface LineOpts {
  color: string;
  weight: number;
  opacity: number;
}

export interface PulseOpts {
  color: string;
  fillColor: string;
  iconSize: [number, number];
  iterationCount?: number;
}

// --------------- Enums & config ---------------

export type RenderLayer =
  | "entities"
  | "briefingMarkers"
  | "systemMarkers"
  | "projectileMarkers"
  | "grid";

export type RendererEvent = "zoom" | "dragstart" | "click";

export interface RendererControls {
  container?: HTMLElement;
}
