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

  // Per-collection revision counters. Bumped when data changes;
  // used as deck.gl updateTriggers so it only diffs when needed.
  entityRevision = 0;
  lineRevision = 0;
  briefingRevision = 0;
  pulseRevision = 0;

  // Cached data arrays — only rebuilt when the collection is dirty.
  // deck.gl compares data by reference; reusing the same array avoids
  // a full re-upload to the GPU.
  private _entityArray: EntityData[] = [];
  private _entityArrayDirty = true;
  private _visibleEntityArray: EntityData[] = [];

  private _lineArray: LineData[] = [];
  private _lineArrayDirty = true;

  private _briefingPolygonArray: BriefingPolygonData[] = [];
  private _briefingPathArray: BriefingPathData[] = [];
  private _briefingIconArray: BriefingIconData[] = [];
  private _briefingArrayDirty = true;

  private _pulseArray: PulseData[] = [];
  private _pulseArrayDirty = true;

  private dirty = false;
  private scheduled = false;
  private flushCallback: FlushCallback;
  private buildLayersFn: () => Layer[];

  constructor(buildLayersFn: () => Layer[], flushCallback: FlushCallback) {
    this.buildLayersFn = buildLayersFn;
    this.flushCallback = flushCallback;
  }

  /** Mark entity data as changed. */
  dirtyEntities(): void {
    this._entityArrayDirty = true;
    this.entityRevision++;
    this.scheduleDirty();
  }

  /** Mark line data as changed. */
  dirtyLines(): void {
    this._lineArrayDirty = true;
    this.lineRevision++;
    this.scheduleDirty();
  }

  /** Mark briefing data as changed. */
  dirtyBriefing(): void {
    this._briefingArrayDirty = true;
    this.briefingRevision++;
    this.scheduleDirty();
  }

  /** Mark pulse data as changed. */
  dirtyPulses(): void {
    this._pulseArrayDirty = true;
    this.pulseRevision++;
    this.scheduleDirty();
  }

  /** Schedule a flush on the next animation frame. */
  private scheduleDirty(): void {
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

  /** @deprecated Use dirtyEntities/dirtyLines/etc. for granular invalidation. */
  markDirty(): void {
    this.scheduleDirty();
  }

  /** Force an immediate flush (e.g. after layer visibility toggle). */
  flushNow(): void {
    this.dirty = false;
    this.scheduled = false;
    // Invalidate all caches so buildLayers picks up current state
    this._entityArrayDirty = true;
    this._lineArrayDirty = true;
    this._briefingArrayDirty = true;
    this._pulseArrayDirty = true;
    this.flushCallback(this.buildLayersFn());
  }

  // --------------- Cached array accessors ---------------

  getEntityArray(): EntityData[] {
    if (this._entityArrayDirty) {
      this._entityArray = Array.from(this.entities.values());
      this._visibleEntityArray = this._entityArray.filter((e) => e.visible);
      this._entityArrayDirty = false;
    }
    return this._entityArray;
  }

  getVisibleEntityArray(): EntityData[] {
    if (this._entityArrayDirty) {
      this.getEntityArray(); // rebuilds both
    }
    return this._visibleEntityArray;
  }

  getLineArray(): LineData[] {
    if (this._lineArrayDirty) {
      this._lineArray = Array.from(this.lines.values());
      this._lineArrayDirty = false;
    }
    return this._lineArray;
  }

  getBriefingPolygonArray(): BriefingPolygonData[] {
    if (this._briefingArrayDirty) {
      this._rebuildBriefingArrays();
    }
    return this._briefingPolygonArray;
  }

  getBriefingPathArray(): BriefingPathData[] {
    if (this._briefingArrayDirty) {
      this._rebuildBriefingArrays();
    }
    return this._briefingPathArray;
  }

  getBriefingIconArray(): BriefingIconData[] {
    if (this._briefingArrayDirty) {
      this._rebuildBriefingArrays();
    }
    return this._briefingIconArray;
  }

  private _rebuildBriefingArrays(): void {
    this._briefingPolygonArray = Array.from(this.briefingPolygons.values());
    this._briefingPathArray = Array.from(this.briefingPaths.values());
    this._briefingIconArray = Array.from(this.briefingIcons.values());
    this._briefingArrayDirty = false;
  }

  getPulseArray(): PulseData[] {
    if (this._pulseArrayDirty) {
      this._pulseArray = Array.from(this.pulses.values());
      this._pulseArrayDirty = false;
    }
    return this._pulseArray;
  }

  // --------------- ID allocators ---------------

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
