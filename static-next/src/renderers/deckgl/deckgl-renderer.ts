import { Deck, FlyToInterpolator, WebMercatorViewport } from "@deck.gl/core";
import type { Layer, MapViewState } from "@deck.gl/core";
import { PMTiles } from "pmtiles";
import type { ArmaCoord } from "../../utils/coordinates";
import { METERS_PER_DEGREE } from "../../utils/coordinates";
import { closestEquivalentAngle } from "../../utils/math";
import type { WorldConfig } from "../../data/types";
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
import { parseStyleDocument } from "./deckgl-style-parser";
import type { CompiledStyle } from "./deckgl-style-parser";
import { buildBasemapLayers, loadSpriteAtlas, createVectorTileDataFetcher } from "./deckgl-basemap";
import type { SpriteAtlas } from "./deckgl-basemap";
import { ScaleControl } from "./deckgl-scale-control";

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
  private deck!: Deck;
  private container!: HTMLElement;
  private state!: DeckState;
  private iconAtlas!: IconAtlas;
  private scaleControl!: ScaleControl;

  private viewState!: MapViewState;
  private worldSizeDeg = 0;
  private lastIntZoom = 0;

  // Basemap
  private compiledStyle: CompiledStyle | null = null;
  private spriteAtlas: SpriteAtlas | null = null;
  private vectorPMTiles: PMTiles | null = null;
  private vectorMaxZoom = 14;
  private vectorGetTileData: ((opts: any) => Promise<any>) | null = null;
  private basemapLayers: Layer[] = [];

  private nameDisplayMode: "players" | "all" | "none" = "players";
  private smoothingEnabled = false;
  private smoothingSpeed = 1;

  private listeners = new Map<RendererEvent, Set<(...args: any[]) => void>>();

  // ==================== Lifecycle ====================

  init(container: HTMLElement, world: WorldConfig): void {
    this.container = container;
    this.worldSizeDeg = world.worldSize / METERS_PER_DEGREE;

    const centerLng = this.worldSizeDeg / 2;
    const centerLat = this.worldSizeDeg / 2;

    this.viewState = {
      longitude: centerLng,
      latitude: centerLat,
      zoom: 12,
      pitch: 0,
      bearing: 0,
    };
    this.lastIntZoom = 12;

    // Initialize state (callbacks wired after deck creation)
    this.state = new DeckState(
      () => this.buildLayers(),
      (layers) => this.deck.setProps({ layers }),
    );

    // Create standalone Deck
    this.deck = new Deck({
      parent: container as HTMLDivElement,
      initialViewState: this.viewState,
      controller: {
        dragRotate: false,
        touchRotate: false,
        keyboard: { moveSpeed: 100 },
        minZoom: 10,
        maxZoom: 20,
      },
      onViewStateChange: ({ viewState }: { viewState: MapViewState }) => {
        this.viewState = viewState;

        // Rebuild basemap layers on integer zoom change.
        // Use RAF-batched markDirty() instead of synchronous flushNow()
        // to avoid blocking the zoom gesture handler.
        const intZoom = Math.floor(viewState.zoom);
        if (intZoom !== this.lastIntZoom) {
          this.lastIntZoom = intZoom;
          this.rebuildBasemap();
          this.state.markDirty();
          this.fireEvent("zoom", viewState.zoom);
        }

        this.scaleControl?.update(viewState.zoom);
      },
      onDragStart: () => {
        this.fireEvent("dragstart");
      },
      onClick: (info: any) => {
        if (info.coordinate) {
          this.fireEvent("click", lngLatToArma([info.coordinate[0], info.coordinate[1]]));
        }
      },
      layers: [],
      // Use WebGL2 for better performance
      useDevicePixels: true,
      _animate: true,
    });

    // Scale control
    this.scaleControl = new ScaleControl(container);
    this.scaleControl.update(this.viewState.zoom);

    // Build icon atlas async, then trigger first render
    void buildIconAtlas().then((atlas) => {
      this.iconAtlas = atlas;
      this.state.flushNow();
    });

    // Load style and basemap async
    this.loadStyle(world);

    // Fit to world bounds
    this.fitBoundsInternal(
      [0, 0],
      [this.worldSizeDeg, this.worldSizeDeg],
      false,
    );
  }

  private async loadStyle(world: WorldConfig): Promise<void> {
    if (!world.tileBaseUrl) return;

    const styleUrl = `${world.tileBaseUrl}/styles/topo.json`;
    try {
      const resp = await fetch(styleUrl);
      if (!resp.ok) return;
      const doc = await resp.json();
      this.compiledStyle = parseStyleDocument(doc);

      // Load sprite atlas
      if (this.compiledStyle.spriteUrl) {
        this.spriteAtlas = await loadSpriteAtlas(this.compiledStyle.spriteUrl);
      }

      // Open PMTiles archives for each source and read metadata
      for (const [name, source] of Object.entries(this.compiledStyle.sources)) {
        if (source.type === "vector" && source.url) {
          this.vectorPMTiles = new PMTiles(source.url);
          // Create stable getTileData reference once — reused across all
          // basemap rebuilds so TileLayer keeps its tile cache.
          this.vectorGetTileData = createVectorTileDataFetcher(this.vectorPMTiles);
          try {
            const header = await this.vectorPMTiles.getHeader();
            this.vectorMaxZoom = header.maxZoom;
          } catch {
            // Fallback already set
          }
        }
      }

      this.rebuildBasemap();
      this.state.flushNow();
    } catch {
      // Style not available — render with empty basemap
    }
  }

  private rebuildBasemap(): void {
    if (!this.compiledStyle) {
      this.basemapLayers = [];
      return;
    }

    this.basemapLayers = buildBasemapLayers({
      compiledStyle: this.compiledStyle,
      zoom: this.viewState.zoom,
      worldSizeDeg: this.worldSizeDeg,
      spriteAtlas: this.spriteAtlas,
      vectorPMTiles: this.vectorPMTiles ?? undefined,
      vectorMaxZoom: this.vectorMaxZoom,
      vectorGetTileData: this.vectorGetTileData ?? undefined,
    });
  }

  dispose(): void {
    if (this.state) {
      this.state.dispose();
    }
    this.listeners.clear();
    if (this.scaleControl) {
      this.scaleControl.dispose();
    }
    if (this.deck) {
      this.deck.finalize();
    }
  }

  // ==================== Layer building ====================

  private buildLayers(): Layer[] {
    const layers: Layer[] = [...this.basemapLayers];
    const s = this.state;

    if (s.enabledLayers.has("entities") && this.iconAtlas) {
      const visible = s.getVisibleEntityArray();
      const rev = s.entityRevision;
      const transitions = this.smoothingEnabled
        ? { getPosition: { duration: getTransitionDuration(this.smoothingSpeed) * 1000 } }
        : undefined;
      layers.push(buildEntityIconLayer(visible, this.iconAtlas, rev, transitions));
      layers.push(buildEntityLabelLayer(visible, this.nameDisplayMode, rev));
    }

    if (s.enabledLayers.has("projectileMarkers")) {
      const lines = s.getLineArray();
      if (lines.length > 0) {
        layers.push(buildFireLineLayer(lines, s.lineRevision));
      }
    }

    if (s.enabledLayers.has("briefingMarkers")) {
      const polygons = s.getBriefingPolygonArray();
      const paths = s.getBriefingPathArray();
      const icons = s.getBriefingIconArray();
      const rev = s.briefingRevision;
      if (polygons.length > 0) layers.push(buildBriefingPolygonLayer(polygons, rev));
      if (paths.length > 0) layers.push(buildBriefingPathLayer(paths, rev));
      if (icons.length > 0) layers.push(buildBriefingIconLayer(icons, rev));
    }

    const pulses = s.getPulseArray();
    if (pulses.length > 0) {
      layers.push(buildPulseLayer(pulses, s.pulseRevision));
    }

    return layers;
  }

  // ==================== Camera ====================

  getZoom(): number {
    return this.viewState.zoom;
  }

  setView(armaPos: ArmaCoord, zoom?: number, animate?: boolean): void {
    const [lng, lat] = armaToLngLat(armaPos);
    const targetZoom = zoom ?? this.viewState.zoom;

    if (animate ?? true) {
      this.deck.setProps({
        initialViewState: {
          ...this.viewState,
          longitude: lng,
          latitude: lat,
          zoom: targetZoom,
          transitionDuration: 500,
          transitionInterpolator: new FlyToInterpolator(),
        },
      });
    } else {
      this.viewState = { ...this.viewState, longitude: lng, latitude: lat, zoom: targetZoom };
      this.deck.setProps({ initialViewState: { ...this.viewState } });
    }
  }

  fitBounds(sw: ArmaCoord, ne: ArmaCoord): void {
    const swLngLat = armaToLngLat(sw);
    const neLngLat = armaToLngLat(ne);
    this.fitBoundsInternal(swLngLat, neLngLat, true);
  }

  private fitBoundsInternal(
    sw: [number, number],
    ne: [number, number],
    animate: boolean,
  ): void {
    const { width, height } = this.getContainerSize();
    if (width === 0 || height === 0) return;

    const viewport = new WebMercatorViewport({ width, height });
    const fitted = viewport.fitBounds([sw, ne], { padding: 20 });

    if (animate) {
      this.deck.setProps({
        initialViewState: {
          ...this.viewState,
          longitude: fitted.longitude,
          latitude: fitted.latitude,
          zoom: fitted.zoom,
          transitionDuration: 500,
          transitionInterpolator: new FlyToInterpolator(),
        },
      });
    } else {
      this.viewState = {
        ...this.viewState,
        longitude: fitted.longitude,
        latitude: fitted.latitude,
        zoom: fitted.zoom,
      };
      this.deck.setProps({ initialViewState: { ...this.viewState } });
    }
  }

  private getContainerSize(): { width: number; height: number } {
    return {
      width: this.container?.clientWidth ?? 0,
      height: this.container?.clientHeight ?? 0,
    };
  }

  getCenter(): ArmaCoord {
    return lngLatToArma([this.viewState.longitude, this.viewState.latitude]);
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
    this.state.dirtyEntities();

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

    this.state.dirtyEntities();
  }

  removeEntityMarker(handle: MarkerHandle): void {
    const internal = unwrapMarker(handle);
    this.state.entities.delete(internal.id);
    this.state.dirtyEntities();
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
      this.state.dirtyBriefing();
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
      this.state.dirtyBriefing();
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
      this.state.dirtyBriefing();
    }

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

    this.state.dirtyBriefing();
  }

  removeBriefingMarker(handle: BriefingMarkerHandle): void {
    const internal = unwrapBriefing(handle);
    this.state.briefingPolygons.delete(internal.id);
    this.state.briefingPaths.delete(internal.id);
    this.state.briefingIcons.delete(internal.id);
    this.state.dirtyBriefing();
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
    this.state.dirtyLines();
    return wrapLine({ id });
  }

  removeLine(handle: LineHandle): void {
    const internal = unwrapLine(handle);
    this.state.lines.delete(internal.id);
    this.state.dirtyLines();
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
        this.state.dirtyPulses();
        return;
      }

      pulse.radius = cycleProgress * maxRadius;
      pulse.fillColor[3] = Math.round((1 - cycleProgress) * 128);
      this.state.dirtyPulses();
      pulse.animFrameId = requestAnimationFrame(animate);
    };
    pulse.animFrameId = requestAnimationFrame(animate);

    this.state.dirtyPulses();
    return wrapPulse({ id });
  }

  removePulse(handle: PulseHandle): void {
    const internal = unwrapPulse(handle);
    const pulse = this.state.pulses.get(internal.id);
    if (pulse?.animFrameId) cancelAnimationFrame(pulse.animFrameId);
    this.state.pulses.delete(internal.id);
    this.state.dirtyPulses();
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
    this.state.dirtyEntities();
  }

  setNameDisplayMode(mode: "players" | "all" | "none"): void {
    this.nameDisplayMode = mode;
    this.state.dirtyEntities();
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
      container: this.container,
    };
  }
}
