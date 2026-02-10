/**
 * Return the transition duration (in seconds) for a given playback speed.
 *
 * This is a pure function with no DOM dependencies.
 */
export function getTransitionDuration(speed: number): number {
  if (speed >= 10) return 0.15;
  if (speed < 1) return 1;
  // speed 1 → 1.0, speed 2 → 0.9, …, speed 9 → 0.2
  return Math.round((1.1 - speed * 0.1) * 100) / 100;
}
