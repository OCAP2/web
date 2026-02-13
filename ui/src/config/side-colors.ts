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

/** Redesign UI colors for side indicators. */
export const SIDE_COLORS_UI: Record<Side, string> = {
  WEST: "var(--accent-blue)",
  EAST: "var(--accent-red)",
  GUER: "var(--accent-green)",
  CIV: "var(--accent-purple)",
};

/** Translucent background variants for redesign UI. */
export const SIDE_BG_COLORS: Record<Side, string> = {
  WEST: "rgba(74,158,255,0.12)",
  EAST: "rgba(255,74,74,0.12)",
  GUER: "rgba(45,212,160,0.12)",
  CIV: "rgba(167,139,250,0.12)",
};

/** CSS class name for each side. */
export const SIDE_CLASS: Record<Side, string> = {
  WEST: "blufor",
  EAST: "opfor",
  GUER: "ind",
  CIV: "civ",
};
