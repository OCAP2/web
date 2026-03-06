/**
 * L.Layer.Grid — Coordinate grid overlay for Leaflet maps.
 * Displays grid lines at zoom-adaptive intervals with coordinate labels
 * in the Arma coordinate system.
 *
 * TypeScript port of static/leaflet/L.Layer.Grid.js
 */
import L from "leaflet";
import type { ArmaCoord } from "../../utils/coordinates";
import { getGridLevels, formatCoordLabel, computeGridLines } from "./gridUtils";

// --------------- Types ---------------

export interface GridLayerOptions extends L.LayerOptions {
  /** Grid line color. Default: semi-transparent white */
  lineColor?: string;
  /** Grid line weight in pixels. Default: 1 */
  lineWeight?: number;
  /** Label font size in pixels. Default: 10 */
  labelFontSize?: number;
  /** Label text color. Default: white */
  labelColor?: string;
  /** Label background color. Default: semi-transparent black */
  labelBackgroundColor?: string;
  /** Whether to show coordinate labels. Default: true */
  showLabels?: boolean;
}

export interface GridLayerConfig {
  /** Arma world size in meters */
  worldSize: number;
  /** Whether the map is in MapLibre (EPSG:3857) mode */
  useMapLibreMode: boolean;
  /** Convert Arma [x,y] to Leaflet LatLng */
  armaToLatLng: (coords: ArmaCoord) => L.LatLng;
  /** Convert Leaflet LatLng to Arma [x,y] */
  latLngToArma: (latlng: L.LatLng) => ArmaCoord;
}

// --------------- Default options ---------------

const DEFAULT_OPTIONS: Required<GridLayerOptions> = {
  lineColor: "rgba(255, 255, 255, 0.3)",
  lineWeight: 1,
  labelFontSize: 10,
  labelColor: "#fff",
  labelBackgroundColor: "rgba(0, 0, 0, 0.6)",
  showLabels: true,
  pane: "overlayPane",
  attribution: "",
};

// --------------- Grid Layer ---------------

/**
 * Creates a Leaflet LayerGroup that draws an adaptive coordinate grid
 * with labels in the Arma coordinate system.
 */
export class GridLayer extends L.LayerGroup {
  private _gridLines: L.Polyline[] = [];
  private _gridLabels: L.Marker[] = [];
  private _gridOpts: Required<GridLayerOptions>;
  private _config: GridLayerConfig;

  constructor(config: GridLayerConfig, options?: GridLayerOptions) {
    super([], options);
    this._config = config;
    this._gridOpts = { ...DEFAULT_OPTIONS, ...options };
  }

  onAdd(map: L.Map): this {
    super.onAdd(map);
    this._updateGrid();
    map.on("zoomend", this._updateGrid, this);
    map.on("moveend", this._updateGrid, this);
    return this;
  }

  onRemove(map: L.Map): this {
    map.off("zoomend", this._updateGrid, this);
    map.off("moveend", this._updateGrid, this);
    this._clearGrid();
    super.onRemove(map);
    return this;
  }

  private _clearGrid(): void {
    this.clearLayers();
    this._gridLines = [];
    this._gridLabels = [];
  }

  private _updateGrid(): void {
    this._clearGrid();

    const map = (this as any)._map as L.Map | undefined;
    if (!map) return;

    const { worldSize, useMapLibreMode, armaToLatLng, latLngToArma } = this._config;

    const bounds = map.getBounds();
    const zoom = map.getZoom();
    const { major, minor } = getGridLevels(zoom, useMapLibreMode);

    // Convert map bounds to Arma coordinates
    const sw = latLngToArma(bounds.getSouthWest());
    const ne = latLngToArma(bounds.getNorthEast());

    const finest = minor ?? major;
    const armaBounds = {
      minX: Math.max(0, Math.floor(sw[0] / finest) * finest),
      maxX: Math.min(worldSize, Math.ceil(ne[0] / finest) * finest),
      minY: Math.max(0, Math.floor(sw[1] / finest) * finest),
      maxY: Math.min(worldSize, Math.ceil(ne[1] / finest) * finest),
    };

    const minorWeight = Math.max(0.5, this._gridOpts.lineWeight * 0.5);
    const majorWeight = this._gridOpts.lineWeight;

    // --- Minor grid lines (thinner, no labels) ---
    if (minor) {
      const minorLines = computeGridLines(armaBounds, minor);
      for (const x of minorLines.x) {
        if (x % major === 0) continue; // skip major positions
        const line = L.polyline(
          [armaToLatLng([x, armaBounds.minY]), armaToLatLng([x, armaBounds.maxY])],
          { color: this._gridOpts.lineColor, weight: minorWeight, opacity: 0.4, interactive: false },
        );
        this.addLayer(line);
        this._gridLines.push(line);
      }
      for (const y of minorLines.y) {
        if (y % major === 0) continue;
        const line = L.polyline(
          [armaToLatLng([armaBounds.minX, y]), armaToLatLng([armaBounds.maxX, y])],
          { color: this._gridOpts.lineColor, weight: minorWeight, opacity: 0.4, interactive: false },
        );
        this.addLayer(line);
        this._gridLines.push(line);
      }
    }

    // --- Major grid lines (thicker, with labels) ---
    const majorBounds = {
      minX: Math.max(0, Math.floor(sw[0] / major) * major),
      maxX: Math.min(worldSize, Math.ceil(ne[0] / major) * major),
      minY: Math.max(0, Math.floor(sw[1] / major) * major),
      maxY: Math.min(worldSize, Math.ceil(ne[1] / major) * major),
    };
    const majorLines = computeGridLines(majorBounds, major);

    for (const x of majorLines.x) {
      const line = L.polyline(
        [armaToLatLng([x, armaBounds.minY]), armaToLatLng([x, armaBounds.maxY])],
        { color: this._gridOpts.lineColor, weight: majorWeight, interactive: false },
      );
      this.addLayer(line);
      this._gridLines.push(line);

      if (this._gridOpts.showLabels) {
        const label = this._createLabel(
          formatCoordLabel(x, major), armaToLatLng([x, armaBounds.minY]), "bottom",
        );
        this.addLayer(label);
        this._gridLabels.push(label);
      }
    }

    for (const y of majorLines.y) {
      const line = L.polyline(
        [armaToLatLng([armaBounds.minX, y]), armaToLatLng([armaBounds.maxX, y])],
        { color: this._gridOpts.lineColor, weight: majorWeight, interactive: false },
      );
      this.addLayer(line);
      this._gridLines.push(line);

      if (this._gridOpts.showLabels) {
        const label = this._createLabel(
          formatCoordLabel(y, major), armaToLatLng([armaBounds.minX, y]), "left",
        );
        this.addLayer(label);
        this._gridLabels.push(label);
      }
    }
  }

  private _createLabel(
    text: string,
    position: L.LatLng,
    edge: "bottom" | "left",
  ): L.Marker {
    const className = `grid-label grid-label-${edge}`;

    const icon = L.divIcon({
      className,
      html: `<span>${text}</span>`,
      iconSize: [30, 14],
      iconAnchor: edge === "left" ? [0, 7] : [15, 0],
    });

    return L.marker(position, {
      icon,
      interactive: false,
      keyboard: false,
    });
  }
}

/**
 * Factory function for creating a GridLayer.
 */
export function createGridLayer(
  config: GridLayerConfig,
  options?: GridLayerOptions,
): GridLayer {
  return new GridLayer(config, options);
}
