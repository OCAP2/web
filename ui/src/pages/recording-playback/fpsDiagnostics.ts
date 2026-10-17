import type { PlaybackEngine } from "../../playback/engine";
import { Unit } from "../../playback/entities/unit";

/**
 * Server FPS diagnostics: every FPS sample beside how much the server was
 * simulating at that moment, so a dip can be read against load.
 *
 * Counts are taken at the FPS sample frames themselves, which is what lets a
 * dip and the population at that dip be compared one to one (the tooltip, the
 * lowest-moments list and the correlation all rely on that pairing). A
 * recording without FPS samples still gets counts, on a regular grid.
 */

export interface FpsSample {
  frame: number;
  fps: number;
}

export interface PopulationSample {
  frame: number;
  /** Men that are alive or unconscious, players and AI together. */
  units: number;
  players: number;
  ai: number;
  /** Vehicles that are not destroyed, static weapons included. */
  vehicles: number;
}

export type PopulationKey = "units" | "vehicles" | "players" | "ai";

/** The tile and chart thresholds. The bands below 30 are the ones worth a look. */
export const FPS_CRITICAL = 20;
export const FPS_LOW = 30;
export const FPS_GOOD = 60;

export function fpsColor(value: number): string {
  if (value >= FPS_GOOD) return "var(--accent-success)";
  if (value >= FPS_LOW) return "var(--accent-warning)";
  if (value >= FPS_CRITICAL) return "#ff8a3d";
  return "var(--accent-danger)";
}

export function formatFps(value: number): string {
  return value.toFixed(1);
}

/** Seconds between grid points when there are no FPS samples to count at. */
const GRID_SECONDS = 10;
/** Upper bound on grid points, so a very long recording stays cheap to count. */
const MAX_GRID_POINTS = 1500;

/**
 * Frames to count the population at: the FPS sample frames when there are
 * enough of them to draw a line, otherwise a regular grid across the mission.
 */
export function populationFrames(
  fps: readonly FpsSample[],
  endFrame: number,
  captureDelayMs: number,
): number[] {
  if (fps.length >= 2) return [...new Set(fps.map((sample) => sample.frame))];
  if (endFrame <= 0) return [0];

  const perGrid = Math.max(1, Math.round((GRID_SECONDS * 1000) / (captureDelayMs || 1000)));
  const step = Math.max(perGrid, Math.ceil(endFrame / MAX_GRID_POINTS));
  const frames: number[] = [];
  for (let frame = 0; frame < endFrame; frame += step) frames.push(frame);
  frames.push(endFrame);
  return frames;
}

/**
 * Count alive units, players, AI and vehicles at each requested frame.
 *
 * Zeus is a camera, not a simulated unit, and is left out. A destroyed vehicle
 * or a dead body is left out too: the point is what the server is actively
 * simulating, and an unconscious man still is.
 */
export async function buildPopulationSamples(
  engine: PlaybackEngine,
  frames: readonly number[],
): Promise<PopulationSample[]> {
  const sorted = [...new Set(frames)].sort((a, b) => a - b);
  const counted = new Map<number, PopulationSample>();
  const entities = engine.entityManager.getAll().filter((entity) => entity.type !== "zeus");

  let cursor = 0;
  await engine.visitAllFrames((firstFrame, lastFrame, stateAt) => {
    while (cursor < sorted.length && sorted[cursor] < firstFrame) cursor++;
    for (; cursor < sorted.length && sorted[cursor] <= lastFrame; cursor++) {
      const frame = sorted[cursor];
      const sample: PopulationSample = { frame, units: 0, players: 0, ai: 0, vehicles: 0 };
      for (const entity of entities) {
        if (frame < entity.startFrame || frame > entity.endFrame) continue;
        const state = stateAt(entity.id, frame);
        if (!state || state.alive === 0) continue;
        if (entity instanceof Unit) {
          sample.units += 1;
          if (state.isPlayer === true) sample.players += 1;
          else sample.ai += 1;
        } else {
          sample.vehicles += 1;
        }
      }
      counted.set(frame, sample);
    }
  });

  return sorted.map(
    (frame) => counted.get(frame) ?? { frame, units: 0, players: 0, ai: 0, vehicles: 0 },
  );
}

/**
 * The lowest samples, at most `count`, no two closer than `minGapFrames`.
 *
 * One bad minute is a run of low samples; without the gap the list would be
 * five neighbours of the same dip. The first entry is the recording's minimum,
 * the earliest one on a tie.
 */
export function findLowestDips(
  samples: readonly FpsSample[],
  count: number,
  minGapFrames: number,
): FpsSample[] {
  const ranked = [...samples].sort((a, b) => a.fps - b.fps || a.frame - b.frame);
  const picked: FpsSample[] = [];
  for (const sample of ranked) {
    if (picked.length >= count) break;
    if (picked.some((other) => Math.abs(other.frame - sample.frame) < minGapFrames)) continue;
    picked.push(sample);
  }
  return picked;
}

/** Pearson correlation, or null when there is too little data or no variation. */
export function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;

  let meanX = 0;
  let meanY = 0;
  for (let i = 0; i < n; i++) {
    meanX += xs[i];
    meanY += ys[i];
  }
  meanX /= n;
  meanY /= n;

  let covariance = 0;
  let varianceX = 0;
  let varianceY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    covariance += dx * dy;
    varianceX += dx * dx;
    varianceY += dy * dy;
  }
  if (varianceX === 0 || varianceY === 0) return null;
  return covariance / Math.sqrt(varianceX * varianceY);
}

export type CorrelationStrength = "none" | "weak" | "moderate" | "strong";

export function correlationStrength(r: number): CorrelationStrength {
  const magnitude = Math.abs(r);
  if (magnitude >= 0.7) return "strong";
  if (magnitude >= 0.4) return "moderate";
  if (magnitude >= 0.2) return "weak";
  return "none";
}

/** Index of the frame closest to `frame` in an ascending list, or -1 when empty. */
export function nearestIndex(frames: readonly number[], frame: number): number {
  if (frames.length === 0) return -1;
  let low = 0;
  let high = frames.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (frames[mid] < frame) low = mid + 1;
    else high = mid;
  }
  if (low > 0 && frame - frames[low - 1] <= frames[low] - frame) return low - 1;
  return low;
}

/**
 * A rounded axis top and its ticks: steps of 1, 2 or 5 times a power of ten,
 * with a little headroom so a line never runs along the top edge.
 */
export function niceScale(maxValue: number, targetTicks = 5): { max: number; ticks: number[] } {
  const top = Math.max(1, maxValue * 1.08);
  const rough = top / Math.max(1, targetTicks);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? 10 * magnitude;
  const max = Math.ceil(top / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= max + step / 2; value += step) ticks.push(value);
  return { max, ticks };
}

const TIME_TICK_SECONDS = [10, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600];

/** Frames for time-axis ticks on round elapsed-time marks, at most `maxTicks` of them. */
export function timeTicks(endFrame: number, captureDelayMs: number, maxTicks: number): number[] {
  if (endFrame <= 0) return [0];
  const msPerFrame = captureDelayMs || 1000;
  const limit = Math.max(2, maxTicks);
  const seconds =
    TIME_TICK_SECONDS.find((s) => (endFrame * msPerFrame) / (s * 1000) <= limit) ??
    TIME_TICK_SECONDS[TIME_TICK_SECONDS.length - 1];
  const stepFrames = (seconds * 1000) / msPerFrame;
  const ticks: number[] = [];
  for (let frame = 0; frame <= endFrame; frame += stepFrames) ticks.push(Math.round(frame));
  return ticks;
}
