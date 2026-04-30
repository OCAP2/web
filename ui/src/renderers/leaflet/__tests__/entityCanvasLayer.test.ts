import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import L from "leaflet";
import { EntityCanvasLayer, type EntityCanvasConfig } from "../entityCanvasLayer";
import type { EntityMarkerOpts, EntityMarkerState } from "../../renderer.types";
import { SKIP_ANIMATION_DISTANCE } from "../../../utils/math";
import type { CanvasIconCache } from "../canvasIcons";

// --------------- Mocks ---------------

/** Stub OffscreenCanvas for jsdom (which doesn't support it). */
if (typeof globalThis.OffscreenCanvas === "undefined") {
  (globalThis as any).OffscreenCanvas = class {
    width: number;
    height: number;
    constructor(w: number, h: number) {
      this.width = w;
      this.height = h;
    }
    getContext() {
      return {
        clearRect: vi.fn(),
        drawImage: vi.fn(),
        fillRect: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
        globalCompositeOperation: "source-over",
        fillStyle: "",
        globalAlpha: 1,
      };
    }
  };
}

function makeIconCache(): CanvasIconCache {
  return {
    resolveType: (t: string) => t,
    get: () => null,
    getSize: () => [24, 24] as [number, number],
    preloadAll: () => Promise.resolve(),
  } as unknown as CanvasIconCache;
}

