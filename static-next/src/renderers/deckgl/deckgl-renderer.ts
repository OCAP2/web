import maplibregl from "maplibre-gl";
import { MapboxOverlay } from "@deck.gl/mapbox";
import type { Layer } from "@deck.gl/core";
import type { ArmaCoord } from "../../utils/coordinates";
import { METERS_PER_DEGREE } from "../../utils/coordinates";
import { closestEquivalentAngle } from "../../utils/math";
import type { WorldConfig, Side, AliveState } from "../../data/types";
import type { MapRenderer } from "../renderer.interface";
import type {
  MarkerHandle,
  EntityMarkerOpts,
  EntityMarkerState,
  BriefingMarkerHandle,
  BriefingMarkerDef,
  BriefingMarkerState,
  LineHandle,
  LineOpts,
  PulseHandle,
  PulseOpts,
  RenderLayer,
  RendererEvent,
  RendererControls,
} from "../renderer.types";
import { SIDE_CLASS } from "../../config/side-colors";
import {
  DeckState,
  hexToRGBA,
} from "./deckgl-state";
import type {
  EntityData,
  BriefingPolygonData,
  BriefingPathData,
  BriefingIconData,
  PulseData,
} from "./deckgl-state";
import { buildIconAtlas, getIconKey } from "./deckgl-icon-atlas";
import type { IconAtlas } from "./deckgl-icon-atlas";
import {
  buildEntityIconLayer,
  buildEntityLabelLayer,
  buildFireLineLayer,
  buildBriefingPolygonLayer,
  buildBriefingPathLayer,
  buildBriefingIconLayer,
  buildPulseLayer,
} from "./deckgl-layers";
import { getTransitionDuration } from "../shared/transitions";

// --------------- Internal handle types ---------------

interface InternalMarkerHandle {
  id: number;
  lastDirection: number;
}

interface InternalBriefingHandle {
  id: number;
  shape: "ICON" | "ELLIPSE" | "RECTANGLE" | "POLYLINE";
  size?: [number, number];
}

interface InternalLineHandle {
  id: number;
}

interface InternalPulseHandle {
  id: number;
}

function wrapMarker(data: InternalMarkerHandle): MarkerHandle {
  return { _brand: undefined as any, _internal: data } as unknown as MarkerHandle;
}
function unwrapMarker(handle: MarkerHandle): InternalMarkerHandle {
  return (handle as any)._internal as InternalMarkerHandle;
}
function wrapBriefing(data: InternalBriefingHandle): BriefingMarkerHandle {
  return { _brand: undefined as any, _internal: data } as unknown as BriefingMarkerHandle;
}
function unwrapBriefing(handle: BriefingMarkerHandle): InternalBriefingHandle {
  return (handle as any)._internal as InternalBriefingHandle;
}
function wrapLine(data: InternalLineHandle): LineHandle {
  return { _brand: undefined as any, _internal: data } as unknown as LineHandle;
}
function unwrapLine(handle: LineHandle): InternalLineHandle {
  return (handle as any)._internal as InternalLineHandle;
}
function wrapPulse(data: InternalPulseHandle): PulseHandle {
  return { _brand: undefined as any, _internal: data } as unknown as PulseHandle;
}
function unwrapPulse(handle: PulseHandle): InternalPulseHandle {
  return (handle as any)._internal as InternalPulseHandle;
}

// --------------- Coordinate conversion (pure) ---------------

function armaToLngLat(coords: ArmaCoord): [number, number] {
  return [coords[0] / METERS_PER_DEGREE, coords[1] / METERS_PER_DEGREE];
}

function lngLatToArma(lngLat: [number, number]): ArmaCoord {
  return [lngLat[0] * METERS_PER_DEGREE, lngLat[1] * METERS_PER_DEGREE];
}

// --------------- Renderer ---------------

export class DeckGLRenderer implements MapRenderer {
  private map!: maplibregl.Map;
  private overlay!: MapboxOverlay;
  private state!: DeckState;
  private iconAtlas!: IconAtlas;

