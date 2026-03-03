import type { CrewInfo } from "../renderer.types";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Format entity name + optional crew info as HTML for Leaflet popups. */
export function formatPopupContent(name: string, crew?: CrewInfo): string {
  if (!crew) return escapeHtml(name);
  if (crew.count === 0) {
    return `${escapeHtml(name)} <i>(0)</i>`;
  }
  if (crew.names.length === 0) {
    return `${escapeHtml(name)} <i>(${crew.count})</i>`;
  }
  const crewHtml = crew.names.map(escapeHtml).join("<br>");
  return `<u>${escapeHtml(name)}</u> <i>(${crew.count})</i><br>${crewHtml}`;
}
