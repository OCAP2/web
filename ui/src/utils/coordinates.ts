/** 2D Arma coordinate [x, y] in meters. */
export type ArmaCoord = [number, number];

/** 3D Arma coordinate [x, y, z] with elevation in meters. */
export type ArmaCoord3D = [number, number, number];

/**
 * Meters per degree at the equator.
 * Used to convert Arma world-space meters to WGS-84 degrees.
 * ~0.1% error, no proj4 needed.
 */
export const METERS_PER_DEGREE = 111320;
