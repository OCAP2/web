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
import {
  enableSmoothing,
  disableSmoothing,
  setZooming,
} from "./leaflet-smoothing";

// --------------- Internal handle wrapper ---------------

interface InternalMarkerHandle {
  marker: L.Marker;
  id: number;
  lastDirection: number;
}

interface InternalBriefingHandle {
  layer: L.Layer;
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

  private layers: Record<LayerGroupKey, L.LayerGroup> = {
    entities: L.layerGroup(),
    briefingMarkers: L.layerGroup(),
    systemMarkers: L.layerGroup(),
    projectileMarkers: L.layerGroup(),
  };

  private listeners = new Map<RendererEvent, Set<(...args: any[]) => void>>();

  // Smoothing state
  private smoothingEnabled = false;
  private smoothingSpeed = 1;

  // Legacy-mode state
  private imageSize = 0;
  private multiplier = 1;
  private maxNativeZoom = 0;

  // ==================== Lifecycle ====================

  init(container: HTMLElement, world: WorldConfig): void {
    this.world = world;
    this.maxNativeZoom = world.maxZoom;
    this.imageSize = world.imageSize ?? world.worldSize;
    this.multiplier = 1; // Default; legacy maps may use a different value
    this.useMapLibreMode = Boolean(world.maplibreStyle);

    const maxZoom = this.maxNativeZoom + 2;

    if (this.useMapLibreMode) {
      this.initMapLibreMode(container, world);
    } else {
      this.initLegacyMode(container, world, maxZoom);
    }

    // Add layer groups to map
    for (const group of Object.values(this.layers)) {
      group.addTo(this.map);
    }

    // Forward Leaflet events
    this.map.on("zoomstart", () => {
      setZooming(container, true);
    });
    this.map.on("zoomend", () => {
      setZooming(container, false);
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
      attributionControl: true,
      zoomSnap: 1,
      zoomDelta: 1,
      closePopupOnClick: false,
      preferCanvas: true,
    });

    // Register PMTiles protocol (idempotent)
    if (!(window as any)._pmtilesRegistered) {
      try {
        // Dynamic import — PMTiles and maplibre-gl must be available
        const pmtiles = (window as any).pmtiles ?? (globalThis as any).pmtiles;
        const maplibregl = (window as any).maplibregl ?? (globalThis as any).maplibregl;
        const protocol = new pmtiles.Protocol();
        maplibregl.addProtocol("pmtiles", protocol.tile);
        (window as any)._pmtilesRegistered = true;
      } catch {
        // PMTiles not available — MapLibre may still work without PMTiles
      }
    }

    // Add MapLibre GL basemap layer
    if (world.maplibreStyle) {
      // The import of @maplibre/maplibre-gl-leaflet adds L.maplibreGL
      import("@maplibre/maplibre-gl-leaflet").then(() => {
        const mlLayer = (L as any).maplibreGL({
          style: world.maplibreStyle,
          interactive: false,
          renderWorldCopies: false,
        });
        mlLayer.addTo(this.map);
      });
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
      attributionControl: true,
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

    // Add tile layer — expects tiles at {tileUrl}/{z}/{x}/{y}.png
    // The tileUrl must be supplied externally (e.g. via world config extension)
    const tileUrl = (world as any).tileUrl ?? (world as any)._baseUrl ?? "";
    if (tileUrl) {
      L.tileLayer(`${tileUrl}/{z}/{x}/{y}.png`, {
        maxNativeZoom: world.maxZoom,
        minNativeZoom: world.minZoom,
        bounds: mapBounds,
        noWrap: true,
        tms: false,
        keepBuffer: 4,
      } as any).addTo(this.map);
    }

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

    const marker = L.marker([0, 0], {
      icon,
      rotationOrigin: opts.iconType === "man" ? "50% 60%" : "50% 50%",
    } as any);

    marker.setOpacity(opacity);

    // Bind popup with entity name
    const popup = L.popup({
      autoPan: false,
      autoClose: false,
      closeButton: false,
      className: "leaflet-popup-unit",
    });
    popup.setContent(opts.name);
    marker.bindPopup(popup).openPopup();

    // Add to entities layer group
    marker.addTo(this.layers.entities);

    return wrapMarker({ marker, id, lastDirection: 0 });
  }

  updateEntityMarker(handle: MarkerHandle, state: EntityMarkerState): void {
    const internal = unwrapMarker(handle);
    const marker = internal.marker;

    // Update position
    const latlng = this.armaToLatLng(state.position);
    marker.setLatLng(latlng);

    // Update rotation using closest equivalent angle
    const newAngle = closestEquivalentAngle(internal.lastDirection, state.direction);
    (marker as any).setRotationAngle(newAngle);
    internal.lastDirection = newAngle;

    // Update icon based on alive state and side
    const { icon, opacity } = entityIcon(state.iconType, state.side, state.alive);
    marker.setIcon(icon);
    marker.setOpacity(opacity);

    // Update popup text if name changed
    const popup = marker.getPopup();
    if (popup) {
      const displayName = state.name;
      popup.setContent(displayName);
    }

    // Handle visibility: hide if in vehicle
    if (state.isInVehicle) {
      marker.setOpacity(0);
      const popupEl = popup?.getElement();
      if (popupEl) popupEl.style.display = "none";
    }
  }

  removeEntityMarker(handle: MarkerHandle): void {
    const internal = unwrapMarker(handle);
    this.layers.entities.removeLayer(internal.marker);
  }

  // ==================== Briefing markers ====================

  createBriefingMarker(def: BriefingMarkerDef): BriefingMarkerHandle {
    // Create a placeholder layer; position will be set via update
    let layer: L.Layer;

    if (def.shape === "POLYLINE") {
      layer = L.polyline([], {
        color: def.color,
        weight: 2,
      });
    } else if (def.shape === "ELLIPSE" || def.shape === "RECTANGLE") {
      // Use a rectangle as approximation for both
      layer = L.rectangle(
        [
          [0, 0],
          [0, 0],
        ],
        {
          color: def.color,
          weight: 2,
          fillOpacity: 0.2,
        },
      );
    } else {
      // ICON shape — use a marker with a divIcon
      const iconHtml = def.text
        ? `<div class="briefing-marker-icon" style="color:${def.color}">${def.text}</div>`
        : `<div class="briefing-marker-icon" style="color:${def.color}"></div>`;
      layer = L.marker([0, 0], {
        icon: L.divIcon({
          className: "briefing-marker",
          html: iconHtml,
          iconSize: def.size ?? [24, 24],
        }),
      });
    }

    layer.addTo(this.layers.briefingMarkers);
    return wrapBriefing({ layer });
  }

  updateBriefingMarker(
    handle: BriefingMarkerHandle,
    state: BriefingMarkerState,
  ): void {
    const internal = unwrapBriefing(handle);
    const layer = internal.layer;

    if (layer instanceof L.Marker) {
      layer.setLatLng(this.armaToLatLng(state.position));
      layer.setOpacity(state.alpha);
    } else if (layer instanceof L.Polyline && state.points) {
      const latlngs = state.points.map((p) => this.armaToLatLng(p));
      layer.setLatLngs(latlngs);
    } else if (layer instanceof L.Rectangle) {
      // Position the rectangle centered on the position
      const center = this.armaToLatLng(state.position);
      const offset = 0.001; // Small offset for visibility
      layer.setBounds(
        L.latLngBounds(
          [center.lat - offset, center.lng - offset],
          [center.lat + offset, center.lng + offset],
        ),
      );
    }
  }

  removeBriefingMarker(handle: BriefingMarkerHandle): void {
    const internal = unwrapBriefing(handle);
    this.layers.briefingMarkers.removeLayer(internal.layer);
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
    line.addTo(this.layers.entities);
    return wrapLine({ line });
  }

  removeLine(handle: LineHandle): void {
    const internal = unwrapLine(handle);
    this.layers.entities.removeLayer(internal.line);
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
    // "grid" is not a managed layer group in this renderer
    if (layer === "grid") return;

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
