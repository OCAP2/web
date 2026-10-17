/**
 * Scale-bar math in Arma metres. Leaflet's own Control.Scale cannot be used:
 *
 * - Its CRS.distance for the legacy Simple CRS is lat/lng units, not metres
 *   (off by 2^maxNativeZoom). That is why the bar looked short at every zoom.
 * - `_getRoundNum` uses `String(Math.floor(num)).length`, so any span under
 *   1 m collapses to "1 m" and never switches to centimetres.
 */

import type { ArmaCoord } from "../../utils/coordinates";

/** Leaflet's default scale-bar target width. */
export const SCALE_MAX_WIDTH_PX = 100;

/** Smallest labelled distance: 1 cm. */
export const SCALE_MIN_METERS = 0.01;

/**
 * Largest 1-2-5 value that still fits in `maxMeters`.
 * Works below 1 m (unlike Leaflet's integer-only `_getRoundNum`).
 */
export function niceScaleDistance(maxMeters: number): number {
  if (!Number.isFinite(maxMeters) || maxMeters <= 0) return SCALE_MIN_METERS;
  const clamped = Math.max(maxMeters, SCALE_MIN_METERS);
  const exp = Math.floor(Math.log10(clamped));
  const mantissa = clamped / 10 ** exp;
  const nice = mantissa >= 5 ? 5 : mantissa >= 2 ? 2 : 1;
  // Scientific notation keeps 1-2-5 values exact (2e-1 === 0.2).
  return Number(`${nice}e${exp}`);
}

/** Label for a 1-2-5 metre value: km, m, or cm. */
export function formatScaleLabel(meters: number): string {
  if (meters >= 1000) {
    const km = meters / 1000;
    return `${formatNiceNumber(km)} km`;
  }
  if (meters >= 1) {
    return `${formatNiceNumber(meters)} m`;
  }
  return `${Math.round(meters * 100)} cm`;
}

function formatNiceNumber(value: number): string {
  // 1-2-5 values are exact in decimal; strip IEEE noise (0.1 * 5 → 0.5000…).
  const rounded = Math.round(value * 1e6) / 1e6;
  return String(rounded);
}

/** Pixel width of a bar representing `niceMeters` inside a `maxMeters` span. */
export function scaleBarWidthPx(
  niceMeters: number,
  maxMeters: number,
  maxWidth = SCALE_MAX_WIDTH_PX,
): number {
  if (!(maxMeters > 0) || !(niceMeters > 0)) return maxWidth;
  return Math.max(1, Math.round(maxWidth * (niceMeters / maxMeters)));
}

/** Planar distance in Arma metres between two world positions. */
export function armaMetersBetween(
  a: ArmaCoord,
  b: ArmaCoord,
): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}