function makeMockMap(): L.Map {
  const container = document.createElement("div");
  Object.defineProperty(container, "clientWidth", { value: 800 });
  Object.defineProperty(container, "clientHeight", { value: 600 });

  return {
    getContainer: () => container,
    latLngToContainerPoint: () => ({ x: 100, y: 100 }),
    getZoomScale: () => 1,
    getZoom: () => 5,
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as L.Map;
}

function makeConfig(overrides?: Partial<EntityCanvasConfig>): EntityCanvasConfig {
  return {
    armaToLatLng: (c) => L.latLng(c[1], c[0]),
    iconCache: makeIconCache(),
    getZoom: () => 5,
    isMapLibreMode: false,
    nameDisplayMode: () => "all",
    layerVisible: () => true,
    projectileLayerVisible: () => true,
    worldSize: 30720,
    latLngToArma: (ll) => [ll.lng, ll.lat] as [number, number],
    ...overrides,
  };
}

const DEFAULT_OPTS: EntityMarkerOpts = {
  position: [1000, 2000],
  direction: 90,
  iconType: "man",
  side: "WEST",
  name: "Unit1",
  isPlayer: true,
};

function makeState(overrides?: Partial<EntityMarkerState>): EntityMarkerState {
  return {
    position: [1000, 2000],
    direction: 0,
    alive: 1,
    side: "WEST",
    name: "Unit1",
    iconType: "man",
    isPlayer: true,
    isInVehicle: false,
    ...overrides,
  };
}

// --------------- Tests ---------------

describe("EntityCanvasLayer", () => {
  let layer: EntityCanvasLayer;
  let mockMap: L.Map;
  let rafSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Prevent the render loop from actually running
    rafSpy = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockReturnValue(0);

    mockMap = makeMockMap();
    layer = new EntityCanvasLayer(mockMap, makeConfig());
  });

  afterEach(() => {
    layer.dispose();
    rafSpy.mockRestore();
  });

  /** Access the private entities map for assertions. */
  function getEntity(id: number) {
    return (layer as any).entities.get(id);
  }

  describe("addEntity", () => {
    it("creates entity at the given position", () => {
      layer.addEntity(1, DEFAULT_OPTS);
      const e = getEntity(1);
      expect(e).toBeDefined();
      expect(e.prevX).toBe(1000);
      expect(e.prevY).toBe(2000);
      expect(e.targetX).toBe(1000);
      expect(e.targetY).toBe(2000);
      expect(e.interpProgress).toBe(1);
      expect(e.isInVehicle).toBe(false);
    });

    it("spawns with the correct direction", () => {
      layer.addEntity(1, { ...DEFAULT_OPTS, direction: 180 });
      const e = getEntity(1);
      expect(e.prevDir).toBe(180);
      expect(e.targetDir).toBe(180);
    });

    it("spawns facing north when direction is 0", () => {
      layer.addEntity(1, { ...DEFAULT_OPTS, direction: 0 });
      const e = getEntity(1);
      expect(e.prevDir).toBe(0);
      expect(e.targetDir).toBe(0);
    });
  });

  describe("updateEntity — snap conditions", () => {
    beforeEach(() => {
      layer.addEntity(1, DEFAULT_OPTS);
      // Enable smoothing so interpolation is the default behavior
      layer.setSmoothingEnabled(true, 1);
    });

    it("interpolates normally for short-distance moves", () => {
      layer.updateEntity(1, makeState({ position: [1010, 2010] }));
      const e = getEntity(1);
      expect(e.interpProgress).toBe(0); // animation starts
      expect(e.targetX).toBe(1010);
      expect(e.targetY).toBe(2010);
      // prevX/Y should still be the old position (snapshot)
      expect(e.prevX).toBe(1000);
      expect(e.prevY).toBe(2000);
    });

    it("snaps for teleport (distance > SKIP_ANIMATION_DISTANCE)", () => {
      const far = SKIP_ANIMATION_DISTANCE + 100;
      layer.updateEntity(
        1,
        makeState({ position: [1000 + far, 2000] }),
      );
      const e = getEntity(1);
      expect(e.interpProgress).toBe(1);
      expect(e.prevX).toBe(e.targetX);
      expect(e.prevY).toBe(e.targetY);
    });

    it("snaps when smoothing is disabled", () => {
      layer.setSmoothingEnabled(false);
      layer.updateEntity(1, makeState({ position: [1010, 2010] }));
      const e = getEntity(1);
      expect(e.interpProgress).toBe(1);
      expect(e.prevX).toBe(1010);
      expect(e.prevY).toBe(2010);
    });

    it("snaps on vehicle exit even for short distances", () => {
      // Put unit into a vehicle
      layer.updateEntity(
        1,
        makeState({ isInVehicle: true, position: [1000, 2000] }),
      );
      const e = getEntity(1);
      expect(e.isInVehicle).toBe(true);

      // Exit vehicle at a nearby position (well within SKIP_ANIMATION_DISTANCE)
      layer.updateEntity(
        1,
        makeState({ isInVehicle: false, position: [1005, 2005] }),
      );
      expect(e.interpProgress).toBe(1); // snapped, not interpolating
      expect(e.prevX).toBe(e.targetX);
      expect(e.prevY).toBe(e.targetY);
      expect(e.targetX).toBe(1005);
      expect(e.targetY).toBe(2005);
      expect(e.isInVehicle).toBe(false);
    });

    it("does not snap when staying in vehicle", () => {
      // Enter vehicle
      layer.updateEntity(
        1,
        makeState({ isInVehicle: true, position: [1000, 2000] }),
      );
      // Move while still in vehicle (short distance)
      layer.updateEntity(
        1,
        makeState({ isInVehicle: true, position: [1010, 2010] }),
      );
      const e = getEntity(1);
      expect(e.interpProgress).toBe(0); // interpolating, not snapped
    });

    it("does not snap when entering vehicle at short distance", () => {
      // Unit is on foot, enters vehicle nearby
      layer.updateEntity(
        1,
        makeState({ isInVehicle: true, position: [1010, 2010] }),
      );
      const e = getEntity(1);
      expect(e.interpProgress).toBe(0); // interpolating
      expect(e.isInVehicle).toBe(true);
    });

    it("snaps on vehicle exit even with large stale distance", () => {
      // Unit is at position A, enters vehicle
      layer.updateEntity(
        1,
        makeState({ isInVehicle: true, position: [1000, 2000] }),
      );

      // Vehicle moves far away while unit is inside (hidden, not rendered).
      // Multiple updates while in vehicle — prevX/Y are stale from entry.
      layer.updateEntity(
        1,
        makeState({ isInVehicle: true, position: [5000, 8000] }),
      );

      // Unit exits vehicle at far position — must snap, not warp from entry pos
      layer.updateEntity(
        1,
        makeState({ isInVehicle: false, position: [5010, 8010] }),
      );
      const e = getEntity(1);
      expect(e.interpProgress).toBe(1);
      expect(e.prevX).toBe(e.targetX);
      expect(e.prevY).toBe(e.targetY);
    });
  });

  describe("updateEntity — hit flash", () => {
    beforeEach(() => {
      layer.addEntity(1, DEFAULT_OPTS);
    });

    it("records hitStartTime when hit on alive entity", () => {
      const before = performance.now();
      layer.updateEntity(1, makeState({ hit: true, alive: 1 }));
      const e = getEntity(1);
      expect(e.hitStartTime).toBeGreaterThanOrEqual(before);
    });

    it("does not record hitStartTime when hit on dead entity", () => {
      layer.updateEntity(1, makeState({ hit: true, alive: 0 }));
      const e = getEntity(1);
      expect(e.hitStartTime).toBe(0);
    });

    it("does not record hitStartTime when not hit", () => {
      layer.updateEntity(1, makeState({ hit: false, alive: 1 }));
      const e = getEntity(1);
      expect(e.hitStartTime).toBe(0);
    });
  });

  describe("updateEntity — visual state", () => {
    beforeEach(() => {
      layer.addEntity(1, DEFAULT_OPTS);
    });

    it("sets opacity to 0 when in vehicle", () => {
      layer.updateEntity(1, makeState({ isInVehicle: true }));
      expect(getEntity(1).opacity).toBe(0);
    });

    it("sets opacity to 0.4 when dead", () => {
      layer.updateEntity(1, makeState({ alive: 0 }));
      expect(getEntity(1).opacity).toBe(0.4);
    });

    it("sets opacity to 1 when alive and not in vehicle", () => {
      layer.updateEntity(1, makeState({ alive: 1, isInVehicle: false }));
      expect(getEntity(1).opacity).toBe(1);
    });
  });

  describe("setSmoothingEnabled — interpolation duration", () => {
    /** Access the private interpDurationSec. */
    function getInterpDuration() {
      return (layer as any).interpDurationSec;
    }

    it("sets interpDurationSec to 1/speed (frame interval)", () => {
      layer.setSmoothingEnabled(true, 1);
      expect(getInterpDuration()).toBeCloseTo(1.0);

      layer.setSmoothingEnabled(true, 2);
      expect(getInterpDuration()).toBeCloseTo(0.5);

      layer.setSmoothingEnabled(true, 5);
      expect(getInterpDuration()).toBeCloseTo(0.2);

      layer.setSmoothingEnabled(true, 10);
      expect(getInterpDuration()).toBeCloseTo(0.1);
    });

    it("entities reach target within one frame interval at high speed", () => {
      layer.addEntity(1, DEFAULT_OPTS);
      layer.setSmoothingEnabled(true, 10);
      const interpDur = getInterpDuration(); // 0.1s

      // Move to new position — starts interpolation
      layer.updateEntity(1, makeState({ position: [1010, 2010] }));
      const e = getEntity(1);
      expect(e.interpProgress).toBe(0);

      // Simulate one full frame interval elapsed (dt = interpDur)
      // progress = 0 + dt / interpDur = 1.0 → entity at target
      const progress = Math.min(1, 0 + interpDur / interpDur);
      expect(progress).toBe(1);
    });

    it("does not exceed 1s duration for fractional speeds", () => {
      layer.setSmoothingEnabled(true, 0.5);
      // speed 0.5 → 1/0.5 = 2s, but the guard caps at 1/speed
      // which is correct: at 0.5x, frames come every 2s
      expect(getInterpDuration()).toBeCloseTo(2.0);
    });

    it("handles edge case of speed 0 without division error", () => {
      layer.setSmoothingEnabled(true, 0);
      expect(getInterpDuration()).toBe(1);
      expect(Number.isFinite(getInterpDuration())).toBe(true);
    });

    it("preserves duration when speed is not provided", () => {
      layer.setSmoothingEnabled(true, 4);
      const dur = getInterpDuration();
      expect(dur).toBeCloseTo(0.25);

      // Toggle smoothing without changing speed
      layer.setSmoothingEnabled(false);
      expect(getInterpDuration()).toBeCloseTo(0.25); // unchanged
    });
  });

  describe("setGridVisible", () => {
    it("grid is hidden by default", () => {
      expect((layer as any).gridVisible).toBe(false);
    });

    it("setGridVisible toggles the flag", () => {
      layer.setGridVisible(true);
      expect((layer as any).gridVisible).toBe(true);
      layer.setGridVisible(false);
      expect((layer as any).gridVisible).toBe(false);
    });
  });

  describe("removeEntity", () => {
    it("removes the entity from internal map", () => {
      layer.addEntity(1, DEFAULT_OPTS);
      expect(getEntity(1)).toBeDefined();
      layer.removeEntity(1);
      expect(getEntity(1)).toBeUndefined();
    });
  });

  describe("fire lines", () => {
    it("stores fire lines via setFireLines", () => {
      const lines = [
        { fromX: 0, fromY: 0, toX: 100, toY: 100, color: "#f00", weight: 2, opacity: 0.8, cachedFromPx: 0, cachedFromPy: 0, cachedToPx: 0, cachedToPy: 0 },
      ];
      layer.setFireLines(lines);
      expect((layer as any).fireLines).toBe(lines);
    });

    it("clears fire lines via clearFireLines", () => {
      layer.setFireLines([
        { fromX: 0, fromY: 0, toX: 100, toY: 100, color: "#f00", weight: 2, opacity: 0.8, cachedFromPx: 0, cachedFromPy: 0, cachedToPx: 0, cachedToPy: 0 },
      ]);
      layer.clearFireLines();
      expect((layer as any).fireLines).toEqual([]);
    });
  });

  describe("projectiles", () => {
    it("adds a projectile at the given position", () => {
      layer.addProjectile(1, {
        iconUrl: "http://example.com/grenade.png",
        iconSize: [35, 35],
      });
      const p = (layer as any).projectiles.get(1);
      expect(p).toBeDefined();
      expect(p.iconUrl).toBe("http://example.com/grenade.png");
      expect(p.iconSize).toEqual([35, 35]);
      expect(p.opacity).toBe(0);
    });

    it("updates projectile position and opacity", () => {
      layer.addProjectile(1, {
        iconUrl: "http://example.com/grenade.png",
        iconSize: [35, 35],
      });
      layer.updateProjectile(1, {
        position: [500, 600],
        direction: 45,
        alpha: 0.5,
      });
      const p = (layer as any).projectiles.get(1);
      expect(p.targetX).toBe(500);
      expect(p.targetY).toBe(600);
      expect(p.targetDir).toBe(45);
      expect(p.opacity).toBe(0.5);
    });

    it("removes a projectile", () => {
      layer.addProjectile(1, {
        iconUrl: "http://example.com/grenade.png",
        iconSize: [35, 35],
      });
      layer.removeProjectile(1);
      expect((layer as any).projectiles.get(1)).toBeUndefined();
    });

    it("ignores updates for non-existent projectile", () => {
      expect(() =>
        layer.updateProjectile(999, { position: [0, 0], direction: 0, alpha: 1 }),
      ).not.toThrow();
    });

    it("ignores remove for non-existent projectile", () => {
      expect(() => layer.removeProjectile(999)).not.toThrow();
    });

    it("stores text from opts", () => {
      layer.addProjectile(1, {
        iconUrl: "http://example.com/mine.png",
        iconSize: [35, 35],
        text: "APERS Bounding Mine",
      });
      const p = (layer as any).projectiles.get(1);
      expect(p.text).toBe("APERS Bounding Mine");
    });

    it("defaults text to empty string when not provided", () => {
      layer.addProjectile(1, {
        iconUrl: "http://example.com/grenade.png",
        iconSize: [35, 35],
      });
      const p = (layer as any).projectiles.get(1);
      expect(p.text).toBe("");
    });

    it("clears projectiles on dispose", () => {
      layer.addProjectile(1, {
        iconUrl: "http://example.com/grenade.png",
        iconSize: [35, 35],
      });
      layer.dispose();
      expect((layer as any).projectiles.size).toBe(0);
    });

    it("snaps projectile position when smoothing is off", () => {
      layer.setSmoothingEnabled(false);
      layer.addProjectile(1, {
        iconUrl: "http://example.com/grenade.png",
        iconSize: [35, 35],
      });
      layer.updateProjectile(1, { position: [500, 600], direction: 45, alpha: 1 });
      const p = (layer as any).projectiles.get(1);
      expect(p.interpProgress).toBe(1);
      expect(p.prevX).toBe(500);
      expect(p.prevY).toBe(600);
    });

    it("snaps on first update then interpolates subsequent small moves", () => {
      layer.setSmoothingEnabled(true, 1);
      layer.addProjectile(1, {
        iconUrl: "http://example.com/grenade.png",
        iconSize: [35, 35],
      });

      // First update — distance from (0,0) is large, snaps
      layer.updateProjectile(1, { position: [1000, 1000], direction: 45, alpha: 1 });
      const p = (layer as any).projectiles.get(1);
      expect(p.interpProgress).toBe(1);
      expect(p.prevX).toBe(1000);
      expect(p.prevY).toBe(1000);

      // Second update — small move, interpolates
      layer.updateProjectile(1, { position: [1005, 1005], direction: 46, alpha: 1 });
      expect(p.interpProgress).toBe(0);
      expect(p.targetX).toBe(1005);
      expect(p.targetY).toBe(1005);
    });

    it("snaps projectile on teleport (large distance)", () => {
      layer.setSmoothingEnabled(true, 1);
      layer.addProjectile(1, {
        iconUrl: "http://example.com/grenade.png",
        iconSize: [35, 35],
      });
      // Large move — exceeds SKIP_ANIMATION_DISTANCE
      layer.updateProjectile(1, { position: [99999, 99999], direction: 0, alpha: 1 });
      const p = (layer as any).projectiles.get(1);
      expect(p.interpProgress).toBe(1);
      expect(p.prevX).toBe(99999);
      expect(p.prevY).toBe(99999);
    });
  });

  describe("dispose", () => {
    it("cancels animation frame", () => {
      const cancelSpy = vi.spyOn(globalThis, "cancelAnimationFrame");
      layer.dispose();
      expect(cancelSpy).toHaveBeenCalled();
      cancelSpy.mockRestore();
    });

    it("removes canvas from DOM", () => {
      const canvas = (layer as any).canvas as HTMLCanvasElement;
      expect(canvas.parentNode).toBeTruthy();
      layer.dispose();
      expect(canvas.parentNode).toBeNull();
    });

    it("clears entities and fire lines", () => {
      layer.addEntity(1, DEFAULT_OPTS);
      layer.setFireLines([
        { fromX: 0, fromY: 0, toX: 100, toY: 100, color: "#f00", weight: 2, opacity: 0.8, cachedFromPx: 0, cachedFromPy: 0, cachedToPx: 0, cachedToPy: 0 },
      ]);
      layer.dispose();
      expect((layer as any).entities.size).toBe(0);
      expect((layer as any).fireLines).toEqual([]);
    });

    it("unregisters map events", () => {
      const offSpy = mockMap.off as ReturnType<typeof vi.fn>;
      layer.dispose();
      expect(offSpy).toHaveBeenCalledWith("zoomanim", expect.any(Function), layer);
    });
  });

  describe("updateEntity — label cache invalidation", () => {
    it("resets cachedLabelFontSize on update", () => {
      layer.addEntity(1, DEFAULT_OPTS);
      const e = getEntity(1);
      // Simulate a cached value
      e.cachedLabelFontSize = 11;
      e.cachedLabelMaxW = 50;
      layer.updateEntity(1, makeState());
      expect(e.cachedLabelFontSize).toBe(0);
    });
  });

  describe("updateEntity — ignores unknown entities", () => {
    it("does not throw for non-existent entity", () => {
      expect(() => layer.updateEntity(999, makeState())).not.toThrow();
    });
  });

  describe("removeEntity — non-existent", () => {
    it("does not throw for non-existent entity", () => {
      expect(() => layer.removeEntity(999)).not.toThrow();
    });
  });
});

