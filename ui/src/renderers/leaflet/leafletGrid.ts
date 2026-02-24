/**
 * L.Layer.Grid — Coordinate grid overlay for Leaflet maps.
 * Displays grid lines at zoom-adaptive intervals with coordinate labels
 * in the Arma coordinate system.
 *
 * TypeScript port of static/leaflet/L.Layer.Grid.js
 */
import L from "leaflet";
import type { ArmaCoord } from "../../utils/coordinates";
import { getGridInterval, formatCoordLabel, computeGridLines } from "./gridUtils";

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
    const interval = getGridInterval(zoom, useMapLibreMode);

    // Convert map bounds to Arma coordinates
    const sw = latLngToArma(bounds.getSouthWest());
    const ne = latLngToArma(bounds.getNorthEast());

    // Clamp to world bounds
    const armaBounds = {
      minX: Math.max(0, Math.floor(sw[0] / interval) * interval),
      maxX: Math.min(worldSize, Math.ceil(ne[0] / interval) * interval),
      minY: Math.max(0, Math.floor(sw[1] / interval) * interval),
      maxY: Math.min(worldSize, Math.ceil(ne[1] / interval) * interval),
    };

    const gridLines = computeGridLines(armaBounds, interval);

    // Draw vertical lines (constant X)
    for (const x of gridLines.x) {
      const start = armaToLatLng([x, armaBounds.minY]);
      const end = armaToLatLng([x, armaBounds.maxY]);

      const line = L.polyline([start, end], {
        color: this._gridOpts.lineColor,
        weight: this._gridOpts.lineWeight,
        interactive: false,
      });
      this.addLayer(line);
      this._gridLines.push(line);

      // Add label at bottom
      if (this._gridOpts.showLabels) {
        const labelPos = armaToLatLng([x, armaBounds.minY]);
        const label = this._createLabel(
          formatCoordLabel(x, interval),
          labelPos,
          "bottom",
        );
        this.addLayer(label);
        this._gridLabels.push(label);
      }
    }

    // Draw horizontal lines (constant Y)
    for (const y of gridLines.y) {
      const start = armaToLatLng([armaBounds.minX, y]);
      const end = armaToLatLng([armaBounds.maxX, y]);

      const line = L.polyline([start, end], {
        color: this._gridOpts.lineColor,
        weight: this._gridOpts.lineWeight,
        interactive: false,
      });
      this.addLayer(line);
      this._gridLines.push(line);

      // Add label at left edge
      if (this._gridOpts.showLabels) {
        const labelPos = armaToLatLng([armaBounds.minX, y]);
        const label = this._createLabel(
          formatCoordLabel(y, interval),
          labelPos,
          "left",
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