  private nameDisplayMode: "players" | "all" | "none" = "players";
  private smoothingEnabled = false;
  private smoothingSpeed = 1;

  private listeners = new Map<RendererEvent, Set<(...args: any[]) => void>>();

  // ==================== Lifecycle ====================

  init(container: HTMLElement, world: WorldConfig): void {
    const worldSizeDeg = world.worldSize / METERS_PER_DEGREE;

    // Register PMTiles protocol (idempotent)
    this.registerPMTiles();

    // Resolve font glyph base URL
    const fontsBaseURL = new URL("images/maps/fonts/", window.location.href).href;

    // Build style URL
    const styleUrl = world.tileBaseUrl
      ? `${world.tileBaseUrl}/styles/topo.json`
      : undefined;

    // transformRequest: rewrite glyph requests to Go server's font endpoint
    const transformRequest = (url: string, resourceType?: string) => {
      if (resourceType === "Glyphs") {
        const match = url.match(/([^/]+)\/(\d+-\d+\.pbf)(?:\?|$)/);
        if (match) {
          return { url: fontsBaseURL + match[1] + "/" + match[2] };
        }
      }
    };

    // Create MapLibre map (standalone, no Leaflet)
    this.map = new maplibregl.Map({
      container,
      style: styleUrl ?? {
        version: 8,
        sources: {},
        layers: [{ id: "background", type: "background", paint: { "background-color": "#1a1a2e" } }],
      },
      center: [worldSizeDeg / 2, worldSizeDeg / 2],
      zoom: 12,
      minZoom: 10,
      maxZoom: 20,
      transformRequest,
      attributionControl: {},
      // Disable rotation/pitch: 2D icons have no height axis, so tilting
      // the camera causes them to clip into the ground or get cut off.
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });

    // Initialize state and overlay
    this.state = new DeckState(
      () => this.buildLayers(),
      (layers) => this.overlay.setProps({ layers }),
    );

    this.overlay = new MapboxOverlay({
      layers: [],
      interleaved: false,
    });

    this.map.addControl(this.overlay as any);

    // Build icon atlas async, then trigger first render
    void buildIconAtlas().then((atlas) => {
      this.iconAtlas = atlas;
      this.state.flushNow();
    });

    // Forward map events
    this.map.on("zoomend", () => {
      this.fireEvent("zoom", this.map.getZoom());
    });
    this.map.on("dragstart", () => {
      this.fireEvent("dragstart");
    });
    this.map.on("click", (e) => {
      this.fireEvent("click", lngLatToArma([e.lngLat.lng, e.lngLat.lat]));
    });

    // Fit to world bounds
    this.map.fitBounds(
      [[0, 0], [worldSizeDeg, worldSizeDeg]] as maplibregl.LngLatBoundsLike,
      { animate: false },
    );
  }

  private registerPMTiles(): void {
    if ((window as any)._pmtilesRegistered) return;
    void (async () => {
      try {
        const { Protocol } = await import("pmtiles");
        const protocol = new Protocol();
        maplibregl.addProtocol("pmtiles", protocol.tile);
        (window as any)._pmtilesRegistered = true;
      } catch {
        // PMTiles not available
      }
    })();
  }

  dispose(): void {
    if (this.state) {
      this.state.dispose();
    }
    this.listeners.clear();
    if (this.map) {
      this.map.remove();
    }
  }

  // ==================== Layer building ====================