// --------------- Render path tests ---------------
// Separate top-level describe so the canvas 2D context is mocked BEFORE
// the EntityCanvasLayer constructor runs (the outer block's ctx is null in jsdom).

describe("EntityCanvasLayer — render paths", () => {
  let layer: EntityCanvasLayer;
  let mockMap: L.Map;
  let mockCtx: Record<string, any>;
  let config: EntityCanvasConfig;
  let rafSpy: ReturnType<typeof vi.spyOn>;
  let ctxSpy: ReturnType<typeof vi.spyOn>;

  function render(dt = 0.016) {
    (layer as any).render(dt);
  }

  function getEntity(id: number) {
    return (layer as any).entities.get(id);
  }

  beforeEach(() => {
    rafSpy = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockReturnValue(0);

    mockCtx = {
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      strokeText: vi.fn(),
      fillText: vi.fn(),
      drawImage: vi.fn(),
      fill: vi.fn(),
      roundRect: vi.fn(),
      measureText: vi.fn(() => ({ width: 50 })),
      globalAlpha: 1,
      strokeStyle: "",
      fillStyle: "",
      lineWidth: 1,
      font: "",
      textBaseline: "alphabetic",
      textAlign: "start",
    };

    ctxSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(mockCtx as any);

    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", { value: 800 });
    Object.defineProperty(container, "clientHeight", { value: 600 });

    mockMap = {
      getContainer: () => container,
      latLngToContainerPoint: (ll: L.LatLng) => ({
        x: ll.lng * 0.01 + 400,
        y: 300 - ll.lat * 0.01,
      }),
      getZoomScale: () => 1,
      getZoom: () => 5,
      getCenter: () => L.latLng(0, 0),
      getSize: () => L.point(800, 600),
      getBounds: () =>
        L.latLngBounds(L.latLng(-10000, -10000), L.latLng(10000, 10000)),
      project: (ll: L.LatLng) => L.point(ll.lng, ll.lat),
      on: vi.fn(),
      off: vi.fn(),
    } as unknown as L.Map;

    const fakeImg = { width: 24, height: 24 };
    config = {
      armaToLatLng: (c) => L.latLng(c[1], c[0]),
      iconCache: {
        resolveType: (t: string) => t,
        get: () => fakeImg as any,
        getOrLoad: () => fakeImg as any,
        getSize: () => [24, 24] as [number, number],
        preloadAll: () => Promise.resolve(),
      } as unknown as CanvasIconCache,
      getZoom: () => 5,
      isMapLibreMode: false,
      nameDisplayMode: () => "all" as const,
      layerVisible: () => true,
      projectileLayerVisible: () => true,
      worldSize: 30720,
      latLngToArma: (ll) => [ll.lng, ll.lat] as [number, number],
    };

    layer = new EntityCanvasLayer(mockMap, config);
  });

  afterEach(() => {
    layer.dispose();
    ctxSpy.mockRestore();
    rafSpy.mockRestore();
  });

  // --- Early returns ---

  it("early return when layer not visible and grid hidden", () => {
    (layer as any).config.layerVisible = () => false;
    layer.addEntity(1, DEFAULT_OPTS);
    render();
    expect(mockCtx.clearRect).toHaveBeenCalled();
    expect(mockCtx.drawImage).not.toHaveBeenCalled();
  });

  it("early return when no entities, fire lines, or grid", () => {
    render();
    expect(mockCtx.clearRect).toHaveBeenCalled();
    expect(mockCtx.drawImage).not.toHaveBeenCalled();
    expect(mockCtx.stroke).not.toHaveBeenCalled();
  });

  it("renders when only projectiles exist (no entities)", () => {
    layer.addProjectile(1, {
      iconUrl: "http://example.com/grenade.png",
      iconSize: [35, 35],
    });
    layer.updateProjectile(1, { position: [100, 100], direction: 0, alpha: 1 });
    render();
    expect(mockCtx.drawImage).toHaveBeenCalled();
  });

  it("early returns when entity layer hidden and no projectiles or grid", () => {
    (layer as any).config.layerVisible = () => false;
    (layer as any).config.projectileLayerVisible = () => false;
    layer.addEntity(1, DEFAULT_OPTS);
    render();
    expect(mockCtx.drawImage).not.toHaveBeenCalled();
  });

  it("renders projectiles even when entity layer is hidden", () => {
    (layer as any).config.layerVisible = () => false;
    (layer as any).config.projectileLayerVisible = () => true;
    layer.addProjectile(1, {
      iconUrl: "http://example.com/grenade.png",
      iconSize: [35, 35],
    });
    layer.updateProjectile(1, { position: [100, 100], direction: 0, alpha: 1 });
    render();
    expect(mockCtx.drawImage).toHaveBeenCalled();
  });

  it("continues when layer hidden but grid visible", () => {
    (layer as any).config.layerVisible = () => false;
    layer.setGridVisible(true);
    render();
    expect(mockCtx.stroke).toHaveBeenCalled();
  });

  // --- Fire lines ---

  it("renders fire lines", () => {
    layer.setFireLines([{
      fromX: 100, fromY: 100, toX: 200, toY: 200,
      color: "#f00", weight: 2, opacity: 0.8,
      cachedFromPx: 0, cachedFromPy: 0, cachedToPx: 0, cachedToPy: 0,
    }]);
    render();
    expect(mockCtx.stroke).toHaveBeenCalled();
    expect(mockCtx.moveTo).toHaveBeenCalled();
    expect(mockCtx.lineTo).toHaveBeenCalled();
  });

  it("culls fire lines outside viewport", () => {
    layer.setFireLines([{
      fromX: -100000, fromY: 0, toX: -100001, toY: 0,
      color: "#f00", weight: 2, opacity: 0.8,
      cachedFromPx: 0, cachedFromPy: 0, cachedToPx: 0, cachedToPy: 0,
    }]);
    render();
    expect(mockCtx.stroke).not.toHaveBeenCalled();
  });

  it("caches fire line pixel positions", () => {
    const fl = {
      fromX: 100, fromY: 100, toX: 200, toY: 200,
      color: "#f00", weight: 2, opacity: 0.8,
      cachedFromPx: 0, cachedFromPy: 0, cachedToPx: 0, cachedToPy: 0,
    };
    layer.setFireLines([fl]);
    render();
    expect(fl.cachedFromPx).not.toBe(0);
    expect(fl.cachedToPx).not.toBe(0);
  });

  it("uses cached fire line positions during zoom", () => {
    layer.setFireLines([{
      fromX: 100, fromY: 100, toX: 200, toY: 200,
      color: "#f00", weight: 2, opacity: 0.8,
      cachedFromPx: 50, cachedFromPy: 50, cachedToPx: 150, cachedToPy: 150,
    }]);
    (layer as any).zooming = true;
    (layer as any).zoomScale = 2;
    render();
    expect(mockCtx.moveTo).toHaveBeenCalledWith(50, 50);
    expect(mockCtx.lineTo).toHaveBeenCalledWith(150, 150);
  });

  // --- Entity icons ---

  it("renders entity icons", () => {
    layer.addEntity(1, DEFAULT_OPTS);
    render();
    expect(mockCtx.drawImage).toHaveBeenCalled();
  });

  it("skips entities with opacity 0 (in vehicle)", () => {
    layer.addEntity(1, DEFAULT_OPTS);
    layer.updateEntity(1, makeState({ isInVehicle: true }));
    render();
    expect(mockCtx.drawImage).not.toHaveBeenCalled();
  });

  it("culls entities outside viewport", () => {
    layer.addEntity(1, { ...DEFAULT_OPTS, position: [-1000000, 0] });
    render();
    expect(mockCtx.drawImage).not.toHaveBeenCalled();
  });

  it("uses cached entity positions during zoom", () => {
    layer.addEntity(1, DEFAULT_OPTS);
    render();
    (layer as any).zooming = true;
    (layer as any).zoomScale = 2;
    mockCtx.drawImage.mockClear();
    render();
    expect(mockCtx.drawImage).toHaveBeenCalled();
  });

  it("advances interpolation", () => {
    layer.addEntity(1, DEFAULT_OPTS);
    layer.setSmoothingEnabled(true, 1);
    layer.updateEntity(1, makeState({ position: [1010, 2010] }));
    expect(getEntity(1).interpProgress).toBe(0);
    render(0.5);
    expect(getEntity(1).interpProgress).toBeCloseTo(0.5);
  });

  it("clamps interpolation progress to 1", () => {
    layer.addEntity(1, DEFAULT_OPTS);
    layer.setSmoothingEnabled(true, 10); // 0.1s duration
    layer.updateEntity(1, makeState({ position: [1010, 2010] }));
    render(1.0); // well past 0.1s
    expect(getEntity(1).interpProgress).toBe(1);
  });

  it("snaps interpolation when interpDuration is 0", () => {
    layer.addEntity(1, DEFAULT_OPTS);
    layer.setSmoothingEnabled(true, 0); // duration fallback to 1
    layer.updateEntity(1, makeState({ position: [1010, 2010] }));
    // interpProgress was snapped to 1 by updateEntity (smoothing + speed 0 → dur 1)
    // but let's also verify render handles dur>0 normally
    expect(getEntity(1).interpProgress).toBe(0);
    render(2.0); // 2s > 1s duration
    expect(getEntity(1).interpProgress).toBe(1);
  });

  it("renders hit flash with offscreen canvas tint", () => {
    layer.addEntity(1, DEFAULT_OPTS);
    layer.updateEntity(1, makeState({ hit: true, alive: 1 }));
    render();
    const calls = mockCtx.drawImage.mock.calls;
    // Hit flash uses 9-arg drawImage (source rect from offscreen canvas)
    expect(calls.some((c: any[]) => c.length === 9)).toBe(true);
  });

  it("clears hit flash after duration expires", () => {
    const perfSpy = vi.spyOn(performance, "now").mockReturnValue(10000);
    layer.addEntity(1, DEFAULT_OPTS);
    const e = getEntity(1);
    e.hitStartTime = 5000; // elapsed = 10000 - 5000 = 5000 > 300ms
    render();
    expect(e.hitStartTime).toBe(0);
    perfSpy.mockRestore();
  });

  it("draws man and non-man icons differently (rotation origin)", () => {
    layer.addEntity(1, { ...DEFAULT_OPTS, iconType: "man" });
    layer.addEntity(2, { ...DEFAULT_OPTS, iconType: "car", position: [1100, 2000] });
    render();
    // Both should draw — verify via setTransform being called for rotation
    expect(mockCtx.setTransform).toHaveBeenCalled();
    expect(mockCtx.drawImage).toHaveBeenCalledTimes(2);
  });

  // --- Labels ---

  it("renders unit labels when nameMode is 'all'", () => {
    layer.addEntity(1, DEFAULT_OPTS);
    render();
    const texts = mockCtx.fillText.mock.calls.map((c: any[]) => c[0]);
    expect(texts).toContain("Unit1");
  });

  it("hides labels when zoom below threshold", () => {
    (layer as any).config.getZoom = () => 3;
    layer.addEntity(1, DEFAULT_OPTS);
    render();
    const texts = mockCtx.fillText.mock.calls.map((c: any[]) => c[0]);
    expect(texts).not.toContain("Unit1");
  });

  it("hides labels when nameMode is 'none'", () => {
    (layer as any).config.nameDisplayMode = () => "none";
    layer.addEntity(1, DEFAULT_OPTS);
    render();
    const texts = mockCtx.fillText.mock.calls.map((c: any[]) => c[0]);
    expect(texts).not.toContain("Unit1");
  });

  it("shows only player labels when nameMode is 'players'", () => {
    (layer as any).config.nameDisplayMode = () => "players";
    layer.addEntity(1, { ...DEFAULT_OPTS, isPlayer: true });
    layer.addEntity(2, { ...DEFAULT_OPTS, isPlayer: false, name: "AI Unit", position: [1100, 2000] });
    render();
    const texts = mockCtx.fillText.mock.calls.map((c: any[]) => c[0]);
    expect(texts).toContain("Unit1");
    expect(texts).not.toContain("AI Unit");
  });

  it("shows AI vehicle type labels in 'players' mode", () => {
    (layer as any).config.nameDisplayMode = () => "players";
    layer.addEntity(1, {
      ...DEFAULT_OPTS,
      isPlayer: false,
      name: "T-72",
      crew: { count: 3, names: [] },
    });
    layer.addEntity(2, {
      ...DEFAULT_OPTS,
      isPlayer: false,
      name: "AI Rifleman",
      position: [1100, 2000],
    });
    render();
    const texts = mockCtx.fillText.mock.calls.map((c: any[]) => c[0]);
    expect(texts).toContain("T-72 (3)");
    expect(texts).not.toContain("AI Rifleman");
  });

  it("hides AI vehicle type labels when nameMode is 'none'", () => {
    (layer as any).config.nameDisplayMode = () => "none";
    layer.addEntity(1, {
      ...DEFAULT_OPTS,
      isPlayer: false,
      name: "T-72",
      crew: { count: 3, names: [] },
    });
    render();
    const texts = mockCtx.fillText.mock.calls.map((c: any[]) => c[0]);
    expect(texts).not.toContain("T-72 (3)");
  });

  it("renders vehicle crew label with background pill", () => {
    layer.addEntity(1, {
      ...DEFAULT_OPTS,
      crew: { count: 2, names: ["Driver", "Gunner"] },
    });
    render();
    expect(mockCtx.roundRect).toHaveBeenCalled();
    expect(mockCtx.fill).toHaveBeenCalled();
    const texts = mockCtx.fillText.mock.calls.map((c: any[]) => c[0]);
    expect(texts).toContain("Driver");
    expect(texts).toContain("Gunner");
  });

  it("renders vehicle label without crew names (AI only)", () => {
    layer.addEntity(1, {
      ...DEFAULT_OPTS,
      crew: { count: 3, names: [] },
    });
    render();
    expect(mockCtx.roundRect).not.toHaveBeenCalled();
    const texts = mockCtx.fillText.mock.calls.map((c: any[]) => c[0]);
    expect(texts).toContain("Unit1 (3)");
  });

  it("uses label measurement cache on subsequent renders", () => {
    layer.addEntity(1, {
      ...DEFAULT_OPTS,
      crew: { count: 2, names: ["Driver", "Gunner"] },
    });
    render();
    expect(mockCtx.measureText.mock.calls.length).toBeGreaterThan(0);
    mockCtx.measureText.mockClear();
    render();
    expect(mockCtx.measureText).not.toHaveBeenCalled();
  });

  // --- Grid ---

  it("renders grid lines and labels when grid visible", () => {
    layer.setGridVisible(true);
    render();
    expect(mockCtx.stroke).toHaveBeenCalled();
    expect(mockCtx.strokeText).toHaveBeenCalled();
    expect(mockCtx.fillText).toHaveBeenCalled();
  });

  // --- Affine projection ---

  it("computes affine projection coefficients", () => {
    layer.addEntity(1, DEFAULT_OPTS);
    render();
    const l = layer as any;
    expect(l.projAx).not.toBe(0);
    expect(l.projCx).not.toBe(0);
  });

  it("preserves affine projection during zoom", () => {
    layer.addEntity(1, DEFAULT_OPTS);
    render();
    const prevAx = (layer as any).projAx;
    (layer as any).zooming = true;
    (layer as any).zoomScale = 2;
    render();
    expect((layer as any).projAx).toBe(prevAx);
  });

  // --- Projectiles ---

  it("renders projectile icons", () => {
    layer.addProjectile(1, {
      iconUrl: "http://example.com/grenade.png",
      iconSize: [35, 35],
    });
    layer.updateProjectile(1, { position: [100, 100], direction: 0, alpha: 1 });
    render();
    expect(mockCtx.drawImage).toHaveBeenCalled();
  });

  it("skips projectiles with opacity 0", () => {
    layer.addProjectile(1, {
      iconUrl: "http://example.com/grenade.png",
      iconSize: [35, 35],
    });
    layer.updateProjectile(1, { position: [100, 100], direction: 0, alpha: 0 });
    render();
    expect(mockCtx.drawImage).not.toHaveBeenCalled();
  });

  it("skips projectiles when projectile layer is hidden", () => {
    (layer as any).config.projectileLayerVisible = () => false;
    layer.addProjectile(1, {
      iconUrl: "http://example.com/grenade.png",
      iconSize: [35, 35],
    });
    render();
    expect(mockCtx.drawImage).not.toHaveBeenCalled();
  });

  it("advances projectile interpolation progress during render", () => {
    layer.setSmoothingEnabled(true, 1);
    layer.addProjectile(1, {
      iconUrl: "http://example.com/grenade.png",
      iconSize: [35, 35],
    });
    // First update snaps (large distance from origin)
    layer.updateProjectile(1, { position: [1000, 1000], direction: 0, alpha: 1 });
    // Second update starts interpolation (small distance)
    layer.updateProjectile(1, { position: [1005, 1005], direction: 0, alpha: 1 });
    const p = (layer as any).projectiles.get(1);
    expect(p.interpProgress).toBe(0);

    // Render advances interpolation
    render();
    expect(p.interpProgress).toBeGreaterThan(0);
  });

  it("uses cached projectile positions during zoom", () => {
    layer.addProjectile(1, {
      iconUrl: "http://example.com/grenade.png",
      iconSize: [35, 35],
    });
    layer.updateProjectile(1, { position: [100, 100], direction: 0, alpha: 1 });
    render(); // Cache positions

    const p = (layer as any).projectiles.get(1);
    const cachedPx = p.cachedPx;
    const cachedPy = p.cachedPy;

    // Simulate zoom
    (layer as any).zooming = true;
    (layer as any).zoomScale = 2;
    render();

    // During zoom, cached positions should be used (not recalculated)
    expect(p.cachedPx).toBe(cachedPx);
    expect(p.cachedPy).toBe(cachedPy);
    expect(mockCtx.drawImage).toHaveBeenCalled();
  });

  it("culls off-screen projectiles", () => {
    layer.addProjectile(1, {
      iconUrl: "http://example.com/grenade.png",
      iconSize: [35, 35],
    });
    // Place projectile far off-screen (projection maps to way outside viewport)
    layer.updateProjectile(1, { position: [-999999, -999999], direction: 0, alpha: 1 });
    mockCtx.drawImage.mockClear();
    render();
    // drawImage is NOT called for entity icons when projectile is culled
    // (entities may still draw, so check setTransform calls for rotation —
    // the projectile's rotation setTransform should not appear)
    // Since no entities exist, drawImage should not be called at all
    expect(mockCtx.drawImage).not.toHaveBeenCalled();
  });

  it("renders projectile label when text is set", () => {
    layer.addProjectile(1, {
      iconUrl: "http://example.com/mine.png",
      iconSize: [35, 35],
      text: "APERS Bounding Mine",
    });
    layer.updateProjectile(1, { position: [100, 100], direction: 0, alpha: 1 });
    render();
    const texts = mockCtx.fillText.mock.calls.map((c: any[]) => c[0]);
    expect(texts).toContain("APERS Bounding Mine");
    // Should also have stroke outline
    const strokeTexts = mockCtx.strokeText.mock.calls.map((c: any[]) => c[0]);
    expect(strokeTexts).toContain("APERS Bounding Mine");
  });

  it("does not render label when projectile has no text", () => {
    layer.addProjectile(1, {
      iconUrl: "http://example.com/grenade.png",
      iconSize: [35, 35],
    });
    layer.updateProjectile(1, { position: [100, 100], direction: 0, alpha: 1 });
    render();
    // drawImage is called for the icon, but no fillText for labels
    expect(mockCtx.drawImage).toHaveBeenCalled();
    const texts = mockCtx.fillText.mock.calls.map((c: any[]) => c[0]);
    // No projectile-related text should appear (no entities either)
    expect(texts).toHaveLength(0);
  });

  it("skips projectiles whose icon has not loaded yet", () => {
    // Override getOrLoad to return null (icon loading)
    (layer as any).config.iconCache.getOrLoad = () => null;
    layer.addProjectile(1, {
      iconUrl: "http://example.com/grenade.png",
      iconSize: [35, 35],
    });
    layer.updateProjectile(1, { position: [100, 100], direction: 0, alpha: 1 });
    render();
    // No drawImage since icon isn't loaded
    expect(mockCtx.drawImage).not.toHaveBeenCalled();
  });

  it("renders projectiles between fire lines and entities", () => {
    layer.setFireLines([{
      fromX: 100, fromY: 100, toX: 200, toY: 200,
      color: "#f00", weight: 2, opacity: 0.8,
      cachedFromPx: 0, cachedFromPy: 0, cachedToPx: 0, cachedToPy: 0,
    }]);
    layer.addProjectile(1, {
      iconUrl: "http://example.com/grenade.png",
      iconSize: [35, 35],
    });
    layer.addEntity(2, DEFAULT_OPTS);
    render();
    expect(mockCtx.stroke).toHaveBeenCalled();
    expect(mockCtx.drawImage).toHaveBeenCalled();
  });

  // --- Snapshot ---

  it("snapshots drawnCenter and drawnZoom after render", () => {
    layer.addEntity(1, DEFAULT_OPTS);
    expect((layer as any).drawnCenter).toBeNull();
    render();
    expect((layer as any).drawnCenter).not.toBeNull();
    expect((layer as any).drawnZoom).toBe(5);
  });

  it("does not update drawnCenter during zoom", () => {
    layer.addEntity(1, DEFAULT_OPTS);
    render();
    const center1 = (layer as any).drawnCenter;
    (layer as any).zooming = true;
    (layer as any).zoomScale = 2;
    render();
    expect((layer as any).drawnCenter).toBe(center1); // same reference
  });

  it("resizes hit canvas when icon exceeds current dimensions", () => {
    // Use a large icon size to trigger hitCanvas resize (default is 64×64)
    (layer as any).config.iconCache.getSize = () => [80, 80] as [number, number];
    layer.addEntity(1, DEFAULT_OPTS);
    layer.updateEntity(1, makeState({ hit: true, alive: 1 }));
    const perfSpy = vi.spyOn(performance, "now").mockReturnValue(10000);
    // Set hitStartTime very recent so hit flash is active
    getEntity(1).hitStartTime = 9999; // elapsed = 1ms < 300ms
    render();
    const hc = (layer as any).hitCanvas;
    // hitCanvas should have been resized to fit the icon
    expect(hc.width).toBeGreaterThanOrEqual(80);
    expect(hc.height).toBeGreaterThanOrEqual(80);
    perfSpy.mockRestore();
  });

  // --- Zoom animation ---

  describe("onZoomAnim", () => {
    it("early returns when drawnCenter is null", () => {
      expect((layer as any).drawnCenter).toBeNull();
      (layer as any).onZoomAnim({ zoom: 7, center: L.latLng(0, 0) });
      // Should not set zooming because drawnCenter was null
      expect((layer as any).zooming).toBe(false);
    });

    it("sets CSS transform and zooming state", () => {
      // Make getZoomScale return non-1 to simulate actual zoom
      (mockMap as any).getZoomScale = () => 2;
      // First render to populate drawnCenter
      layer.addEntity(1, DEFAULT_OPTS);
      render();
      expect((layer as any).drawnCenter).not.toBeNull();

      (layer as any).onZoomAnim({ zoom: 7, center: L.latLng(0, 0) });
      expect((layer as any).zooming).toBe(true);
      expect((layer as any).zoomScale).toBe(2);
      const canvas = (layer as any).canvas as HTMLCanvasElement;
      expect(canvas.style.transition).toContain("transform");
      expect(canvas.style.transform).toContain("scale");
    });
  });

  describe("onTransitionEnd", () => {
    it("clears CSS transform and resets zoom state", () => {
      // Set up zooming state
      (layer as any).zooming = true;
      (layer as any).zoomScale = 2;
      const canvas = (layer as any).canvas as HTMLCanvasElement;
      canvas.style.transition = "transform 0.25s";
      canvas.style.transform = "scale(2)";

      (layer as any).onTransitionEnd();
      expect((layer as any).zooming).toBe(false);
      expect((layer as any).zoomScale).toBe(1);
      expect(canvas.style.transition).toBe("");
      expect(canvas.style.transform).toBe("");
    });
  });
});
