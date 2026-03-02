// Deterministic hue from a string (FNV-1a hash → [0..360])
export function mapHue(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h % 360;
}

export function formatWorldSize(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)} km`;
  return `${meters} m`;
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

export function totalDiskMB(files?: Record<string, number>): number {
  if (!files) return 0;
  return Object.values(files).reduce((a, b) => a + b, 0);
}

export function statusLabelKey(status: string): string {
  if (status === "complete") return "mm_status_complete";
  if (status === "incomplete") return "mm_status_partial";
  return "mm_status_none";
}

export function elapsed(start: string, end?: string): string {
  if (!start) return "";
  const from = new Date(start).getTime();
  const to = end ? new Date(end).getTime() : Date.now();
  const ms = to - from;
  if (ms < 0) return "";
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  if (mins < 60) return `${mins}m ${rem}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}
