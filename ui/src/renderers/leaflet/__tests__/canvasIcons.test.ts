import { describe, it, expect, beforeEach } from "vitest";
import { resolveVariant, CanvasIconCache } from "../canvasIcons";

// --------------- resolveVariant ---------------

describe("resolveVariant", () => {
  it("returns 'hit' when isHit is true and alive", () => {
    expect(resolveVariant(1, "WEST", true)).toBe("hit");
  });

  it("returns 'hit' when isHit is true and unconscious", () => {
    expect(resolveVariant(2, "EAST", true)).toBe("hit");
  });

  it("returns 'dead' when alive state is 0 (even if isHit)", () => {
    expect(resolveVariant(0, "WEST", true)).toBe("dead");
    expect(resolveVariant(0, "EAST", false)).toBe("dead");
  });

  it("returns 'unconscious' when alive state is 2 and not hit", () => {
    expect(resolveVariant(2, "GUER", false)).toBe("unconscious");
  });

  it("returns 'dead' for null side with alive state", () => {
    expect(resolveVariant(1, null, false)).toBe("dead");
  });

  it("returns 'blufor' for WEST side when alive", () => {
    expect(resolveVariant(1, "WEST", false)).toBe("blufor");
  });

  it("returns 'opfor' for EAST side when alive", () => {
    expect(resolveVariant(1, "EAST", false)).toBe("opfor");
  });

  it("returns 'ind' for GUER side when alive", () => {
    expect(resolveVariant(1, "GUER", false)).toBe("ind");
  });

  it("returns 'civ' for CIV side when alive", () => {
    expect(resolveVariant(1, "CIV", false)).toBe("civ");
  });

  it("returns 'unknown' for unrecognised side when alive", () => {
    expect(resolveVariant(1, "SOMETHING" as any, false)).toBe("unknown");
  });
});

// --------------- CanvasIconCache.resolveType ---------------

describe("CanvasIconCache.resolveType", () => {
  let cache: CanvasIconCache;

  beforeEach(() => {
    cache = new CanvasIconCache();
  });

  it("returns 'man' for man", () => {
    expect(cache.resolveType("man")).toBe("man");
  });

  it("returns 'car' for car", () => {
    expect(cache.resolveType("car")).toBe("car");
  });

  it("returns 'tank' for tank", () => {
    expect(cache.resolveType("tank")).toBe("tank");
  });

  it("returns 'apc' for apc", () => {
    expect(cache.resolveType("apc")).toBe("apc");
  });

  it("returns 'truck' for truck", () => {
    expect(cache.resolveType("truck")).toBe("truck");
  });

  it("returns 'ship' for ship", () => {
    expect(cache.resolveType("ship")).toBe("ship");
  });

  it("returns 'heli' for heli", () => {
    expect(cache.resolveType("heli")).toBe("heli");
  });

  it("returns 'plane' for plane", () => {
    expect(cache.resolveType("plane")).toBe("plane");
  });

  it("returns 'parachute' for parachute", () => {
    expect(cache.resolveType("parachute")).toBe("parachute");
  });

  it("returns 'staticWeapon' for staticWeapon", () => {
    expect(cache.resolveType("staticWeapon")).toBe("staticWeapon");
  });

  it("returns 'staticMortar' for staticMortar", () => {
    expect(cache.resolveType("staticMortar")).toBe("staticMortar");
  });

  it("returns 'unknown' for unknown", () => {
    expect(cache.resolveType("unknown")).toBe("unknown");
  });

  it("returns 'unknown' for unrecognised type", () => {
    expect(cache.resolveType("submarine")).toBe("unknown");
    expect(cache.resolveType("bicycle")).toBe("unknown");
    expect(cache.resolveType("")).toBe("unknown");
  });
});

// --------------- CanvasIconCache.getSize ---------------

