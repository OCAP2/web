import type { Locale } from "../../i18n/i18n";

// All accent colors in one place — CSS vars for inline styles
export const C = {
  primary: "var(--accent-primary)",
  danger:  "var(--accent-danger)",
  success: "var(--accent-success)",
  purple:  "var(--accent-purple)",
  warning: "var(--accent-warning)",
  muted:   "var(--text-muted)",
  dimmer:  "var(--text-dimmer)",
} as const;

// Labels are i18n keys — resolve via t() at render time
export const STATUS_MAP: Record<string, { labelKey: string; color: string; icon: string }> = {
  ready:      { labelKey: "status_ready",      color: C.success, icon: "\u25CF" },
  streaming:  { labelKey: "status_live",       color: C.primary, icon: "\u25C9" },
  converting: { labelKey: "status_converting", color: C.warning, icon: "\u25CC" },
  pending:    { labelKey: "status_pending",    color: C.muted,   icon: "\u25CB" },
  failed:     { labelKey: "status_failed",     color: C.danger,  icon: "\u2715" },
};

export const SIDE_COLORS: Record<string, string> = {
  BLUFOR: "var(--side-blufor)", WEST: "var(--side-blufor)",
  OPFOR:  "var(--side-opfor)",  EAST: "var(--side-opfor)",
  IND:    "var(--side-ind)",    GUER: "var(--side-ind)",
  CIV:    "var(--side-civ)",
};

/** Raw hex side colors for inline style interpolation (hex alpha, rgba). */
export const SIDE_HEX: Record<string, string> = {
  BLUFOR: "#4A9EFF", WEST: "#4A9EFF",
  OPFOR:  "#FF4A4A", EAST: "#FF4A4A",
  IND:    "#2DD4A0", GUER: "#2DD4A0",
  CIV:    "#A78BFA",
};

/** Tag values for the tag selector. Empty string = "None" (no tag). */
export const TAG_OPTIONS = ["TvT", "COOP", "Zeus", "Training", ""] as const;

export const LOCALE_LABELS: Record<Locale, { label: string; flag: string }> = {
  cs: { label: "\u010Ce\u0161tina",  flag: "\uD83C\uDDE8\uD83C\uDDFF" },
  de: { label: "Deutsch",  flag: "\uD83C\uDDE9\uD83C\uDDEA" },
  en: { label: "English",  flag: "\uD83C\uDDEC\uD83C\uDDE7" },
  fr: { label: "Fran\u00E7ais", flag: "\uD83C\uDDEB\uD83C\uDDF7" },
  it: { label: "Italiano", flag: "\uD83C\uDDEE\uD83C\uDDF9" },
  ru: { label: "\u0420\u0443\u0441\u0441\u043A\u0438\u0439",  flag: "\uD83C\uDDF7\uD83C\uDDFA" },
};
