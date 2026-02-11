import type { Operation } from "../../data/types";
import { MAP_COLORS, STATUS_MAP, C } from "./constants";

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
  return MAP_COLORS[worldName.toLowerCase()] || C.muted;
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
