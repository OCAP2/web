import type { Operation } from "../../data/types";
import { STATUS_MAP } from "./constants";

// Curated palette for unknown maps — perceptually distinct, readable on dark backgrounds.
// 37 entries (prime) to reduce modulo collisions.
export const FALLBACK_PALETTE = [
  "#4A9EFF", "#FF6B6B", "#2DD4A0", "#A78BFA", "#FF9F43",
  "#F472B6", "#FBBF24", "#34D399", "#6BB3FF", "#E879F9",
  "#FB923C", "#22D3EE", "#C084FC", "#F87171", "#A3E635",
  "#38BDF8", "#FB7185", "#4ADE80", "#FACC15", "#818CF8",
  "#F59E0B", "#EC4899", "#14B8A6", "#8B5CF6", "#EF4444",
  "#06B6D4", "#D946EF", "#10B981", "#F97316", "#6366F1",
  "#0EA5E9", "#84CC16", "#E11D48", "#A855F7", "#059669",
  "#D97706", "#7C3AED",
];

// Deterministic hex color from string hash (FNV-1a for better distribution)
export function hashColor(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Unsigned
  hash = hash >>> 0;
  const idx = hash % FALLBACK_PALETTE.length;
  return FALLBACK_PALETTE[idx];
}

export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0m 0s";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

// Map our locale codes to BCP 47 tags for Intl APIs
const BCP47: Record<string, string> = { en: "en-GB", de: "de-DE", fr: "fr-FR", ru: "ru-RU", cs: "cs-CZ", it: "it-IT" };

export function formatDate(dateStr: string, locale = "en"): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(BCP47[locale] || locale, { day: "numeric", month: "short", year: "numeric" });
}

export function relativeDate(dateStr: string, locale = "en"): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  const rtf = new Intl.RelativeTimeFormat(BCP47[locale] || locale, { numeric: "auto" });
  if (diffDays === 0) return rtf.format(0, "day");
  if (diffDays < 7) return rtf.format(-diffDays, "day");
  if (diffDays < 30) return rtf.format(-Math.floor(diffDays / 7), "week");
  return rtf.format(-Math.floor(diffDays / 30), "month");
}

export function getMapColor(worldName: string): string {
  return hashColor(worldName);
}

export function getTagColor(tag: string): { bg: string; color: string; border: string } {
  const hex = hashColor(tag);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return {
    bg: `rgba(${r},${g},${b},0.12)`,
    color: hex,
    border: `rgba(${r},${g},${b},0.2)`,
  };
}

export function getStatusInfo(op: Operation): { labelKey: string; color: string; icon: string; key: string } {
  const status = op.conversionStatus || "completed";
  if (status === "streaming") return { ...STATUS_MAP.streaming, key: "streaming" };
  if (status === "pending") return { ...STATUS_MAP.pending, key: "pending" };
  if (status === "converting") return { ...STATUS_MAP.converting, key: "converting" };
  if (status === "failed") return { ...STATUS_MAP.failed, key: "failed" };
  return { ...STATUS_MAP.ready, key: "ready" };
}

export function isOpReady(op: Operation): boolean {
  return getStatusInfo(op).key === "ready";
}

/** Strip .json.gz / .json / .gz extensions from a recording filename. */
export function stripRecordingExtension(filename: string): string {
  return filename.replace(/\.json\.gz$/, "").replace(/\.json$/, "").replace(/\.gz$/, "");
}
