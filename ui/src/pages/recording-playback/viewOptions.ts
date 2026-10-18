import { createSignal } from "solid-js";

/**
 * Map overlays that are computed in the UI rather than drawn from the
 * recording's own markers. They live here, next to the other panel signals,
 * because both the settings menu that toggles them and the render bridge that
 * draws them need to read the same value.
 */

/**
 * Whose movement trail to draw.
 *
 * "off" is the default, so nobody pays for trails they did not ask for.
 * "followed" is the cheap one: a single trail for the unit the camera is
 * already following. "players" draws every player on foot and is meant for
 * looking at a manoeuvre after the fact.
 */
export type TrailMode = "off" | "followed" | "players";

export const [trailMode, setTrailMode] = createSignal<TrailMode>("off");

/** Seconds of movement history a trail covers. */
export const TRAIL_SECONDS = 120;

/** Positions sampled per trail; more is smoother and costs more to draw. */
export const TRAIL_SAMPLES = 40;

/** Death markers aggregated into a density overlay. */
export const [deathHeatmapVisible, setDeathHeatmapVisible] = createSignal(false);

/**
 * Grid cell for the death heatmap, in metres. Deaths inside one cell collapse
 * into a single blob whose size and opacity carry the count, which is what keeps
 * a 500-death mission from drawing 500 overlapping circles.
 */
export const DEATH_HEATMAP_CELL_M = 60;
