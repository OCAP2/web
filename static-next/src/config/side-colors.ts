import type { Side } from "../data/types";

/** Bright colors for UI text (event log, unit list). Keep in sync with --side-* in variables.css */
export const SIDE_COLORS_BRIGHT: Record<Side, string> = {
  WEST: "#00a8ff",
  EAST: "#ff0000",
  GUER: "#00cc00",
  CIV: "#c900ff",
};

/** Dark colors for entity markers. Keep in sync with --side-*-dark in variables.css */
export const SIDE_COLORS_DARK: Record<Side, string> = {
  WEST: "#004d99",
  EAST: "#800000",
  GUER: "#007f00",
  CIV: "#650080",
};

/** CSS class name for each side. */
export const SIDE_CLASS: Record<Side, string> = {
  WEST: "blufor",
  EAST: "opfor",
  GUER: "ind",
  CIV: "civ",
};
