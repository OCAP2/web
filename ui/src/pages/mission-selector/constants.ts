import type { Locale } from "../../ui/i18n/i18n";

// All accent colors in one place — CSS vars for inline styles
export const C = {
  blue:    "var(--ms-accent-blue)",
  red:     "var(--ms-accent-red)",
  green:   "var(--ms-accent-green)",
  purple:  "var(--ms-accent-purple)",
  orange:  "var(--ms-accent-orange)",
  muted:   "var(--ms-text-muted)",
  dimmer:  "var(--ms-text-dimmer)",
} as const;

// Known map colors (raw hex — must NOT be CSS vars so hex opacity suffixes work)
export const MAP_COLORS: Record<string, string> = {
  altis: "#4A9EFF",
  stratis: "#A78BFA",
  tanoa: "#FF9F43",
  livonia: "#FFB84A",
  malden: "#2DD4A0",
  enoch: "#FFB84A",
  vr: "#667788",
};

export const TAG_COLORS: Record<string, { bg: string; color: string; border: string }> = {
  TvT:      { bg: "rgba(255,74,74,0.12)",  color: "#FF6B6B",  border: "rgba(255,74,74,0.2)" },
  COOP:     { bg: "rgba(74,158,255,0.12)", color: "#6BB3FF",  border: "rgba(74,158,255,0.2)" },
  Zeus:     { bg: "rgba(167,139,250,0.12)", color: "#B5A3FA", border: "rgba(167,139,250,0.2)" },
  Training: { bg: "rgba(255,184,74,0.12)",  color: "#FFC66B", border: "rgba(255,184,74,0.2)" },
};

// Labels are i18n keys — resolve via t() at render time
export const STATUS_MAP: Record<string, { labelKey: string; color: string; icon: string }> = {
  ready:      { labelKey: "status_ready",      color: C.green,  icon: "\u25CF" },
  streaming:  { labelKey: "status_streaming",  color: C.blue,   icon: "\u25C9" },
  converting: { labelKey: "status_converting", color: C.orange,  icon: "\u25CC" },
  pending:    { labelKey: "status_pending",    color: C.muted,  icon: "\u25CB" },
  failed:     { labelKey: "status_failed",     color: C.red,    icon: "\u2715" },
};

export const SIDE_COLORS: Record<string, string> = {
  BLUFOR: C.blue,  WEST: C.blue,
  OPFOR:  C.red,   EAST: C.red,
  IND:    C.green, GUER: C.green,
  CIV:    C.purple,
};

export const LOCALE_LABELS: Record<Locale, { label: string; flag: string }> = {
  en: { label: "English",  flag: "\uD83C\uDDEC\uD83C\uDDE7" },
  de: { label: "Deutsch",  flag: "\uD83C\uDDE9\uD83C\uDDEA" },
  ru: { label: "\u0420\u0443\u0441\u0441\u043A\u0438\u0439",  flag: "\uD83C\uDDF7\uD83C\uDDFA" },
  cs: { label: "\u010Ce\u0161tina",  flag: "\uD83C\uDDE8\uD83C\uDDFF" },
  it: { label: "Italiano", flag: "\uD83C\uDDEE\uD83C\uDDF9" },
};
