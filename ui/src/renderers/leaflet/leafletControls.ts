/**
 * Custom Leaflet controls for the OCAP2 map UI.
 */
import L from "leaflet";
import type { ArmaCoord } from "../../utils/coordinates";
import {
  armaMetersBetween,
  formatScaleLabel,
  niceScaleDistance,
  SCALE_MAX_WIDTH_PX,
  scaleBarWidthPx,
} from "./scaleBar";

/** Convert a Leaflet LatLng back to Arma [x, y] metres. */
export type LatLngToArmaFn = (latlng: L.LatLng) => ArmaCoord;

/**
 * Scale bar labelled in Arma metres (then cm past 1 m).
 *
 * Leaflet's Control.Scale is not used: its Simple-CRS distance is not metres,
 * and its rounder cannot represent distances below 1 m.
 *
 * Built with `L.Control.extend` (not an ES6 subclass) so Leaflet's event
 * `on`/`off` context matches the instance the way the built-in scale does.
 */
const OcapScaleControl = L.Control.extend({
  options: {
    position: "bottomleft",
    maxWidth: SCALE_MAX_WIDTH_PX,
  },

  initialize(this: any, latLngToArma: LatLngToArmaFn) {
    L.Util.setOptions(this, { position: "bottomleft", maxWidth: SCALE_MAX_WIDTH_PX });
    this._latLngToArma = latLngToArma;
  },

  onAdd(this: any, map: L.Map): HTMLElement {
    this._map = map;
    const container = L.DomUtil.create("div", "leaflet-control-scale");
    this._line = L.DomUtil.create("div", "leaflet-control-scale-line", container);
    map.on("move zoomend", this._update, this);
    map.whenReady(this._update, this);
    return container;
  },

  onRemove(this: any, map: L.Map): void {
    map.off("move zoomend", this._update, this);
  },

  _update(this: any): void {
    const map: L.Map | undefined = this._map;
    const line: HTMLDivElement | undefined = this._line;
    const latLngToArma: LatLngToArmaFn | undefined = this._latLngToArma;
    if (!map || !line || !latLngToArma) return;

    const maxWidth: number = this.options.maxWidth ?? SCALE_MAX_WIDTH_PX;
    const y = map.getSize().y / 2;
    const from = map.containerPointToLatLng([0, y]);
    const to = map.containerPointToLatLng([maxWidth, y]);
    const maxMeters = armaMetersBetween(latLngToArma(from), latLngToArma(to));
    const nice = niceScaleDistance(maxMeters);
    line.style.width = `${scaleBarWidthPx(nice, maxMeters, maxWidth)}px`;
    line.textContent = formatScaleLabel(nice);
  },
});

/**
 * Create a metric scale control that measures Arma world metres.
 */
export function createScaleControl(latLngToArma: LatLngToArmaFn): L.Control {
  return new (OcapScaleControl as any)(latLngToArma);
}

/**
 * Style candidate used by the leafletRenderer for MapLibre style probing.
 */
export interface StyleCandidate {
  label: string;
  url: string;
  iconURL?: string;
}
