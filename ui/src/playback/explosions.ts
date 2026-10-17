/**
 * How long a blast circle stays on the map, in seconds of playback time. Short
 * on purpose: an explosion is an instant, and the circle is there to show where
 * and how big, not to accumulate into a heat map. The event itself stays in the
 * event log forever.
 */
export const EXPLOSION_MAP_SECONDS = 6;

/** Seconds of that lifetime spent fading out. */
export const EXPLOSION_FADE_SECONDS = 4;

/**
 * Fill opacity of a fresh blast circle. Matched to the renderer ceiling for a
 * "Solid" brush, which clamps fill to min(0.3, alpha): anything higher would sit
 * flat at the cap and only start fading in the last moments.
 */
export const EXPLOSION_PEAK_ALPHA = 0.3;

/**
 * The blast lifetime in frames. Derived rather than hardcoded, because
 * captureDelayMs comes from the manifest and is not always 1000.
 */
export function explosionLifetimeFrames(captureDelayMs: number): number {
  if (!Number.isFinite(captureDelayMs) || captureDelayMs <= 0) {
    return EXPLOSION_MAP_SECONDS;
  }
  return Math.max(1, Math.round((EXPLOSION_MAP_SECONDS * 1000) / captureDelayMs));
}

/**
 * Opacity for a blast circle at `frame`. Full strength on the frame it happens,
 * then a linear ramp to nothing, so a barrage reads as a sequence rather than as
 * one solid mass.
 */
export function explosionAlpha(
  frame: number,
  eventFrame: number,
  lifetimeFrames: number,
): number {
  const age = frame - eventFrame;
  if (age < 0 || age >= lifetimeFrames) return 0;

  const fade = Math.max(1, Math.min(lifetimeFrames, Math.round(lifetimeFrames * (EXPLOSION_FADE_SECONDS / EXPLOSION_MAP_SECONDS))));
  const remaining = lifetimeFrames - age;
  if (remaining >= fade) return EXPLOSION_PEAK_ALPHA;
  return EXPLOSION_PEAK_ALPHA * (remaining / fade);
}

/**
 * Colour for a blast, as the bare hex the marker route expects. Graded by size
 * so a satchel charge is not mistaken for a grenade at a glance: the scale runs
 * from a warning amber for small blasts to red for anything artillery-sized.
 */
export function explosionColor(radius: number): string {
  if (!Number.isFinite(radius)) return "ff9d3d";
  if (radius >= 20) return "ff2d2d";
  if (radius >= 10) return "ff5c2d";
  return "ff9d3d";
}
