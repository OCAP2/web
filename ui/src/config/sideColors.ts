import type { Side } from "../data/types";

/** Every side, in the order the UI lists them. */
export const SIDES: Side[] = ["WEST", "EAST", "GUER", "CIV", "VIRTUAL"];

/** Faction names as a briefing writes them, not the engine's side ids. */
export const SIDE_LABELS: Record<Side, string> = {
  WEST: "BLUFOR",
  EAST: "OPFOR",
  GUER: "IND",
  CIV: "CIV",
  VIRTUAL: "VIRTUAL",
};

/** Bright colors for UI text (event log, unit list). Keep in sync with --side-* in variables.css */
export const SIDE_COLORS_BRIGHT: Record<Side, string> = {
  WEST: "#00a8ff",
  EAST: "#ff0000",
  GUER: "#00cc00",
  CIV: "#c900ff",
  VIRTUAL: "#c9a227",
};

/** Dark colors for entity markers. Keep in sync with --side-*-dark in variables.css */
export const SIDE_COLORS_DARK: Record<Side, string> = {
  WEST: "#004d99",
  EAST: "#800000",
  GUER: "#007f00",
  CIV: "#650080",
  VIRTUAL: "#8a7018",
};

/** Redesign UI colors for side indicators. */
export const SIDE_COLORS_UI: Record<Side, string> = {
  WEST: "var(--side-blufor)",
  EAST: "var(--side-opfor)",
  GUER: "var(--side-ind)",
  CIV: "var(--side-civ)",
  VIRTUAL: "var(--side-virtual)",
};

/** Translucent background variants for redesign UI. */
export const SIDE_BG_COLORS: Record<Side, string> = {
  WEST: "color-mix(in srgb, var(--side-blufor) 12%, transparent)",
  EAST: "color-mix(in srgb, var(--side-opfor) 12%, transparent)",
  GUER: "color-mix(in srgb, var(--side-ind) 12%, transparent)",
  CIV: "color-mix(in srgb, var(--side-civ) 12%, transparent)",
  VIRTUAL: "color-mix(in srgb, var(--side-virtual) 12%, transparent)",
};

/** CSS class name for each side. */
export const SIDE_CLASS: Record<Side, string> = {
  WEST: "blufor",
  EAST: "opfor",
  GUER: "ind",
  CIV: "civ",
  VIRTUAL: "virtual",
};
