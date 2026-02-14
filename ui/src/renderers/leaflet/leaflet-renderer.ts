import L from "leaflet";
import "leaflet-rotatedmarker";
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
import { entityIcon } from "./leaflet-icons";
import { createScaleControl } from "./leaflet-controls";
import type { StyleCandidate } from "./leaflet-controls";
import { createGridLayer } from "./leaflet-grid";
import {
  enableSmoothing,
  disableSmoothing,
  setZooming,
} from "./leaflet-smoothing";
import {
  ensureDefs,
  nextPatternId,
  createStripePattern,
  createGridPattern,
  removePattern,
  patchSVGUpdateStyle,
} from "./svg-patterns";

// --------------- Internal handle wrapper ---------------

interface InternalMarkerHandle {
  marker: L.Marker;
  id: number;
  lastDirection: number;
  /** Track current icon key to avoid unnecessary setIcon calls (which rebind the popup). */
  iconKey: string;
  /** Track current popup name to avoid unnecessary setContent calls (which retrigger layout). */
  popupName: string;
  /** Per-entity state for popup visibility — kept in sync by updateEntityMarker. */
  isPlayer: boolean;
  isInVehicle: boolean;
}

interface InternalBriefingHandle {
  layer: L.Layer;
  shape: "ICON" | "ELLIPSE" | "RECTANGLE" | "POLYLINE";
  layerKey: "briefingMarkers" | "systemMarkers" | "projectileMarkers";
  size?: [number, number];
  patternId?: string;
  shapeOpts?: { stroke: boolean; fill: boolean; fillOpacity: number };
}

interface ShapeResult {
  opts: L.PolylineOptions;
  patternType?: "stripe" | "grid";
  patternParams?: {
    angle?: number;
    weight: number;
    spaceWeight: number;
    opacity: number;
    bgOpacity?: number;
  };
}

interface InternalLineHandle {
  line: L.Polyline;
}

interface InternalPulseHandle {
  marker: L.Marker;
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

// --------------- Layer group keys ---------------

type LayerGroupKey = "entities" | "briefingMarkers" | "systemMarkers" | "projectileMarkers";

// --------------- Coordinate conversion (pure functions for testing) ---------------

/**
 * Convert Arma [x,y] to Leaflet LatLng in EPSG:3857 (MapLibre) mode.
 * Arma Y = north (lat), X = east (lng). Meters to degrees at equator.
 */
export function armaToLatLngMapLibre(coords: ArmaCoord): L.LatLng {
  return L.latLng(coords[1] / METERS_PER_DEGREE, coords[0] / METERS_PER_DEGREE);
}

/**
 * Convert Leaflet LatLng back to Arma [x,y] in EPSG:3857 (MapLibre) mode.
 */
export function latLngToArmaMapLibre(latlng: L.LatLng): ArmaCoord {
  return [latlng.lng * METERS_PER_DEGREE, latlng.lat * METERS_PER_DEGREE];
}

// --------------- Renderer ---------------

export class LeafletRenderer implements MapRenderer {
  private map!: L.Map;
  private world!: WorldConfig;
  private useMapLibreMode = false;

  private nameDisplayMode: "players" | "all" | "none" = "players";
  private hideMarkerPopups = false;

  private layers: Record<LayerGroupKey, L.LayerGroup> = {
    entities: L.layerGroup(),
    briefingMarkers: L.layerGroup(),
    systemMarkers: L.layerGroup(),
    projectileMarkers: L.layerGroup(),
  };

  private listeners = new Map<RendererEvent, Set<(...args: any[]) => void>>();

  // SVG renderer for briefing marker shapes (avoids canvas zoom-animation scaling)
  private svgRenderer!: L.SVG;
  private svgDefs!: SVGDefsElement;

  // Smoothing state
  private smoothingEnabled = false;
  private smoothingSpeed = 1;

  // MapLibre layer reference (for style switching)
  private maplibreLayer: any = null;

  // Grid and MapLibre toggle layers for overlay control
  private gridLayer: L.LayerGroup | null = null;
  private mapIconsLayer: L.LayerGroup | null = null;
  private buildings3DLayer: L.LayerGroup | null = null;

  // Map style state
  private _mapStyles: import("../renderer.types").MapStyleInfo[] = [];
  private _activeStyleIndex = 0;
  private _styleSwitchFn: ((index: number) => void) | null = null;

  // Legacy-mode state
  private imageSize = 0;
  private multiplier = 1;
  private maxNativeZoom = 0;

  // ==================== Lifecycle ====================

