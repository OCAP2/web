/**
 * Custom Leaflet controls for the OCAP2 map UI.
 */
import L from "leaflet";

/**
 * Create a standard Leaflet scale control with metric units.
 */
export function createScaleControl(): L.Control.Scale {
  return L.control.scale({
    metric: true,
    imperial: false,
    position: "bottomleft",
  });
}

/**
 * Style candidate used by the leafletRenderer for MapLibre style probing.
 */
export interface StyleCandidate {
  label: string;
  url: string;
  iconURL?: string;
}
