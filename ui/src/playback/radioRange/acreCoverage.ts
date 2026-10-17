import {
  ACRE_DEFAULT_FREQUENCY_MHZ,
  ACRE_PROFILE_STEP_METERS,
  TFAR_EYE_HEIGHT_METERS,
  acreAppliesTerrain,
  type AcreRadioPropagation,
} from "../../data/radioPropagation";
import { sampleDem, projectCoverageOrigin, shiftCoveragePoints, type DemGrid } from "./demGrid";

export interface AcreCoverageOptions {
  rangeMeters: number;
  propagation: AcreRadioPropagation;
  /** TX frequency in MHz. ITU first-Fresnel radius depends on it. */
  frequencyMHz?: number;
  /** Extra height added to DEM samples (forest canopy). Default 0. */
  canopyMeters?: number;
  eyeHeightMeters?: number;
  bearings?: number;
}

const DEFAULT_BEARINGS = 64;
/** Local-max prominence before a sample counts as an ITU knife-edge. */
const ACRE_PEAK_PROMINENCE_METERS = 0.5;

function heightAt(grid: DemGrid, x: number, y: number, canopy: number): number {
  return sampleDem(grid, x, y) + canopy;
}

/**
 * ITU-R P.526 single knife-edge, matching ACRE `los_simple::itu`.
 * `h` is ray height minus terrain at the peak (negative when the hill
 * sticks above the ray). Loss below 6 dB is ignored.
 */
export function ituKnifeEdge(h: number, d1Km: number, d2Km: number, fGhz: number): number {
  if (d1Km <= 0 || d2Km <= 0 || fGhz <= 0) return 0;
  const d = d1Km + d2Km;
  const f1 = 17.3 * Math.sqrt((d1Km * d2Km) / (fGhz * d));
  if (!(f1 > 0)) return 0;
  const a = (-20 * h) / f1 + 10;
  return a < 6 ? 0 : a;
}

/**
 * Port of ACRE `los_simple::diffraction_loss`: 7.5 m terrain profile, add
 * ITU loss at local maxima. Does not use TFAR's T or coefficient.
 */
export function acreDiffractionLoss(
  grid: DemGrid,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  frequencyMHz: number,
  canopy = 0,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const dist3d = Math.hypot(dx, dy, dz);
  if (dist3d <= 0) return 0;

  const step = ACRE_PROFILE_STEP_METERS;
  const count = Math.max(2, Math.floor(dist3d / step) + 1);
  if (count < 4) return 0;

  const inv = step / dist3d;
  const stepX = dx * inv;
  const stepY = dy * inv;
  const stepZ = dz * inv;
  const profile = new Array<number>(count);
  for (let i = 0; i < count; i++) {
    profile[i] = heightAt(grid, ax + stepX * i, ay + stepY * i, canopy);
  }

  const total2d = Math.hypot(dx, dy);
  const fGhz = frequencyMHz / 1000;
  let loss = 0;
  for (let c = 0; c < count - 1; c++) {
    const sample = profile[c];
    const last = profile[Math.max(c - 1, 0)];
    const next = profile[Math.min(c + 1, count - 1)];
    // Bilinear sampling of a plateau is not bit-exact. ITU still bills ~10 dB
    // for a 1.6 m clearance when F1 is large, so ulp "peaks" shrink range to
    // ~500 m on otherwise flat ground. Real DEM hills are much taller.
    if (
      !(
        sample - last >= ACRE_PEAK_PROMINENCE_METERS &&
        sample - next >= ACRE_PEAK_PROMINENCE_METERS
      )
    ) {
      continue;
    }
    const peakZ = az + stepZ * c;
    const d1 = Math.hypot(stepX * c, stepY * c);
    const d2 = total2d - d1;
    loss += ituKnifeEdge(peakZ - sample, d1 / 1000, d2 / 1000, fGhz);
  }
  return loss;
}

/**
 * In-range using the recorded `rangeMeters` as the flat-ground budget, then
 * shrinking by ACRE diffraction × `terrainLoss`. Arcade or terrainLoss 0 is
 * a circle. Never reads TFAR's coefficient.
 *
 * Extra dB of diffraction is converted with `d * 10^(loss/20) <= range`,
 * which is the same as comparing FSPL(d)+diffraction against FSPL(range).
 */
export function inAcreRange(
  grid: DemGrid,
  tx: number,
  ty: number,
  tz: number,
  rx: number,
  ry: number,
  rz: number,
  rangeMeters: number,
  propagation: AcreRadioPropagation,
  frequencyMHz = ACRE_DEFAULT_FREQUENCY_MHZ,
  canopy = 0,
): boolean {
  const d = Math.hypot(tx - rx, ty - ry, tz - rz);
  if (d > rangeMeters) return false;
  if (!acreAppliesTerrain(propagation)) return true;

  const freq = frequencyMHz > 0 ? frequencyMHz : ACRE_DEFAULT_FREQUENCY_MHZ;
  const diffraction =
    acreDiffractionLoss(grid, tx, ty, tz, rx, ry, rz, freq, canopy) * propagation.terrainLoss;
  return d * 10 ** (diffraction / 20) <= rangeMeters;
}

export function marchAcreCoverage(
  grid: DemGrid,
  origin: [number, number, number?],
  options: AcreCoverageOptions,
): [number, number][] {
  const range = Math.max(0, options.rangeMeters);
  const eye = options.eyeHeightMeters ?? TFAR_EYE_HEIGHT_METERS;
  const canopy = options.canopyMeters ?? 0;
  const bearings = Math.max(8, options.bearings ?? DEFAULT_BEARINGS);
  const freq =
    typeof options.frequencyMHz === "number" && options.frequencyMHz > 0
      ? options.frequencyMHz
      : ACRE_DEFAULT_FREQUENCY_MHZ;
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
    let hi = range;
    for (let step = 0; step < 12; step++) {
      const mid = (lo + hi) / 2;
      const rx = tx + dx * mid;
      const ry = ty + dy * mid;
      const rz = heightAt(grid, rx, ry, 0) + eye;
      if (inAcreRange(grid, tx, ty, tz, rx, ry, rz, range, options.propagation, freq, canopy)) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    verts.push([tx + dx * lo, ty + dy * lo]);
  }
  return shiftCoveragePoints(verts, projected.shiftX, projected.shiftY);
}
