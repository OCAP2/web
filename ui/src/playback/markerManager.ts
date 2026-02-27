import type { ArmaCoord } from "../utils/coordinates";
import { FRAME_FOREVER, type MarkerDef } from "../data/types";
import type { MapRenderer } from "../renderers/renderer.interface";
import type {
  BriefingMarkerHandle,
  BriefingMarkerDef,
  BriefingMarkerState,
} from "../renderers/renderer.types";

// ─── Position parsing ───

interface ParsedMarkerPosition {
  frameNum: number;
  position: ArmaCoord;
  direction: number;
  alpha: number;
  linePoints?: ArmaCoord[];
}

/**
 * Parse a marker position entry, handling both JSON and protobuf formats.
 *
 * JSON format:   [frameNum, [x, y, z?], dir, alpha]
 *   For polylines: [frameNum, [[x1,y1], [x2,y2], ...], dir, alpha]
 *
 * Protobuf/FB format: [frameNum, posX, posY, posZ, direction, alpha, ...lineCoords]
 */
export function parseMarkerPosition(
  entry: [number, ...any],
): ParsedMarkerPosition {
  const frameNum = entry[0];

  if (Array.isArray(entry[1])) {
    // JSON format: [frameNum, pos, dir, alpha]
    let pos = entry[1];
    // Handle nested array like [[x, y, z]]
    if (pos.length === 1 && Array.isArray(pos[0])) {
      pos = pos[0];
    }

    const direction = entry[2] ?? 0;
    const alpha = entry[3] ?? 1;

    // Check if pos contains polyline coordinates (array of arrays)
    if (Array.isArray(pos[0])) {
      const linePoints = pos.map(
        (p: number[]) => [p[0], p[1]] as ArmaCoord,
      );
      return {
        frameNum,
        position: linePoints[0] ?? [0, 0],
        direction,
        alpha,
        linePoints,
      };
    }

    return {
      frameNum,
      position: [pos[0], pos[1]] as ArmaCoord,
      direction,
      alpha,
    };
  }

  // Protobuf/FB format: [frameNum, posX, posY, posZ, direction, alpha, ...lineCoords]
  const posX = entry[1] ?? 0;
  const posY = entry[2] ?? 0;
  const direction = entry[4] ?? 0;
  const alpha = entry[5] ?? 1;

  // Check for line coordinates (pairs after alpha)
  if (entry.length > 6) {
    const linePoints: ArmaCoord[] = [];
    for (let i = 6; i < entry.length - 1; i += 2) {
      linePoints.push([entry[i], entry[i + 1]] as ArmaCoord);
    }
    if (linePoints.length > 0) {
      return { frameNum, position: [posX, posY], direction, alpha, linePoints };
    }
  }

  return {
    frameNum,
    position: [posX, posY],
    direction,
    alpha,
  };
}

// ─── Binary search ───

function isInfiniteEnd(endFrame: number): boolean {
  return endFrame === FRAME_FOREVER;
}

/**
 * Binary search for the active position index at a given frame.
 * Returns the index into positions[], or -1 if the marker is not active.
 *
 * Matches the old frontend's _markerOnFrame algorithm.
 */
export function findPositionIndex(
  positions: Array<[number, ...any]>,
  frame: number,
  startFrame: number,
  endFrame: number,
): number {
  if (positions.length === 0) return -1;

  // Check frame range
  if (frame < startFrame) return -1;

  // endFrame === -1 (or uint32 max) means show forever
  if (isInfiniteEnd(endFrame) && frame >= startFrame) {
    // Fall through to binary search — use last position if frame is past all entries
  } else if (frame > endFrame) {
    return -1;
  }

  // Binary search — find last position with frameNum <= frame
  let lo = 0;
  let hi = positions.length - 1;
  let lastLength: number;

  do {
    lastLength = hi - lo + 1;
    const mid = Math.floor((hi - lo) / 2) + lo;
    if (positions[mid][0] > frame) {
      hi = mid - 1;
    } else {
      lo = mid;
    }
  } while (lastLength !== hi - lo + 1);

  // The range [lo, hi] has converged. Return hi only if it's <= frame,
  // otherwise return lo (the last keyframe at or before the target frame).
  if (hi >= 0 && positions[hi][0] <= frame) {
    return hi;
  }
  return lo;
}