describe("CanvasIconCache.getSize", () => {
  let cache: CanvasIconCache;

  beforeEach(() => {
    cache = new CanvasIconCache();
  });

  it("returns [16, 16] for man", () => {
    expect(cache.getSize("man")).toEqual([16, 16]);
  });

  it("returns [24, 24] for car", () => {
    expect(cache.getSize("car")).toEqual([24, 24]);
  });

  it("returns [28, 28] for tank", () => {
    expect(cache.getSize("tank")).toEqual([28, 28]);
  });

  it("returns [28, 28] for apc", () => {
    expect(cache.getSize("apc")).toEqual([28, 28]);
  });

  it("returns [28, 28] for truck", () => {
    expect(cache.getSize("truck")).toEqual([28, 28]);
  });

  it("returns [28, 28] for ship", () => {
    expect(cache.getSize("ship")).toEqual([28, 28]);
  });

  it("returns [32, 32] for heli", () => {
    expect(cache.getSize("heli")).toEqual([32, 32]);
  });

  it("returns [32, 32] for plane", () => {
    expect(cache.getSize("plane")).toEqual([32, 32]);
  });

  it("returns [20, 20] for parachute", () => {
    expect(cache.getSize("parachute")).toEqual([20, 20]);
  });

  it("returns [20, 20] for staticWeapon", () => {
    expect(cache.getSize("staticWeapon")).toEqual([20, 20]);
  });

  it("returns [20, 20] for staticMortar", () => {
    expect(cache.getSize("staticMortar")).toEqual([20, 20]);
  });

  it("returns [28, 28] for unknown", () => {
    expect(cache.getSize("unknown")).toEqual([28, 28]);
  });

  it("falls back to [28, 28] for unrecognised type", () => {
    expect(cache.getSize("submarine")).toEqual([28, 28]);
    expect(cache.getSize("")).toEqual([28, 28]);
  });
});

// --------------- CanvasIconCache.get ---------------

describe("CanvasIconCache.get", () => {
  let cache: CanvasIconCache;

  beforeEach(() => {
    cache = new CanvasIconCache();
  });

  it("returns null for uncached type/variant", () => {
    expect(cache.get("man", "blufor")).toBeNull();
    expect(cache.get("tank", "opfor")).toBeNull();
    expect(cache.get("unknown", "dead")).toBeNull();
  });

  it("returns image after manual cache insertion via preloadAll", async () => {
    const OriginalImage = globalThis.Image;
    globalThis.Image = class MockImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      private _src = "";
      get src() { return this._src; }
      set src(val: string) {
        this._src = val;
        queueMicrotask(() => this.onload?.());
      }
    } as any;

    try {
      await cache.preloadAll();

      // After preloading, get should return an image object (not null)
      const img = cache.get("man", "blufor");
      expect(img).not.toBeNull();

      const imgTank = cache.get("tank", "opfor");
      expect(imgTank).not.toBeNull();

      const imgDead = cache.get("heli", "dead");
      expect(imgDead).not.toBeNull();
    } finally {
      globalThis.Image = OriginalImage;
    }
  });
});

// --------------- CanvasIconCache.preloadAll ---------------

describe("CanvasIconCache.preloadAll", () => {
  it("loads all type x variant combos", async () => {
    const loadedUrls: string[] = [];
    const OriginalImage = globalThis.Image;
    globalThis.Image = class MockImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      private _src = "";
      get src() { return this._src; }
      set src(val: string) {
        this._src = val;
        loadedUrls.push(val);
        queueMicrotask(() => this.onload?.());
      }
    } as any;

    try {
      const cache = new CanvasIconCache();
      await cache.preloadAll();

      // 12 types x 9 variants = 108 URLs attempted
      const expectedTypes = [
        "man", "ship", "parachute", "heli", "plane", "truck",
        "car", "apc", "tank", "staticMortar", "staticWeapon", "unknown",
      ];
      const expectedVariants = [
        "blufor", "opfor", "ind", "civ", "logic",
        "unknown", "dead", "hit", "unconscious",
      ];
      expect(loadedUrls.length).toBe(expectedTypes.length * expectedVariants.length);

      // Verify a sample of URLs contain expected path fragments
      expect(loadedUrls.some((u) => u.includes("markers/man/blufor.svg"))).toBe(true);
      expect(loadedUrls.some((u) => u.includes("markers/tank/dead.svg"))).toBe(true);
      expect(loadedUrls.some((u) => u.includes("markers/heli/hit.svg"))).toBe(true);
      expect(loadedUrls.some((u) => u.includes("markers/unknown/civ.svg"))).toBe(true);
    } finally {
      globalThis.Image = OriginalImage;
    }
  });

  it("silently skips images that fail to load", async () => {
    const OriginalImage = globalThis.Image;
    let callCount = 0;
    globalThis.Image = class MockImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      private _src = "";
      get src() { return this._src; }
      set src(val: string) {
        this._src = val;
        callCount++;
        const current = callCount;
        // Fail every other image
        queueMicrotask(() => {
          if (current % 2 === 0) {
            this.onerror?.();
          } else {
            this.onload?.();
          }
        });
      }
    } as any;

    try {
      const cache = new CanvasIconCache();
      // Should not throw despite half the images failing
      await expect(cache.preloadAll()).resolves.toBeUndefined();

      // Some icons should be cached, some should be null
      // At least some .get() calls should return non-null
      const allNull = cache.get("man", "blufor") === null
        && cache.get("tank", "opfor") === null
        && cache.get("heli", "dead") === null;
      expect(allNull).toBe(false);
    } finally {
      globalThis.Image = OriginalImage;
    }
  });
});