  private buildLayers(): Layer[] {
    const layers: Layer[] = [];
    const s = this.state;

    if (s.enabledLayers.has("entities") && this.iconAtlas) {
      const entities = Array.from(s.entities.values());
      const transitions = this.smoothingEnabled
        ? { getPosition: { duration: getTransitionDuration(this.smoothingSpeed) * 1000 } }
        : undefined;
      layers.push(buildEntityIconLayer(entities, this.iconAtlas, transitions));
      layers.push(buildEntityLabelLayer(entities, this.nameDisplayMode));
    }

    if (s.enabledLayers.has("projectileMarkers")) {
      const lines = Array.from(s.lines.values());
      if (lines.length > 0) {
        layers.push(buildFireLineLayer(lines));
      }
    }

    if (s.enabledLayers.has("briefingMarkers")) {
      const polygons = Array.from(s.briefingPolygons.values());
      const paths = Array.from(s.briefingPaths.values());
      const icons = Array.from(s.briefingIcons.values());
      if (polygons.length > 0) layers.push(buildBriefingPolygonLayer(polygons));
      if (paths.length > 0) layers.push(buildBriefingPathLayer(paths));
      if (icons.length > 0) layers.push(buildBriefingIconLayer(icons));
    }

    const pulses = Array.from(s.pulses.values());
    if (pulses.length > 0) {
      layers.push(buildPulseLayer(pulses));
    }

    return layers;
  }

  // ==================== Camera ====================

  getZoom(): number {
    return this.map.getZoom();
  }

  setView(armaPos: ArmaCoord, zoom?: number, animate?: boolean): void {
    const center = armaToLngLat(armaPos);
    if (animate ?? true) {
      this.map.flyTo({
        center: center as maplibregl.LngLatLike,
        zoom: zoom ?? this.map.getZoom(),
        duration: 500,
      });
    } else {
      this.map.jumpTo({
        center: center as maplibregl.LngLatLike,
        zoom: zoom ?? this.map.getZoom(),
      });
    }
  }

  fitBounds(sw: ArmaCoord, ne: ArmaCoord): void {
    const swLngLat = armaToLngLat(sw);
    const neLngLat = armaToLngLat(ne);
    this.map.fitBounds(
      [swLngLat, neLngLat] as maplibregl.LngLatBoundsLike,
    );
  }

  getCenter(): ArmaCoord {
    const c = this.map.getCenter();
    return lngLatToArma([c.lng, c.lat]);
  }

  // ==================== Entity markers ====================

  createEntityMarker(id: number, opts: EntityMarkerOpts): MarkerHandle {
    const position = armaToLngLat(opts.position);
    const iconKey = getIconKey(opts.iconType, opts.side, 1);

    const entity: EntityData = {
      id,
      position,
      angle: 0,
      iconKey,
      iconType: opts.iconType,
      opacity: 1,
      sizeScale: 1,
      name: opts.name,
      isPlayer: opts.isPlayer,
      visible: true,
    };

    this.state.entities.set(id, entity);
    this.state.markDirty();

    return wrapMarker({ id, lastDirection: 0 });
  }

  updateEntityMarker(handle: MarkerHandle, state: EntityMarkerState): void {
    const internal = unwrapMarker(handle);
    const entity = this.state.entities.get(internal.id);
    if (!entity) return;

    entity.position = armaToLngLat(state.position);

    // Smooth angle transitions
    const newAngle = closestEquivalentAngle(internal.lastDirection, state.direction);
    entity.angle = newAngle;
    internal.lastDirection = newAngle;

    entity.iconKey = getIconKey(state.iconType, state.side, state.alive);
    entity.iconType = state.iconType;
    entity.opacity = state.alive === 0 ? 0.4 : 1;
    entity.name = state.name;
    entity.isPlayer = state.isPlayer;
    entity.visible = !state.isInVehicle;

    this.state.markDirty();
  }

  removeEntityMarker(handle: MarkerHandle): void {
    const internal = unwrapMarker(handle);
    this.state.entities.delete(internal.id);
    this.state.markDirty();
  }

  // ==================== Briefing markers ====================