  init(container: HTMLElement, world: WorldConfig): void {
    this.world = world;
    this.maxNativeZoom = world.maxZoom;
    this.imageSize = world.imageSize ?? world.worldSize;
    this.multiplier = world.multiplier ?? 1;
    this.useMapLibreMode = Boolean(world.maplibre);

    const maxZoom = this.maxNativeZoom + 2;

    // Grid layer (created early for overlay control ordering; not added to map)
    this.gridLayer = createGridLayer({
      worldSize: world.worldSize,
      useMapLibreMode: this.useMapLibreMode,
      armaToLatLng: (c) => this.armaToLatLng(c),
      latLngToArma: (ll) => this.latLngToArma(ll),
    });

    if (this.useMapLibreMode) {
      this.initMapLibreMode(container, world);
    } else {
      this.initLegacyMode(container, world, maxZoom);
    }

    // Add standard controls
    createScaleControl().addTo(this.map);

    // SVG renderer for briefing marker shapes — avoids canvas bitmap scaling
    // during zoom animation (the old frontend does the same: window.svgRenderer = L.svg())
    this.svgRenderer = L.svg();
    this.svgRenderer.addTo(this.map);
    this.svgDefs = ensureDefs(this.svgRenderer);
    patchSVGUpdateStyle();

    // Add layer groups to map
    for (const group of Object.values(this.layers)) {
      group.addTo(this.map);
    }

    // Set initial popup visibility based on starting zoom
    const hideThreshold = this.useMapLibreMode ? 14 : 4;
    this.hideMarkerPopups = this.map.getZoom() <= hideThreshold;

    // Forward Leaflet events
    this.map.on("zoomstart", () => {
      setZooming(container, true);
    });
    this.map.on("zoomend", () => {
      setZooming(container, false);
      const hideThreshold = this.useMapLibreMode ? 14 : 4;
      this.hideMarkerPopups = this.map.getZoom() <= hideThreshold;
      this.refreshPopupVisibility();
      this.fireEvent("zoom", this.map.getZoom());
    });
    this.map.on("dragstart", () => {
      this.fireEvent("dragstart");
    });
    this.map.on("click", (e: L.LeafletMouseEvent) => {
      this.fireEvent("click", this.latLngToArma(e.latlng));
    });
  }

