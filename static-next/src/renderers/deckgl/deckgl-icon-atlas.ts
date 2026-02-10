import { ICON_PATHS, ICON_SIZES, ICON_STATES } from "../shared/icon-constants";
import { SIDE_CLASS } from "../../config/side-colors";
import type { Side, AliveState } from "../../data/types";

// --------------- Types ---------------

export interface IconMapping {
  x: number;
  y: number;
  width: number;
  height: number;
  anchorY: number;
}

export interface IconAtlas {
  atlasUrl: string;
  mapping: Record<string, IconMapping>;
}

// --------------- Constants ---------------

const CELL_SIZE = 64;
const ENTITY_TYPES = Object.keys(ICON_PATHS);

// --------------- Key generation ---------------

/**
 * Build the icon atlas key for a given entity type, side, and alive state.
 * This key is used both when building the atlas and when looking up icons
 * during rendering.
 */
export function getIconKey(
  iconType: string,
  side: Side | null,
  alive: AliveState,
): string {
  const type = ICON_PATHS[iconType] ? iconType : "unknown";
  let variant: string;
  if (alive === 0) {
    variant = "dead";
  } else if (alive === 2) {
    variant = "unconscious";
  } else if (side) {
    variant = SIDE_CLASS[side] ?? "unknown";
  } else {
    variant = "dead"; // null side (empty vehicle)
  }
  return `${type}:${variant}`;
}

// --------------- Atlas builder ---------------

/**
 * Load a single SVG as an Image, resolve with the Image element.
 * Returns null if loading fails.
 */
function loadSVG(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.crossOrigin = "anonymous";
    img.src = url;
  });
}

/**
 * Build a single-canvas icon atlas containing all entity type × state
 * combinations. Returns the canvas and a mapping from icon keys to
 * atlas coordinates.
 *
 * Atlas layout: columns = entity types, rows = icon states.
 * Each cell is CELL_SIZE × CELL_SIZE pixels.
 */
export async function buildIconAtlas(): Promise<IconAtlas> {
  const cols = ENTITY_TYPES.length;
  const rows = ICON_STATES.length;
  const width = cols * CELL_SIZE;
  const height = rows * CELL_SIZE;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  const mapping: Record<string, IconMapping> = {};

  // Load all SVGs in parallel
  const loadPromises: Array<{
    col: number;
    row: number;
    key: string;
    promise: Promise<HTMLImageElement | null>;
    type: string;
  }> = [];

  for (let col = 0; col < cols; col++) {
    const type = ENTITY_TYPES[col];
    const path = ICON_PATHS[type];
    for (let row = 0; row < rows; row++) {
      const state = ICON_STATES[row];
      const key = `${type}:${state}`;
      const url = `${path}${state}.svg`;
      loadPromises.push({
        col,
        row,
        key,
        promise: loadSVG(url),
        type,
      });
    }
  }

  const results = await Promise.all(
    loadPromises.map(async (entry) => ({
      ...entry,
      img: await entry.promise,
    })),
  );

  for (const { col, row, key, img, type } of results) {
    const x = col * CELL_SIZE;
    const y = row * CELL_SIZE;

    if (img) {
      // Draw SVG centered in cell
      const [srcW, srcH] = ICON_SIZES[type] ?? ICON_SIZES.unknown;
      // Scale up to fill cell while maintaining aspect ratio
      const scale = Math.min(CELL_SIZE / srcW, CELL_SIZE / srcH);
      const dw = srcW * scale;
      const dh = srcH * scale;
      const dx = x + (CELL_SIZE - dw) / 2;
      const dy = y + (CELL_SIZE - dh) / 2;
      ctx.drawImage(img, dx, dy, dw, dh);
    } else {
      // Fallback: draw a colored circle
      ctx.beginPath();
      ctx.arc(x + CELL_SIZE / 2, y + CELL_SIZE / 2, CELL_SIZE / 4, 0, Math.PI * 2);
      ctx.fillStyle = "#888888";
      ctx.fill();
    }

    mapping[key] = {
      x,
      y,
      width: CELL_SIZE,
      height: CELL_SIZE,
      anchorY: CELL_SIZE / 2,
    };
  }

  return { atlasUrl: canvas.toDataURL("image/png"), mapping };
}
