import type { Operation } from "../../data/types";
import { MAP_COLORS, STATUS_MAP } from "./constants";

// Deterministic hex color from string hash — saturated pastels for dark backgrounds
function hashColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  // Pick from a curated palette so every unknown map gets a vibrant, readable color
  const palette = [
    "#4A9EFF", "#2DD4A0", "#FF9F43", "#A78BFA", "#FF6B6B",
    "#FFB84A", "#6BB3FF", "#F472B6", "#34D399", "#FBBF24",
  ];
  return palette[((hash % palette.length) + palette.length) % palette.length];
}

export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "0m 0s";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

export function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function relativeDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const now = Date.now();
  const diff = Math.floor((now - d.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return `${diff} days ago`;
  if (diff < 30) return `${Math.floor(diff / 7)}w ago`;
  return `${Math.floor(diff / 30)}mo ago`;
}

export function getMapColor(worldName: string): string {
  return MAP_COLORS[worldName.toLowerCase()] || hashColor(worldName);
}

export function getStatusInfo(op: Operation): { label: string; color: string; icon: string; key: string } {
  const format = op.storageFormat || "json";
  const conversionStatus = op.conversionStatus || "completed";
  if (conversionStatus === "pending") return { ...STATUS_MAP.pending, key: "pending" };
  if (conversionStatus === "converting") return { ...STATUS_MAP.converting, key: "converting" };
  if (conversionStatus === "failed") return { ...STATUS_MAP.failed, key: "failed" };
  if (format === "protobuf") return { ...STATUS_MAP.streaming, key: "streaming" };
  return { ...STATUS_MAP.ready, key: "ready" };
}

export function isOpReady(op: Operation): boolean {
  const s = getStatusInfo(op);
  return s.key === "ready" || s.key === "streaming";
}