  createBriefingMarker(def: BriefingMarkerDef): BriefingMarkerHandle {
    const id = this.state.allocBriefingId();
    const cssColor = `#${def.color}`;

    if (def.shape === "POLYLINE") {
      const pathData: BriefingPathData = {
        id,
        path: [],
        color: hexToRGBA(cssColor, 1),
        width: 2,
      };
      this.state.briefingPaths.set(id, pathData);
    } else if (def.shape === "ELLIPSE" || def.shape === "RECTANGLE") {
      const fillAlpha = this.getBrushFillAlpha(def.brush);
      const polyData: BriefingPolygonData = {
        id,
        polygon: [],
        fillColor: hexToRGBA(cssColor, fillAlpha),
        lineColor: hexToRGBA(cssColor, 1),
        stroke: this.getBrushStroke(def.brush),
      };
      this.state.briefingPolygons.set(id, polyData);
    } else {
      // ICON
      const isMagIcon = def.type.indexOf("magIcons") > -1;
      let iconUrl: string;
      if (isMagIcon) {
        iconUrl = `images/markers/${def.type.toLowerCase()}.png`;
      } else {
        iconUrl = `images/markers/${def.type}/${def.color}.png`;
      }
      const iconSize: [number, number] = def.size
        ? [def.size[0] * 35, def.size[1] * 35]
        : [35, 35];

      const iconData: BriefingIconData = {
        id,
        position: [0, 0],
        iconUrl,
        size: iconSize,
        angle: 0,
        opacity: 1,
      };
      this.state.briefingIcons.set(id, iconData);
    }

    this.state.markDirty();
    return wrapBriefing({ id, shape: def.shape, size: def.size });
  }

  updateBriefingMarker(
    handle: BriefingMarkerHandle,
    state: BriefingMarkerState,
  ): void {
    const internal = unwrapBriefing(handle);

    if (internal.shape === "ICON") {
      const icon = this.state.briefingIcons.get(internal.id);
      if (!icon) return;
      icon.position = armaToLngLat(state.position);
      icon.opacity = state.alpha;
      icon.angle = state.direction;
    } else if (internal.shape === "ELLIPSE") {
      const poly = this.state.briefingPolygons.get(internal.id);
      if (!poly) return;
      const [cx, cy] = state.position;
      const rx = internal.size?.[0] ?? 100;
      const ry = internal.size?.[1] ?? 100;
      const rad = state.direction * (Math.PI / 180);
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);

      const ring: [number, number][] = [];
      for (let i = 0; i < 36; i++) {
        const angle = (i / 36) * 2 * Math.PI;
        const dx = rx * Math.cos(angle);
        const dy = ry * Math.sin(angle);
        ring.push(armaToLngLat([
          cx + cos * dx - sin * dy,
          cy + sin * dx + cos * dy,
        ]));
      }
      poly.polygon = ring;
      poly.fillColor[3] = Math.round(Math.min(poly.fillColor[3] / 255, state.alpha) * 255);
    } else if (internal.shape === "RECTANGLE") {
      const poly = this.state.briefingPolygons.get(internal.id);
      if (!poly) return;
      const [cx, cy] = state.position;
      const sx = internal.size?.[0] ?? 100;
      const sy = internal.size?.[1] ?? 100;
      const rad = state.direction * (Math.PI / 180);
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);

