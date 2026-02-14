/** Arma coordinate in meters: [x, y] or [x, y, z] with elevation. */
export type ArmaCoord = [number, number] | [number, number, number];

/**
 * Meters per degree at the equator.
 * Used to convert Arma world-space meters to WGS-84 degrees.
 * ~0.1% error, no proj4 needed.
 */
export const METERS_PER_DEGREE = 111320;
