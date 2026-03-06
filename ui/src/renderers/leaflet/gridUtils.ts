/**
 * Pure utility functions for coordinate grid computation.
 * These are extracted from the grid overlay for testability.
 */

/**
 * Major + optional minor grid intervals for a given zoom level.
 */
export interface GridLevels {
  major: number;
  minor: number | null;
}

/**
 * Get major and minor grid intervals for a given zoom level.
 *
 * Matches Arma 3's map grid behaviour:
 * - Zoomed out: only major grid (10km or 1km)
 * - Zoomed in: major grid (1km, thicker) + minor sub-grid (100m, thinner)
 *
 * Legacy mode uses zoom levels ~0-8, MapLibre mode uses ~10-20.
 */
export function getGridLevels(
  zoom: number,
  useMapLibreMode: boolean,
): GridLevels {
  if (useMapLibreMode) {
    if (zoom <= 12) return { major: 10000, minor: null };
    if (zoom <= 15) return { major: 10000, minor: 1000 };
    return { major: 1000, minor: 100 };
  }

  // Legacy mode
  if (zoom <= 2) return { major: 10000, minor: null };
  if (zoom <= 5) return { major: 10000, minor: 1000 };
  return { major: 1000, minor: 100 };
}

/**
 * Format a coordinate value as a human-readable label.
 * Values >= 1000m are shown in km, otherwise in meters.
 */
export function formatGridLabel(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(0)}km`;
  }
  return `${meters.toFixed(0)}m`;
}

/**
 * Format a grid coordinate label using Arma 3's grid reference convention.
 *
 * Each grid level adds one digit of precision:
 * - 10km (10000m): 1 digit  → "0", "1", "2", "3"
 * - 1km  (1000m):  2 digits → "00", "01", ... "30"
 * - 100m:          3 digits → "000", "001", ... "307"
 */
export function formatCoordLabel(value: number, interval: number): string {
  switch (interval) {
    case 10000:
      return String(value / 10000);
    case 1000:
      return String(value / 1000).padStart(2, "0");
    case 100:
      return String(value / 100).padStart(3, "0");
    default:
      return String(value);
  }
}

/**
 * Compute the positions of grid lines within given bounds,
 * snapped to the specified interval.
 *
 * @param bounds - The visible area in Arma coordinates
 * @param interval - Grid spacing in Arma meters
 * @returns Arrays of x and y positions where grid lines should be drawn
 */
export function computeGridLines(
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
  interval: number,
): { x: number[]; y: number[] } {
  const startX = Math.floor(bounds.minX / interval) * interval;
  const endX = Math.ceil(bounds.maxX / interval) * interval;
  const startY = Math.floor(bounds.minY / interval) * interval;
  const endY = Math.ceil(bounds.maxY / interval) * interval;

  const x: number[] = [];
  for (let v = startX; v <= endX; v += interval) {
    x.push(v);
  }

  const y: number[] = [];
  for (let v = startY; v <= endY; v += interval) {
    y.push(v);
  }

  return { x, y };
}