      const corners: [number, number][] = [
        [-sx, +sy], [+sx, +sy], [+sx, -sy], [-sx, -sy],
      ];
      poly.polygon = corners.map(([dx, dy]) =>
        armaToLngLat([
          cx + cos * dx - sin * dy,
          cy + sin * dx + cos * dy,
        ]),
      );
      poly.fillColor[3] = Math.round(Math.min(poly.fillColor[3] / 255, state.alpha) * 255);
    } else if (internal.shape === "POLYLINE" && state.points) {
      const path = this.state.briefingPaths.get(internal.id);
      if (!path) return;
      path.path = state.points.map((p) => armaToLngLat(p));
      path.color[3] = Math.round(state.alpha * 255);
    }

    this.state.markDirty();
  }

  removeBriefingMarker(handle: BriefingMarkerHandle): void {
    const internal = unwrapBriefing(handle);
    this.state.briefingPolygons.delete(internal.id);
    this.state.briefingPaths.delete(internal.id);
    this.state.briefingIcons.delete(internal.id);
    this.state.markDirty();
  }

  // ==================== Briefing helpers ====================

  private getBrushFillAlpha(brush?: string): number {
    switch (brush?.toLowerCase()) {
      case "solidfull": return 0.8;
      case "border": return 0;
      case "solidborder": return 0.3;
      default: return 0.3;
    }
  }

  private getBrushStroke(brush?: string): boolean {
    switch (brush?.toLowerCase()) {
      case "border":
      case "solidborder":
        return true;
      default:
        return false;
    }
  }

  // ==================== Lines ====================

  addLine(from: ArmaCoord, to: ArmaCoord, opts: LineOpts): LineHandle {
    const id = this.state.allocLineId();
    this.state.lines.set(id, {
      id,
      from: armaToLngLat(from),
      to: armaToLngLat(to),
      color: hexToRGBA(opts.color, opts.opacity),
      width: opts.weight,
    });
    this.state.markDirty();
    return wrapLine({ id });
  }

  removeLine(handle: LineHandle): void {
    const internal = unwrapLine(handle);
    this.state.lines.delete(internal.id);
    this.state.markDirty();
  }

  // ==================== Pulses ====================

  addPulse(pos: ArmaCoord, opts: PulseOpts): PulseHandle {
    const id = this.state.allocPulseId();
    const maxRadius = Math.max(opts.iconSize[0], opts.iconSize[1]) / 2;
    const pulse: PulseData = {
      id,
      position: armaToLngLat(pos),
      color: hexToRGBA(opts.color, 1),
      fillColor: hexToRGBA(opts.fillColor, 0.5),
      radius: 0,
      maxRadius,
    };
    this.state.pulses.set(id, pulse);

    // Animate radius expansion
    const iterations = opts.iterationCount ?? 3;
    const durationMs = 800;
    let iteration = 0;
    const startTime = performance.now();

    const animate = () => {
      const elapsed = performance.now() - startTime;
      const cycleProgress = (elapsed % durationMs) / durationMs;
      iteration = Math.floor(elapsed / durationMs);

      if (iteration >= iterations) {
        this.state.pulses.delete(id);
        this.state.markDirty();
        return;
      }

      pulse.radius = cycleProgress * maxRadius;
      pulse.fillColor[3] = Math.round((1 - cycleProgress) * 128);
      this.state.markDirty();
      pulse.animFrameId = requestAnimationFrame(animate);
    };
    pulse.animFrameId = requestAnimationFrame(animate);

    this.state.markDirty();
    return wrapPulse({ id });
  }

  removePulse(handle: PulseHandle): void {
    const internal = unwrapPulse(handle);
    const pulse = this.state.pulses.get(internal.id);
    if (pulse?.animFrameId) cancelAnimationFrame(pulse.animFrameId);
    this.state.pulses.delete(internal.id);
    this.state.markDirty();
  }

  // ==================== Layer visibility ====================

  setLayerVisible(layer: RenderLayer, visible: boolean): void {
    if (visible) {
      this.state.enabledLayers.add(layer);
    } else {
      this.state.enabledLayers.delete(layer);
    }
    this.state.flushNow();
  }

  // ==================== Settings ====================

  setSmoothingEnabled(enabled: boolean, speed?: number): void {
    this.smoothingEnabled = enabled;
    if (speed !== undefined) {
      this.smoothingSpeed = speed;
    }
    this.state.markDirty();
  }

  setNameDisplayMode(mode: "players" | "all" | "none"): void {
    this.nameDisplayMode = mode;
    this.state.markDirty();
  }

  // ==================== Events ====================

  on(event: RendererEvent, cb: (...args: any[]) => void): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(cb);
  }

  off(event: RendererEvent, cb: (...args: any[]) => void): void {
    this.listeners.get(event)?.delete(cb);
  }

  private fireEvent(event: RendererEvent, ...args: any[]): void {
    const set = this.listeners.get(event);
    if (set) {
      for (const cb of set) {
        cb(...args);
      }
    }
  }

  // ==================== Controls ====================

  getControls(): RendererControls {
    return {
      container: this.map?.getContainer(),
    };
  }
}
