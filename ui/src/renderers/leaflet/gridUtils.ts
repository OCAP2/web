/**
 * Pure utility functions for coordinate grid computation.
 * These are extracted from the grid overlay for testability.
 */

/**
 * Get the grid interval (in Arma meters) for a given zoom level.
 *
 * Legacy mode uses zoom levels ~0-8, MapLibre mode uses ~10-20.
 * Returns spacing: 5000 (5km), 1000 (1km), 500 (500m), or 100 (100m).
 */
export function getGridInterval(
  zoom: number,
  useMapLibreMode: boolean,
): number {
  if (useMapLibreMode) {
    if (zoom <= 12) return 5000;
    if (zoom <= 14) return 1000;
    if (zoom <= 16) return 500;
    return 100;
  }

  // Legacy mode
  if (zoom <= 2) return 5000;
  if (zoom <= 4) return 1000;
  if (zoom <= 6) return 500;
  return 100;
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
 * Format a grid coordinate label for display on the grid.
 * When the interval is >= 1000m, show km (just the number).
 * Otherwise show meters (just the number).
 */
export function formatCoordLabel(value: number, interval: number): string {
  if (interval >= 1000) {
    return (value / 1000).toFixed(0);
  }
  return value.toFixed(0);
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