  private initMapLibreMode(container: HTMLElement, world: WorldConfig): void {
    const worldSizeDeg = world.worldSize / METERS_PER_DEGREE;

    this.map = L.map(container, {
      center: [worldSizeDeg / 2, worldSizeDeg / 2],
      zoom: 12,
      maxZoom: 20,
      minZoom: 10,
      zoomControl: false,
      scrollWheelZoom: true,
      zoomAnimation: true,
      fadeAnimation: true,
      crs: L.CRS.EPSG3857,
      attributionControl: false,
      zoomSnap: 1,
      zoomDelta: 1,
      closePopupOnClick: false,
      preferCanvas: true,
    });

    // Add MapLibre GL basemap layer — style URL constructed from tileBaseUrl
    const styleUrl = world.tileBaseUrl
      ? `${world.tileBaseUrl}/styles/topo.json`
      : null;
    if (styleUrl) {
      // Register PMTiles protocol and add the layer — must happen in order
      void (async () => {
        // Absolute base for resolving relative paths in MapLibre style
        // documents. Style JSON contains root-relative paths like
        // "images/maps/altis/tiles/features.pmtiles" that must resolve
        // against the app base, not the current page route (e.g. /recording/:id).
        const absBase = new URL(
          import.meta.env.BASE_URL,
          window.location.origin,
        ).href; // e.g. "http://localhost:5173/"

        // 1. Register PMTiles protocol with URL rewriting (idempotent)
        if (!(window as any)._pmtilesRegistered) {
          try {
            const { Protocol } = await import("pmtiles");
            const maplibregl = await import("maplibre-gl");
            const protocol = new Protocol();
            // Wrap PMTiles handler to resolve relative paths against app base
            maplibregl.addProtocol(
              "pmtiles",
              (params: any, ac: AbortController) => {
                const rest = params.url.slice("pmtiles://".length);
                if (!rest.startsWith("http") && !rest.startsWith("/")) {
                  return protocol.tile(
                    { ...params, url: "pmtiles://" + absBase + rest },
                    ac,
                  );
                }
                return protocol.tile(params, ac);
              },
            );
            (window as any)._pmtilesRegistered = true;
          } catch {
            // PMTiles not available — MapLibre may still work without PMTiles
          }
        }

        // 2. transformRequest resolves relative sprite/glyph/tile URLs.
        // URLs with any protocol (http:, https:, pmtiles:, data:) or
        // protocol-relative (//) are left unchanged.
        const transformRequest = (url: string) => {
          if (!/^(\w+:)?\/\/|^data:/.test(url)) {
            return { url: absBase + url.replace(/^\//, "") };
          }
          return { url };
        };

        // 3. Build style candidates
        const raw = world.tileBaseUrl ?? "";
        const tileBase = raw.startsWith("http")
          ? raw
          : new URL(
              import.meta.env.BASE_URL + raw.replace(/^\//, ""),
              window.location.origin,
            ).href;
        const styleBase = tileBase + "/styles/";
        const styleCandidates: StyleCandidate[] = [
          { label: "Topographic", url: styleBase + "topo.json" },
          { label: "Topographic Dark", url: styleBase + "topo-dark.json" },
          { label: "Color Relief", url: styleBase + "color-relief.json" },
          { label: "Topographic Relief", url: styleBase + "topo-relief.json" },
        ];
        const savedIdx =
          parseInt(
            localStorage.getItem("ocap-maplibre-style") ?? "0",
            10,
          ) || 0;
        const initialStyle =
          styleCandidates[
            savedIdx >= 0 && savedIdx < styleCandidates.length ? savedIdx : 0
          ].url;

        await import("@maplibre/maplibre-gl-leaflet");
        const mlLayer = (L as any).maplibreGL({
          style: initialStyle,
          interactive: false,
          renderWorldCopies: false,
          transformRequest,
        });
        mlLayer.addTo(this.map);
        this.maplibreLayer = mlLayer;

        // Overlay control (added before style switcher so switcher appears
        // above in Leaflet's bottom corner, which prepends new controls)
        this.addOverlayControl();

        // Add MapLibre pseudo-layers to map by default (checked in overlay control)
        if (this.mapIconsLayer) this.mapIconsLayer.addTo(this.map);
        if (this.buildings3DLayer) this.buildings3DLayer.addTo(this.map);

        // Reapply toggle states after style switch (setStyle resets all GL layers)
        const glMap = mlLayer.getMaplibreMap?.();
        if (glMap) {
          glMap.on("styledata", () => {
            if (this.mapIconsLayer && !this.map.hasLayer(this.mapIconsLayer)) {
              this.setMapLibreIconVisibility("none");
            }
            if (
              this.buildings3DLayer &&
              !this.map.hasLayer(this.buildings3DLayer)
            ) {
              this.setBuildings3DVisibility("none");
            }
          });
        }

        // Probe style availability and generate previews for the UI
        const previewCenter: [number, number] = [
          worldSizeDeg / 2,
          worldSizeDeg / 2,
        ];
        const styleLabels = ["Topo", "Topo Dark", "Color Relief", "Topo Relief"];
        const probes = styleCandidates.map((c, i) => {
          const ctrl = new AbortController();
          return fetch(c.url, { method: "HEAD", signal: ctrl.signal })
            .then((res) => { ctrl.abort(); return { index: i, ok: res.ok }; })
            .catch(() => ({ index: i, ok: false }));
        });
        const activeIdx = savedIdx >= 0 && savedIdx < styleCandidates.length ? savedIdx : 0;
        this._activeStyleIndex = activeIdx;
        this._mapStyles = styleCandidates.map((c, i) => ({
          label: styleLabels[i] ?? c.label,
          available: false, // updated after probes
        }));
        this._styleSwitchFn = (index: number) => {
          const glMap2 = mlLayer.getMaplibreMap?.();
          if (!glMap2 || index < 0 || index >= styleCandidates.length) return;
          glMap2.setStyle(styleCandidates[index].url);
          this._activeStyleIndex = index;
          try { localStorage.setItem("ocap-maplibre-style", String(index)); } catch { /* noop */ }
        };
        Promise.all(probes).then((results) => {
          for (const r of results) {
            this._mapStyles[r.index] = { ...this._mapStyles[r.index], available: r.ok };
          }
          // Generate preview thumbnails
          for (const r of results) {
            if (!r.ok) continue;
            this._renderStylePreview(
              styleCandidates[r.index].url,
              [previewCenter[1], previewCenter[0]],
              12,
              transformRequest,
              (dataUrl) => {
                if (dataUrl) {
                  this._mapStyles[r.index] = { ...this._mapStyles[r.index], previewUrl: dataUrl };
                }
              },
            );
          }
        });
      })();
    } else {
      // No style URL — add overlay control immediately
      this.addOverlayControl();
    }

    // Fit map to world bounds
    this.map.fitBounds(
      L.latLngBounds(L.latLng(0, 0), L.latLng(worldSizeDeg, worldSizeDeg)),
    );
  }

  private initLegacyMode(
    container: HTMLElement,
    world: WorldConfig,
    maxZoom: number,
  ): void {
    const factorx = this.multiplier;
    const factory = this.multiplier;

    // Create custom CRS for legacy raster tiles
    const OCAP_CRS = L.extend({}, L.CRS.Simple, {
      projection: L.Projection.LonLat,
      transformation: new L.Transformation(factorx, 0, -factory, 0),
      scale(zoom: number) {
        return Math.pow(2, zoom);
      },
      zoom(scale: number) {
        return Math.log(scale) / Math.LN2;
      },
      distance(latlng1: L.LatLng, latlng2: L.LatLng) {
        const dx = latlng2.lng - latlng1.lng;
        const dy = latlng2.lat - latlng1.lat;
        return Math.sqrt(dx * dx + dy * dy);
      },
      infinite: true,
    });

    this.map = L.map(container, {
      center: [0, 0],
      zoom: 0,
      maxZoom,
      minZoom: 0,
      zoomControl: false,
      scrollWheelZoom: true,
      zoomAnimation: true,
      fadeAnimation: true,
      crs: OCAP_CRS,
      attributionControl: false,
      zoomSnap: 1,
      zoomDelta: 1,
      closePopupOnClick: false,
      preferCanvas: true,
    });

    // Compute tile layer bounds (same as legacy getMapImageBounds)
    const imgSize = this.imageSize;
    const nz = this.maxNativeZoom;
    const mapBounds = new L.LatLngBounds(
      this.map.unproject([0, imgSize], nz),
      this.map.unproject([imgSize, 0], nz),
    );

    // Build tile layers based on available styles in map.json
    const rawTile = world.tileBaseUrl ?? "";
    const tileUrl = rawTile.startsWith("http") ? rawTile : import.meta.env.BASE_URL + rawTile.replace(/^\//, "");
    const baseLayers: L.TileLayer[] = [];
    const tileOpts: L.TileLayerOptions = {
      maxNativeZoom: world.maxZoom,
      minNativeZoom: world.minZoom,
      bounds: mapBounds,
      noWrap: true,
      tms: false,
      keepBuffer: 4,
    } as any;
    const attr = world.attribution
      ? `Map Data &copy; ${world.attribution}`
      : undefined;

    if (tileUrl) {
      if (world.hasTopo !== false) {
        baseLayers.push(
          L.tileLayer(`${tileUrl}/{z}/{x}/{y}.png`, {
            ...tileOpts,
            label: "Topographic",
            attribution: attr,
          } as any),
        );
      }
      if (world.hasTopoDark) {
        baseLayers.push(
          L.tileLayer(`${tileUrl}/topoDark/{z}/{x}/{y}.png`, {
            ...tileOpts,
            label: "Topographic Dark",
            attribution: attr,
          } as any),
        );
      }
      if (world.hasTopoRelief) {
        baseLayers.push(
          L.tileLayer(`${tileUrl}/topoRelief/{z}/{x}/{y}.png`, {
            ...tileOpts,
            label: "Topographic Relief",
            attribution: attr,
          } as any),
        );
      }
      if (world.hasColorRelief) {
        baseLayers.push(
          L.tileLayer(`${tileUrl}/colorRelief/{z}/{x}/{y}.png`, {
            ...tileOpts,
            label: "Color Relief",
            attribution: attr,
          } as any),
        );
      }

      // Fallback: if no flags set at all, add default topo layer
      if (baseLayers.length === 0) {
        baseLayers.push(
          L.tileLayer(`${tileUrl}/{z}/{x}/{y}.png`, {
            ...tileOpts,
            attribution: attr,
          } as any),
        );
      }
    }

    this.addOverlayControl();

    // Populate map style info for UI
    const styleLabels = ["Topo", "Topo Dark", "Color Relief", "Topo Relief"];
    const styleFlags = [
      world.hasTopo !== false,
      !!world.hasTopoDark,
      !!world.hasTopoRelief,
      !!world.hasColorRelief,
    ];
    this._mapStyles = styleLabels.map((label, i) => ({
      label,
      available: styleFlags[i] && baseLayers.length > 0,
    }));

    // Generate preview thumbnails from tile URLs
    if (baseLayers.length > 0) {
      const tileZ = 4;
      const tileX = 2;
      const tileY = 6;
      let layerIdx = 0;
      for (let i = 0; i < styleFlags.length; i++) {
        if (!styleFlags[i]) continue;
        if (layerIdx >= baseLayers.length) break;
        const layer = baseLayers[layerIdx];
        const url = L.Util.template((layer as any)._url, {
          s: (layer as any)._getSubdomain?.({ x: tileX, y: tileY }) ?? "",
          x: tileX, y: tileY, z: tileZ,
          ...layer.options,
        });
        this._mapStyles[i] = { ...this._mapStyles[i], previewUrl: url };
        layerIdx++;
      }
    }

    // Add first layer and set up switching
    let activeLayer: L.TileLayer | null = null;
    if (baseLayers.length > 0) {
      baseLayers[0].addTo(this.map);
      activeLayer = baseLayers[0];
      this._activeStyleIndex = 0;
    }

    // Map style indices (0=Topo, 1=Dark, 2=Relief, 3=Sat) to baseLayers array indices
    const indexToLayer = new Map<number, L.TileLayer>();
    {
      let layerIdx = 0;
      for (let i = 0; i < styleFlags.length; i++) {
        if (!styleFlags[i]) continue;
        if (layerIdx >= baseLayers.length) break;
        indexToLayer.set(i, baseLayers[layerIdx]);
        layerIdx++;
      }
    }

    this._styleSwitchFn = (index: number) => {
      const layer = indexToLayer.get(index);
      if (!layer || layer === activeLayer) return;
      if (activeLayer) this.map.removeLayer(activeLayer);
      layer.addTo(this.map);
      layer.bringToBack();
      activeLayer = layer;
      this._activeStyleIndex = index;
    };

    // Fit to tile bounds
    this.map.fitBounds(mapBounds);
  }

  dispose(): void {
    if (!this.map) return;

    // Remove all layer groups
    for (const group of Object.values(this.layers)) {
      group.clearLayers();
      this.map.removeLayer(group);
    }

    if (this.gridLayer && this.map.hasLayer(this.gridLayer)) {
      this.map.removeLayer(this.gridLayer);
    }
    this.gridLayer = null;

    if (this.mapIconsLayer && this.map.hasLayer(this.mapIconsLayer)) {
      this.map.removeLayer(this.mapIconsLayer);
    }
    this.mapIconsLayer = null;

    if (this.buildings3DLayer && this.map.hasLayer(this.buildings3DLayer)) {
      this.map.removeLayer(this.buildings3DLayer);
    }
    this.buildings3DLayer = null;

    if (this.maplibreLayer) {
      this.map.removeLayer(this.maplibreLayer);
      this.maplibreLayer = null;
    }

    if (this.svgRenderer) {
      this.map.removeLayer(this.svgRenderer);
    }

    this.listeners.clear();
    this.map.remove();
  }

  // ==================== Coordinate conversion (private) ====================

  private armaToLatLng(coords: ArmaCoord): L.LatLng {
    if (this.useMapLibreMode) {
      return armaToLatLngMapLibre(coords);
    }
    // Legacy mode: pixel-based projection
    const pixelCoords: [number, number] = [
      coords[0] * this.multiplier,
      this.imageSize - coords[1] * this.multiplier,
    ];
    return this.map.unproject(pixelCoords, this.maxNativeZoom);
  }

  private latLngToArma(latlng: L.LatLng): ArmaCoord {
    if (this.useMapLibreMode) {
      return latLngToArmaMapLibre(latlng);
    }
    // Legacy mode: reverse pixel projection
    const point = this.map.project(latlng, this.maxNativeZoom);
    const x = point.x / this.multiplier;
    const y = (this.imageSize - point.y) / this.multiplier;
    return [x, y];
  }

  // ==================== Camera ====================

  getZoom(): number {
    return this.map.getZoom();
  }

  setView(armaPos: ArmaCoord, zoom?: number, animate?: boolean): void {
    const latlng = this.armaToLatLng(armaPos);
    this.map.setView(latlng, zoom ?? this.map.getZoom(), {
      animate: animate ?? true,
    });
  }

  fitBounds(sw: ArmaCoord, ne: ArmaCoord): void {
    const bounds = L.latLngBounds(
      this.armaToLatLng(sw),
      this.armaToLatLng(ne),
    );
    this.map.fitBounds(bounds);
  }

  getCenter(): ArmaCoord {
    return this.latLngToArma(this.map.getCenter());
  }

  // ==================== Entity markers ====================

  createEntityMarker(id: number, opts: EntityMarkerOpts): MarkerHandle {
    const { icon, opacity } = entityIcon(opts.iconType, opts.side, 1);
    const latlng = this.armaToLatLng(opts.position);

    const marker = L.marker(latlng, {
      icon,
      rotationOrigin: opts.iconType === "man" ? "50% 60%" : "50% 50%",
    } as any);

    marker.setOpacity(opacity);

    // Add to map, then bind and open popup (matching old frontend order)
    marker.addTo(this.layers.entities);

    const popup = L.popup({
      autoPan: false,
      autoClose: false,
      closeButton: false,
      className: opts.iconType === "man" ? "leaflet-popup-unit" : "leaflet-popup-vehicle",
    });
    popup.setContent(opts.name);
    marker.bindPopup(popup).openPopup();

    const iconKey = `${opts.iconType}:${opts.side}:1`;
    const internal: InternalMarkerHandle = { marker, id, lastDirection: 0, iconKey, popupName: opts.name, isPlayer: opts.isPlayer, isInVehicle: false };
    (marker as any)._ocapInternal = internal;
    return wrapMarker(internal);
  }

  updateEntityMarker(handle: MarkerHandle, state: EntityMarkerState): void {
    const internal = unwrapMarker(handle);
    const marker = internal.marker;

    // Keep per-entity state in sync for refreshPopupVisibility
    internal.isPlayer = state.isPlayer;
    internal.isInVehicle = state.isInVehicle;

    // Update position
    const latlng = this.armaToLatLng(state.position);
    marker.setLatLng(latlng);

    // Update rotation using closest equivalent angle
    const newAngle = closestEquivalentAngle(internal.lastDirection, state.direction);
    (marker as any).setRotationAngle(newAngle);
    internal.lastDirection = newAngle;

    // Only call setIcon when icon actually changes (avoids popup rebind)
    const newIconKey = `${state.iconType}:${state.side}:${state.alive}`;
    const { icon, opacity } = entityIcon(state.iconType, state.side, state.alive);
    if (newIconKey !== internal.iconKey) {
      marker.setIcon(icon);
      internal.iconKey = newIconKey;
    }
    marker.setOpacity(opacity);

    // Update popup text and visibility via CSS display (matching old hideMarkerPopup).
    const popup = marker.getPopup();
    if (popup) {
      if (state.name !== internal.popupName) {
        popup.setContent(state.name);
        internal.popupName = state.name;
      }

      const popupEl = popup.getElement();
      if (popupEl) {
        let display = "";
        if (state.isInVehicle) {
          display = "none";
        } else if (this.hideMarkerPopups) {
          display = "none";
        } else if (this.nameDisplayMode === "none") {
          display = "none";
        } else if (this.nameDisplayMode === "players" && !state.isPlayer) {
          display = "none";
        }
        popupEl.style.display = display;
      }
    }

    // Handle marker visibility: hide if in vehicle
    if (state.isInVehicle) {
      marker.setOpacity(0);
    }
  }

  removeEntityMarker(handle: MarkerHandle): void {
    const internal = unwrapMarker(handle);
    this.layers.entities.removeLayer(internal.marker);
  }

  // ==================== Briefing markers ====================

  createBriefingMarker(def: BriefingMarkerDef): BriefingMarkerHandle {
    let layer: L.Layer;
    const cssColor = `#${def.color}`;
    let shapeOpts: InternalBriefingHandle["shapeOpts"];

    if (def.shape === "POLYLINE") {
      layer = L.polyline([], {
        color: cssColor,
        opacity: 1,
        noClip: true,
        interactive: false,
        renderer: this.svgRenderer,
      } as any);
    } else if (def.shape === "ELLIPSE" || def.shape === "RECTANGLE") {
      // Build polygon options from brush type; use SVG renderer to avoid
      // canvas bitmap scaling during zoom animation
      const result = this.buildShapeOptions(cssColor, def.brush);
      const polygonOpts: any = { ...result.opts, noClip: false, interactive: false, renderer: this.svgRenderer };

      shapeOpts = {
        stroke: !!result.opts.stroke,
        fill: !!result.opts.fill,
        fillOpacity: result.opts.fillOpacity ?? 0.3,
      };

      let patternId: string | undefined;
      if (result.patternType && result.patternParams) {
        patternId = nextPatternId();
        const p = result.patternParams;
        if (result.patternType === "stripe") {
          createStripePattern(this.svgDefs, patternId, cssColor, p.angle ?? 0, p.weight, p.spaceWeight, p.opacity);
        } else {
          createGridPattern(this.svgDefs, patternId, cssColor, p.weight, p.spaceWeight, p.opacity, p.bgOpacity ?? 0);
        }
        polygonOpts._fillPatternId = patternId;
      }

      layer = L.polygon([], polygonOpts);

      if (patternId) {
        const layerKey = def.layer ?? "briefingMarkers";
        layer.addTo(this.layers[layerKey]);
        return wrapBriefing({ layer, shape: def.shape, layerKey, size: def.size, patternId, shapeOpts });
      }
    } else {
      // ICON shape — load actual marker image from server
      const isMagIcon = def.type.indexOf("magIcons") > -1;
      const b = import.meta.env.BASE_URL;
      let iconUrl: string;
      if (isMagIcon) {
        iconUrl = `${b}images/markers/${def.type.toLowerCase()}.png`;
      } else {
        iconUrl = `${b}images/markers/${def.type}/${def.color}.png`;
      }
      const iconSize: [number, number] = def.size
        ? [def.size[0] * 35, def.size[1] * 35]
        : [35, 35];

      layer = L.marker([0, 0], {
        icon: L.icon({ iconUrl, iconSize }),
        interactive: false,
        rotationOrigin: "50% 50%",
      } as any);

      // Add popup with marker text (matching old frontend's marker popup behaviour)
      if (def.text) {
        const popup = L.popup({
          autoPan: false,
          autoClose: false,
          closeButton: false,
          className: "leaflet-popup-unit",
        });
        popup.setContent(def.text);
        (layer as L.Marker).bindPopup(popup);
      }
    }

    const layerKey = def.layer ?? "briefingMarkers";
    layer.addTo(this.layers[layerKey]);

    // Open popup after adding to map so the DOM element exists
    if (def.text && layer instanceof L.Marker) {
      layer.openPopup();
    }
    return wrapBriefing({ layer, shape: def.shape, layerKey, size: def.size, shapeOpts });
  }

  updateBriefingMarker(
    handle: BriefingMarkerHandle,
    state: BriefingMarkerState,
  ): void {
    const internal = unwrapBriefing(handle);
    const layer = internal.layer;

    if (internal.shape === "ICON") {
      const marker = layer as L.Marker;
      marker.setLatLng(this.armaToLatLng(state.position));
      marker.setOpacity(state.alpha);
      (marker as any).setRotationAngle?.(state.direction);
    } else if (internal.shape === "ELLIPSE") {
      const polygon = layer as L.Polygon;
      const [cx, cy] = state.position;
      const rx = internal.size?.[0] ?? 100;
      const ry = internal.size?.[1] ?? 100;
      // Negate angle: Arma directions are clockwise from north,
      // standard rotation matrix is counter-clockwise
      const rad = -state.direction * (Math.PI / 180);
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);

      // Calculate 36 ellipse perimeter points, rotated in Arma coordinate space
      const latlngs: L.LatLng[] = [];
      for (let i = 0; i < 36; i++) {
        const angle = (i / 36) * 2 * Math.PI;
        const dx = rx * Math.cos(angle);
        const dy = ry * Math.sin(angle);
        // Rotate around center in Arma coords (zoom-independent)
        latlngs.push(this.armaToLatLng([
          cx + cos * dx - sin * dy,
          cy + sin * dx + cos * dy,
        ]));
      }

      polygon.setLatLngs(latlngs);
      this.applyPolygonOpacity(polygon, internal, state.alpha);
    } else if (internal.shape === "RECTANGLE") {
      const polygon = layer as L.Polygon;
      const [cx, cy] = state.position;
      const sx = internal.size?.[0] ?? 100;
      const sy = internal.size?.[1] ?? 100;
      // Negate angle: Arma directions are clockwise from north,
      // standard rotation matrix is counter-clockwise
      const rad = -state.direction * (Math.PI / 180);
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);

      // Calculate 4 corner points, rotated in Arma coordinate space
      const corners: [number, number][] = [
        [-sx, +sy], [+sx, +sy], [+sx, -sy], [-sx, -sy],
      ];
      const latlngs = corners.map(([dx, dy]) =>
        this.armaToLatLng([
          cx + cos * dx - sin * dy,
          cy + sin * dx + cos * dy,
        ]),
      );

      polygon.setLatLngs(latlngs);
      this.applyPolygonOpacity(polygon, internal, state.alpha);
    } else if (internal.shape === "POLYLINE" && state.points) {
      const polyline = layer as L.Polyline;
      const latlngs = state.points.map((p) => this.armaToLatLng(p));
      polyline.setLatLngs(latlngs);
      polyline.setStyle({ opacity: state.alpha });
    }
  }

  removeBriefingMarker(handle: BriefingMarkerHandle): void {
    const internal = unwrapBriefing(handle);
    this.layers[internal.layerKey].removeLayer(internal.layer);
    if (internal.patternId) {
      removePattern(this.svgDefs, internal.patternId);
    }
  }

  // ==================== Briefing marker helpers ====================

  /** Apply opacity to polygon matching old frontend setMarkerOpacity logic. */
  private applyPolygonOpacity(
    polygon: L.Polygon,
    internal: InternalBriefingHandle,
    alpha: number,
  ): void {
    const so = internal.shapeOpts;
    if (!so) return;

    let strokeOpacity: number;
    let fillOpacity: number;

    if (alpha > 0) {
      strokeOpacity = so.stroke ? 1 : 0;
      fillOpacity = so.fill ? Math.min(so.fillOpacity, alpha) : 0;
    } else {
      strokeOpacity = 0;
      fillOpacity = 0;
    }

    polygon.setStyle({ opacity: strokeOpacity, fillOpacity });
  }

  private buildShapeOptions(
    color: string,
    brush?: string,
  ): ShapeResult {
    switch (brush?.toLowerCase()) {
      case "solidfull":
        return { opts: { color, stroke: false, fill: true, fillOpacity: 0.8 } };
      case "border":
        return { opts: { color, stroke: true, fill: false, fillOpacity: 0 } };
      case "solidborder":
        return { opts: { color, stroke: true, fill: true, fillOpacity: 0.3 } };
      case "horizontal":
        return {
          opts: { color, stroke: false, fill: true, fillOpacity: 0.2 },
          patternType: "stripe",
          patternParams: { angle: 0, weight: 2, spaceWeight: 4, opacity: 1 },
        };
      case "vertical":
        return {
          opts: { color, stroke: false, fill: true, fillOpacity: 0.2 },
          patternType: "stripe",
          patternParams: { angle: 90, weight: 2, spaceWeight: 4, opacity: 1 },
        };
      case "fdiagonal":
        return {
          opts: { color, stroke: false, fill: true, fillOpacity: 0.2 },
          patternType: "stripe",
          patternParams: { angle: 315, weight: 2, spaceWeight: 6, opacity: 1 },
        };
      case "bdiagonal":
        return {
          opts: { color, stroke: false, fill: true, fillOpacity: 0.2 },
          patternType: "stripe",
          patternParams: { angle: 45, weight: 2, spaceWeight: 6, opacity: 1 },
        };
      case "diaggrid":
        return {
          opts: { color, stroke: false, fill: true, fillOpacity: 0.2 },
          patternType: "stripe",
          patternParams: { angle: 45, weight: 1, spaceWeight: 3, opacity: 0.8 },
        };
      case "grid":
        return {
          opts: { color, stroke: false, fill: true, fillOpacity: 1.0 },
          patternType: "grid",
          patternParams: { weight: 2, spaceWeight: 6, opacity: 0.5, bgOpacity: 0.3 },
        };
      case "cross":
        return {
          opts: { color, stroke: false, fill: true, fillOpacity: 1.0 },
          patternType: "grid",
          patternParams: { weight: 2, spaceWeight: 6, opacity: 0.5, bgOpacity: 0.3 },
        };
      case "solid":
      default:
        return { opts: { color, stroke: false, fill: true, fillOpacity: 0.3 } };
    }
  }

  // ==================== Lines ====================

  addLine(from: ArmaCoord, to: ArmaCoord, opts: LineOpts): LineHandle {
    const line = L.polyline(
      [this.armaToLatLng(from), this.armaToLatLng(to)],
      {
        color: opts.color,
        weight: opts.weight,
        opacity: opts.opacity,
      },
    );
    line.addTo(this.layers.projectileMarkers);
    return wrapLine({ line });
  }

  removeLine(handle: LineHandle): void {
    const internal = unwrapLine(handle);
    this.layers.projectileMarkers.removeLayer(internal.line);
  }

  // ==================== Pulses ====================

  addPulse(pos: ArmaCoord, opts: PulseOpts): PulseHandle {
    const latlng = this.armaToLatLng(pos);
    const marker = L.marker(latlng, {
      icon: L.divIcon({
        className: "pulse-icon",
        html: `<div class="pulse-ring" style="border-color:${opts.color};background:${opts.fillColor}"></div>`,
        iconSize: opts.iconSize,
      }),
    });
    marker.addTo(this.layers.entities);
    return wrapPulse({ marker });
  }

  removePulse(handle: PulseHandle): void {
    const internal = unwrapPulse(handle);
    this.layers.entities.removeLayer(internal.marker);
  }

  // ==================== Layer visibility ====================

  setLayerVisible(layer: RenderLayer, visible: boolean): void {
    if (layer === "grid") {
      if (!this.gridLayer) return;
      if (visible) {
        if (!this.map.hasLayer(this.gridLayer)) {
          this.gridLayer.addTo(this.map);
        }
      } else {
        if (this.map.hasLayer(this.gridLayer)) {
          this.map.removeLayer(this.gridLayer);
        }
      }
      return;
    }

    if (layer === "mapIcons") {
      if (!this.mapIconsLayer) return;
      if (visible) {
        if (!this.map.hasLayer(this.mapIconsLayer)) {
          this.mapIconsLayer.addTo(this.map);
        }
      } else {
        if (this.map.hasLayer(this.mapIconsLayer)) {
          this.map.removeLayer(this.mapIconsLayer);
        }
      }
      return;
    }

    if (layer === "buildings3D") {
      if (!this.buildings3DLayer) return;
      if (visible) {
        if (!this.map.hasLayer(this.buildings3DLayer)) {
          this.buildings3DLayer.addTo(this.map);
        }
      } else {
        if (this.map.hasLayer(this.buildings3DLayer)) {
          this.map.removeLayer(this.buildings3DLayer);
        }
      }
      return;
    }

    const group = this.layers[layer as LayerGroupKey];
    if (!group) return;

    if (visible) {
      if (!this.map.hasLayer(group)) {
        group.addTo(this.map);
      }
    } else {
      if (this.map.hasLayer(group)) {
        this.map.removeLayer(group);
      }
    }
  }

  // ==================== Settings ====================

  setSmoothingEnabled(enabled: boolean, speed?: number): void {
    this.smoothingEnabled = enabled;
    if (speed !== undefined) {
      this.smoothingSpeed = speed;
    }

    const container = this.map?.getContainer();
    if (!container) return;

    if (enabled) {
      enableSmoothing(container, this.smoothingSpeed);
    } else {
      disableSmoothing(container);
    }
  }

  setNameDisplayMode(mode: "players" | "all" | "none"): void {
    this.nameDisplayMode = mode;
    this.refreshPopupVisibility();
  }

  /**
   * Re-evaluate popup visibility on all entity markers.
   * Called when zoom or nameDisplayMode changes.
   */
  private refreshPopupVisibility(): void {
    this.layers.entities.eachLayer((layer) => {
      const marker = layer as L.Marker;
      const popup = marker.getPopup();
      if (!popup) return;
      const popupEl = popup.getElement();
      if (!popupEl) return;

      const internal = (marker as any)._ocapInternal as InternalMarkerHandle | undefined;
      let display = "";
      if (internal?.isInVehicle) {
        display = "none";
      } else if (this.hideMarkerPopups) {
        display = "none";
      } else if (this.nameDisplayMode === "none") {
        display = "none";
      } else if (this.nameDisplayMode === "players" && internal && !internal.isPlayer) {
        display = "none";
      }
      popupEl.style.display = display;
    });
  }

  // ==================== Map styles ====================

  getMapStyles(): import("../renderer.types").MapStyleInfo[] {
    return this._mapStyles;
  }

  getActiveStyleIndex(): number {
    return this._activeStyleIndex;
  }

  setMapStyle(index: number): void {
    if (this._styleSwitchFn) {
      this._styleSwitchFn(index);
    }
  }

  /**
   * Render a 128x128 MapLibre preview thumbnail off-screen.
   */
  private _renderStylePreview(
    styleUrl: string,
    center: [number, number],
    zoom: number,
    transformRequest: ((url: string, resourceType: string) => any) | undefined,
    callback: (dataUrl: string | null) => void,
  ): void {
    const div = document.createElement("div");
    div.style.cssText =
      "width:128px;height:128px;position:absolute;left:-9999px;top:-9999px;visibility:hidden";
    document.body.appendChild(div);

    import("maplibre-gl")
      .then((maplibregl) => {
        const mapOpts: any = {
          container: div,
          style: styleUrl,
          center,
          zoom,
          interactive: false,
          attributionControl: false,
          preserveDrawingBuffer: true,
        };
        if (transformRequest) {
          mapOpts.transformRequest = transformRequest;
        }
        const miniMap = new maplibregl.Map(mapOpts);

        const timeoutId = setTimeout(() => {
          if (div.parentNode) {
            try { miniMap.remove(); } catch { /* noop */ }
            document.body.removeChild(div);
          }
        }, 10_000);

        miniMap.once("idle", () => {
          clearTimeout(timeoutId);
          if (!div.parentNode) return;
          try {
            callback(miniMap.getCanvas().toDataURL());
          } catch {
            callback(null);
          }
          miniMap.remove();
          document.body.removeChild(div);
        });
      })
      .catch(() => {
        callback(null);
        if (div.parentNode) document.body.removeChild(div);
      });
  }

  // ==================== Overlay control ====================

  private addOverlayControl(): void {
    // Layer visibility is now controlled by the TopBar UI component
    // via setLayerVisible(). Create MapLibre toggle layers if needed
    // so setLayerVisible("mapIcons"/"buildings3D") works.
    if (this.maplibreLayer) {
      this.mapIconsLayer = this.createMapLibreToggleLayer((vis) =>
        this.setMapLibreIconVisibility(vis),
      );
      this.buildings3DLayer = this.createMapLibreToggleLayer((vis) =>
        this.setBuildings3DVisibility(vis),
      );
      this.mapIconsLayer.addTo(this.map);
      this.buildings3DLayer.addTo(this.map);
    }
  }

  private createMapLibreToggleLayer(
    toggleFn: (vis: "visible" | "none") => void,
  ): L.LayerGroup {
    const layer = L.layerGroup([]);
    const origOnAdd = L.LayerGroup.prototype.onAdd;
    const origOnRemove = L.LayerGroup.prototype.onRemove;

    layer.onAdd = function (map: L.Map) {
      origOnAdd.call(this, map);
      toggleFn("visible");
      return this;
    };
    layer.onRemove = function (map: L.Map) {
      origOnRemove.call(this, map);
      toggleFn("none");
      return this;
    };

    return layer;
  }

  private setMapLibreIconVisibility(vis: "visible" | "none"): void {
    if (!this.maplibreLayer) return;
    const glMap = this.maplibreLayer.getMaplibreMap?.();
    if (!glMap?.getStyle()) return;
    for (const layer of glMap.getStyle().layers) {
      if (
        layer.type === "symbol" &&
        layer.layout &&
        layer.layout["icon-image"]
      ) {
        glMap.setLayoutProperty(layer.id, "visibility", vis);
      }
    }
  }

  private setBuildings3DVisibility(vis: "visible" | "none"): void {
    if (!this.maplibreLayer) return;
    const glMap = this.maplibreLayer.getMaplibreMap?.();
    if (!glMap?.getStyle()) return;
    for (const layer of glMap.getStyle().layers) {
      if (layer.type === "fill-extrusion" && !layer.id.includes("bridge")) {
        glMap.setLayoutProperty(layer.id, "visibility", vis);
      }
    }
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
