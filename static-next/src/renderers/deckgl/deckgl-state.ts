import type { Layer } from "@deck.gl/core";
import type { RenderLayer } from "../renderer.types";

// --------------- Internal data types ---------------

export interface EntityData {
  id: number;
  position: [number, number]; // [lng, lat]
  angle: number;
  iconKey: string; // e.g. "man:blufor", "tank:dead"
  iconType: string;
  opacity: number;
  sizeScale: number;
  name: string;
  isPlayer: boolean;
  visible: boolean; // false if isInVehicle
}

export interface LineData {
  id: number;
  from: [number, number]; // [lng, lat]
  to: [number, number]; // [lng, lat]
  color: [number, number, number, number]; // RGBA 0-255
  width: number;
}

export interface BriefingPolygonData {
  id: number;
  polygon: [number, number][]; // ring of [lng, lat]
  fillColor: [number, number, number, number];
  lineColor: [number, number, number, number];
  stroke: boolean;
}

export interface BriefingPathData {
  id: number;
  path: [number, number][]; // [lng, lat][]
  color: [number, number, number, number];
  width: number;
}

export interface BriefingIconData {
  id: number;
  position: [number, number]; // [lng, lat]
  iconUrl: string;
  size: [number, number];
  angle: number;
  opacity: number;
}

export interface PulseData {
  id: number;
  position: [number, number]; // [lng, lat]
  color: [number, number, number, number];
  fillColor: [number, number, number, number];
  radius: number;
  maxRadius: number;
  animFrameId?: number;
}

// --------------- Color utility ---------------

/**
 * Parse a hex color string to RGBA array for deck.gl.
 * Supports #RGB, #RRGGBB formats.
 */
export function hexToRGBA(hex: string, alpha = 1): [number, number, number, number] {
  let r = 0, g = 0, b = 0;
  const h = hex.replace("#", "");
  if (h.length === 3) {
    r = parseInt(h[0] + h[0], 16);
    g = parseInt(h[1] + h[1], 16);
    b = parseInt(h[2] + h[2], 16);
  } else if (h.length >= 6) {
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  }
  return [r, g, b, Math.round(alpha * 255)];
}

// --------------- State store ---------------

export type FlushCallback = (layers: Layer[]) => void;

export class DeckState {
  entities = new Map<number, EntityData>();
  lines = new Map<number, LineData>();
  briefingPolygons = new Map<number, BriefingPolygonData>();
  briefingPaths = new Map<number, BriefingPathData>();
  briefingIcons = new Map<number, BriefingIconData>();
  pulses = new Map<number, PulseData>();

  enabledLayers = new Set<RenderLayer>([
    "entities",
    "briefingMarkers",
    "systemMarkers",
    "projectileMarkers",
  ]);

  private dirty = false;
  private scheduled = false;
  private flushCallback: FlushCallback;
  private buildLayersFn: () => Layer[];

  constructor(buildLayersFn: () => Layer[], flushCallback: FlushCallback) {
    this.buildLayersFn = buildLayersFn;
    this.flushCallback = flushCallback;
  }

  markDirty(): void {
    this.dirty = true;
    if (!this.scheduled) {
      this.scheduled = true;
      requestAnimationFrame(() => {
        this.scheduled = false;
        if (this.dirty) {
          this.dirty = false;
          this.flushCallback(this.buildLayersFn());
        }
      });
    }
  }

  /** Force an immediate flush (e.g. after layer visibility toggle). */
  flushNow(): void {
    this.dirty = false;
    this.scheduled = false;
    this.flushCallback(this.buildLayersFn());
  }

  private nextLineId = 0;
  allocLineId(): number {
    return this.nextLineId++;
  }

  private nextBriefingId = 0;
  allocBriefingId(): number {
    return this.nextBriefingId++;
  }

  private nextPulseId = 0;
  allocPulseId(): number {
    return this.nextPulseId++;
  }

  dispose(): void {
    // Cancel any pending pulse animations
    for (const pulse of this.pulses.values()) {
      if (pulse.animFrameId) cancelAnimationFrame(pulse.animFrameId);
    }
    this.entities.clear();
    this.lines.clear();
    this.briefingPolygons.clear();
    this.briefingPaths.clear();
    this.briefingIcons.clear();
    this.pulses.clear();
  }
}
