import {
  TFAR_DISTANCE_SCALE_METERS,
  TFAR_EYE_HEIGHT_METERS,
  TFAR_T_MAX_METERS,
  TFAR_T_MIN_METERS,
  TFAR_T_SEARCH_EPSILON,
  type TfarRadioPropagation,
} from "../../data/radioPropagation";
import { sampleDem, projectCoverageOrigin, shiftCoveragePoints, type DemGrid } from "./demGrid";

export interface CoverageOptions {
  rangeMeters: number;
  propagation: TfarRadioPropagation;
  /** Extra height added to DEM samples (forest canopy). Default 0. */
  canopyMeters?: number;
  eyeHeightMeters?: number;
  bearings?: number;
}

const DEFAULT_BEARINGS = 64;

function dist3(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function heightAt(grid: DemGrid, x: number, y: number, canopy: number): number {
  return sampleDem(grid, x, y) + canopy;
}

/**
 * Approximate `terrainIntersectASL`. Samples the DEM along the 3D line and
 * reports a hit when terrain (plus optional canopy) rises above the line.
 */
export function terrainIntersects(
  grid: DemGrid,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  canopy = 0,
): boolean {
  const horizontal = Math.hypot(bx - ax, by - ay);
  if (horizontal < 1) return false;
  const step = Math.max(grid.cellSize, horizontal / 80);
  const samples = Math.max(2, Math.ceil(horizontal / step));
  for (let i = 1; i < samples; i++) {
    const t = i / samples;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    const z = az + (bz - az) * t;
    if (heightAt(grid, x, y, canopy) > z + 0.5) return true;
  }
  return false;
}

/**
 * Port of `TFAR_fnc_calcTerrainInterception`: extra metres of midpoint height
 * needed to clear the ridge, binary-searched in [10, 250].
 */
export function calcTerrainInterception(
  grid: DemGrid,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  canopy = 0,
): number {
  if (!terrainIntersects(grid, ax, ay, az, bx, by, bz, canopy)) return 0;

  const mx = (ax + bx) * 0.5;
  const my = (ay + by) * 0.5;
  const baseZ = (az + bz) * 0.5;
  let lo = TFAR_T_MIN_METERS;
  let hi = TFAR_T_MAX_METERS;
  let mid = 100;
  while (hi - lo > TFAR_T_SEARCH_EPSILON) {
    const lifted = baseZ + mid;
    const clear =
      !terrainIntersects(grid, ax, ay, az, mx, my, lifted, canopy) &&
      !terrainIntersects(grid, bx, by, bz, mx, my, lifted, canopy);
    if (clear) hi = mid;
    else lo = mid;
    mid = (lo + hi) / 2;
  }
  return mid;
}

/**
 * TFAR `effectiveDistanceTo`, then compared against `range * globalRadioRangeCoef`
 * because the plugin multiplies effective distance by `1 / TFAR_globalRadioRangeCoef`.
 */
export function effectiveDistance(
  d: number,
  terrainInterception: number,
  propagation: TfarRadioPropagation,
): number {
  const c = propagation.terrainInterceptionCoefficient;
  const scaled = d + terrainInterception * c + terrainInterception * c * (d / TFAR_DISTANCE_SCALE_METERS);
  return scaled / propagation.globalRadioRangeCoef;
}

export function inTfarRange(
  grid: DemGrid,
  tx: number,
  ty: number,
  tz: number,
  rx: number,
  ry: number,
  rz: number,
  rangeMeters: number,
  propagation: TfarRadioPropagation,
  canopy = 0,
): boolean {
  const d = dist3(tx, ty, tz, rx, ry, rz);
  const t = calcTerrainInterception(grid, tx, ty, tz, rx, ry, rz, canopy);
  return effectiveDistance(d, t, propagation) <= rangeMeters;
}

export function marchCoverage(
  grid: DemGrid,
  origin: [number, number, number?],
  options: CoverageOptions,
): [number, number][] {
  const range = Math.max(0, options.rangeMeters);
  const maxDistance = range * options.propagation.globalRadioRangeCoef;
  const eye = options.eyeHeightMeters ?? TFAR_EYE_HEIGHT_METERS;
  const canopy = options.canopyMeters ?? 0;
  const bearings = Math.max(8, options.bearings ?? DEFAULT_BEARINGS);
  const projected = projectCoverageOrigin(grid, origin);
  const tx = projected.x;
  const ty = projected.y;
  const tz = projected.offDem
    ? heightAt(grid, tx, ty, 0) + eye
    : (origin[2] ?? heightAt(grid, tx, ty, 0)) + eye;

  const verts: [number, number][] = [];
  for (let i = 0; i < bearings; i++) {
    const angle = (i / bearings) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    let lo = 0;
    let hi = maxDistance;
    for (let step = 0; step < 12; step++) {
      const mid = (lo + hi) / 2;
      const rx = tx + dx * mid;
      const ry = ty + dy * mid;
      const rz = heightAt(grid, rx, ry, 0) + eye;
      if (inTfarRange(grid, tx, ty, tz, rx, ry, rz, range, options.propagation, canopy)) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    verts.push([tx + dx * lo, ty + dy * lo]);
  }
  return shiftCoveragePoints(verts, projected.shiftX, projected.shiftY);
}
