import type { AliveState, Side } from "../../data/types";
import { SIDE_CLASS } from "../../config/sideColors";
import { basePath } from "../../data/basePath";

// --------------- Icon metadata (mirrors leafletIcons.ts) ---------------

const ICON_SIZES: Record<string, [number, number]> = {
  man: [16, 16],
  ship: [28, 28],
  parachute: [20, 20],
  heli: [32, 32],
  plane: [32, 32],
  truck: [28, 28],
  car: [24, 24],
  apc: [28, 28],
  tank: [28, 28],
  staticMortar: [20, 20],
  staticWeapon: [20, 20],
  unknown: [28, 28],
};

const ICON_TYPES = Object.keys(ICON_SIZES);

const ICON_PATHS: Record<string, string> = {
  man: `${basePath}images/markers/man/`,
  ship: `${basePath}images/markers/ship/`,
  parachute: `${basePath}images/markers/parachute/`,
  heli: `${basePath}images/markers/heli/`,
  plane: `${basePath}images/markers/plane/`,
  truck: `${basePath}images/markers/truck/`,
  car: `${basePath}images/markers/car/`,
  apc: `${basePath}images/markers/apc/`,
  tank: `${basePath}images/markers/tank/`,
  staticMortar: `${basePath}images/markers/static-mortar/`,
  staticWeapon: `${basePath}images/markers/static-weapon/`,
  unknown: `${basePath}images/markers/unknown/`,
};

const ICON_VARIANTS = [
  "blufor", "opfor", "ind", "civ", "logic",
  "unknown", "dead", "hit", "unconscious",
] as const;

// --------------- Variant resolution ---------------

/** Map alive state + side to the icon variant filename. */
export function resolveVariant(
  alive: AliveState,
  side: Side | null,
  isHit: boolean,
): string {
  if (isHit && alive !== 0) return "hit";
  if (alive === 0) return "dead";
  if (alive === 2) return "unconscious";
  if (!side) return "dead"; // match leafletIcons: null-side alive entities use dead variant
  return SIDE_CLASS[side] ?? "unknown";
}

// --------------- Icon cache ---------------

function cacheKey(type: string, variant: string): string {
  return `${type}:${variant}`;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load: ${url}`));
    img.src = url;
  });
}

/**
 * Pre-loads SVG entity icons as HTMLImageElement for canvas drawImage().
 * Icons are loaded once and cached for the lifetime of the renderer.
 */
export class CanvasIconCache {
  private cache = new Map<string, HTMLImageElement>();

  /** Fire-and-forget preload of all type × variant combos. */
  async preloadAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const type of ICON_TYPES) {
      const path = ICON_PATHS[type];
      if (!path) continue;
      for (const variant of ICON_VARIANTS) {
        const url = `${path}${variant}.svg`;
        const key = cacheKey(type, variant);
        promises.push(
          loadImage(url).then(
            (img) => { this.cache.set(key, img); },
            () => { /* Some type/variant combos may not exist — skip silently */ },
          ),
        );
      }
    }
    await Promise.all(promises);
  }

  /** Get cached image, or null if not yet loaded. */
  get(type: string, variant: string): HTMLImageElement | null {
    return this.cache.get(cacheKey(type, variant)) ?? null;
  }

  /** Get icon draw size in CSS pixels for a given entity type. */
  getSize(iconType: string): [number, number] {
    return ICON_SIZES[iconType] ?? ICON_SIZES.unknown;
  }

  /** Resolve an iconType to its canonical key (falling back to "unknown"). */
  resolveType(iconType: string): string {
    return ICON_SIZES[iconType] ? iconType : "unknown";
  }
}