// ─── Marker state tracking ───

const SYSTEM_MARKER_TYPES = ["ObjectMarker", "moduleCoverMap", "safeStart"];

const PROJECTILE_TYPES = ["Minefield", "mil_triangle"];

/**
 * Determine which layer group an ICON marker belongs to,
 * matching the old frontend's _createMarker layer assignment.
 */
function classifyMarkerLayer(
  def: MarkerDef,
): "briefingMarkers" | "systemMarkers" | "projectileMarkers" {
  if (def.shape !== "ICON") return "briefingMarkers";

  // Known system marker types (game-engine markers, not player-placed)
  if (def.player === -1 && SYSTEM_MARKER_TYPES.includes(def.type))
    return "systemMarkers";

  // Projectiles on GLOBAL side
  if (
    (def.type.includes("magIcons") || PROJECTILE_TYPES.includes(def.type)) &&
    def.side === "GLOBAL"
  ) {
    return "projectileMarkers";
  }

  return "briefingMarkers";
}

/**
 * Build popup text for an ICON marker, matching the old frontend's
 * _createMarker popup text logic.
 */
function buildMarkerPopupText(
  def: MarkerDef,
  getEntityName: (id: number) => string | null,
): string {
  if (def.shape !== "ICON") return "";
  const text = def.text ?? "";

  // No player — system marker
  if (def.player === -1) return text;

  const playerName = getEntityName(def.player) ?? "";

  // Objectives (Terminal, Sector)
  if (text.includes("Terminal") || text.includes("Sector")) return text;

  if (def.side === "GLOBAL") {
    // System marker types on GLOBAL — no popup
    if (SYSTEM_MARKER_TYPES.includes(def.type)) return "";

    // Projectiles (magIcons, Minefield, mil_triangle) on GLOBAL
    if (def.type.includes("magIcons") || PROJECTILE_TYPES.includes(def.type)) {
      return [playerName, text].filter(Boolean).join(" ");
    }

    // Other GLOBAL markers
    return text;
  }

  // Normal player marks (non-GLOBAL side)
  return [def.side, playerName, text].filter(Boolean).join(" ");
}

interface TrackedMarker {
  def: MarkerDef;
  popupText: string;
  layer: "briefingMarkers" | "systemMarkers" | "projectileMarkers";
  handle: BriefingMarkerHandle | null;
  /** Last applied position index — skip update when unchanged. */
  lastPosIndex: number;
}

/**
 * Manages briefing marker lifecycle: creates, updates, and removes
 * markers on the renderer based on the current playback frame.
 */
export class MarkerManager {
  private markers: TrackedMarker[] = [];
  private renderer: MapRenderer;
  private sideFilter: string | null = null;
  private blacklistedPlayers: Set<number> = new Set();

  constructor(renderer: MapRenderer) {
    this.renderer = renderer;
  }

  /**
   * Set which side's markers are visible.
   * Markers matching `side` or "GLOBAL" are shown; others are hidden.
   * Pass `null` to show all markers.
   */
  setSideFilter(side: string | null): void {
    if (this.sideFilter === side) return;
    this.sideFilter = side;

    // Remove markers that no longer match the filter
    for (const tracked of this.markers) {
      if (tracked.handle && !this.matchesSideFilter(tracked.def.side)) {
        this.renderer.removeBriefingMarker(tracked.handle);
        tracked.handle = null;
        tracked.lastPosIndex = -1;
      }
    }
  }

  private matchesSideFilter(markerSide: string): boolean {
    if (this.sideFilter === null) return true;
    return markerSide === this.sideFilter || markerSide === "GLOBAL";
  }

