import type { ArmaCoord } from "./coordinates";

/**
 * Return the equivalent angle to `to` that is closest to `from`,
 * picking the shortest rotation path across the 360-degree boundary.
 *
 * Example: closestEquivalentAngle(350, 10) returns 370 (rotate +20
 * instead of -340).
 */
export function closestEquivalentAngle(from: number, to: number): number {
  const delta = ((((to - from) % 360) + 540) % 360) - 180;
  return from + delta;
}

/** Euclidean distance between two 2D Arma coordinates. */
export function distance2D(a: ArmaCoord, b: ArmaCoord): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * If a unit moves more than this many meters in one frame,
 * treat it as a teleport and skip the animation.
 */
export const SKIP_ANIMATION_DISTANCE = 222;