  /**
   * Set which players' markers are blacklisted.
   * Immediately removes any currently-displayed markers for blacklisted players.
   */
  setBlacklist(playerIds: Set<number>): void {
    this.blacklistedPlayers = playerIds;

    for (const tracked of this.markers) {
      if (tracked.handle && this.isBlacklisted(tracked.def.player)) {
        this.renderer.removeBriefingMarker(tracked.handle);
        tracked.handle = null;
        tracked.lastPosIndex = -1;
      }
    }
  }

  private isBlacklisted(player: number): boolean {
    if (player === -1) return false; // system markers
    return this.blacklistedPlayers.has(player);
  }

  /**
   * Count markers per player entity ID (excludes system markers with player === -1).
   */
  getMarkerCountsByPlayer(): Map<number, number> {
    const counts = new Map<number, number>();
    for (const tracked of this.markers) {
      if (tracked.def.player === -1) continue;
      counts.set(tracked.def.player, (counts.get(tracked.def.player) ?? 0) + 1);
    }
    return counts;
  }

  /**
   * Load marker definitions from the manifest.
   * Filters out marker types that should not be rendered
   * (matching the old frontend's creation-time filtering).
   */
  loadMarkers(
    defs: MarkerDef[],
    getEntityName?: (id: number) => string | null,
  ): void {
    this.clear();
    const lookup = getEntityName ?? (() => null);

    let skipped = 0;
    for (const def of defs) {
      // Skip marker types that the old frontend never creates
      if (def.type.includes("Empty") || def.type.includes("zoneTrigger")) {
        skipped++;
        continue;
      }

      const popupText = buildMarkerPopupText(def, lookup);
      const layer = classifyMarkerLayer(def);
      this.markers.push({ def, popupText, layer, handle: null, lastPosIndex: -1 });
    }

    console.log(
      `[MarkerManager] Loaded ${this.markers.length} markers (${skipped} skipped)`,
    );
  }

  /**
   * Update all markers for the given frame.
   */
  updateFrame(frame: number): void {
    for (const tracked of this.markers) {
      const posIndex = findPositionIndex(
        tracked.def.positions,
        frame,
        tracked.def.startFrame,
        tracked.def.endFrame,
      );

      if (posIndex >= 0) {
        // Skip blacklisted player markers
        if (this.isBlacklisted(tracked.def.player)) {
          if (tracked.handle) {
            this.renderer.removeBriefingMarker(tracked.handle);
            tracked.handle = null;
            tracked.lastPosIndex = -1;
          }
          continue;
        }

        // Skip markers that don't match the active side filter
        if (!this.matchesSideFilter(tracked.def.side)) {
          if (tracked.handle) {
            this.renderer.removeBriefingMarker(tracked.handle);
            tracked.handle = null;
            tracked.lastPosIndex = -1;
          }
          continue;
        }

        // Skip update if the marker is already showing this keyframe
        if (tracked.handle && posIndex === tracked.lastPosIndex) {
          continue;
        }

        const parsed = parseMarkerPosition(tracked.def.positions[posIndex]);

        if (!tracked.handle) {
          // Create the marker
          const briefingDef: BriefingMarkerDef = {
            shape: tracked.def.shape,
            type: tracked.def.type,
            color: tracked.def.color,
            text: tracked.popupText || undefined,
            side: tracked.def.side,
            size: tracked.def.size,
            brush: tracked.def.brush,
            layer: tracked.layer,
          };
          tracked.handle = this.renderer.createBriefingMarker(briefingDef);
        }

        // Update position
        const state: BriefingMarkerState = {
          position: parsed.position,
          direction: parsed.direction,
          alpha: parsed.alpha,
          points: parsed.linePoints,
        };
        this.renderer.updateBriefingMarker(tracked.handle, state);
        tracked.lastPosIndex = posIndex;
      } else {
        // Marker should not be visible at this frame
        if (tracked.handle) {
          this.renderer.removeBriefingMarker(tracked.handle);
          tracked.handle = null;
          tracked.lastPosIndex = -1;
        }
      }
    }
  }

  /**
   * Remove all markers and reset state.
   */
  clear(): void {
    for (const tracked of this.markers) {
      if (tracked.handle) {
        this.renderer.removeBriefingMarker(tracked.handle);
      }
    }
    this.markers = [];
  }
}
