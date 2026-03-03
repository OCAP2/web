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
    ...overrides,
  };
}

const DEFAULT_OPTS: EntityMarkerOpts = {
  position: [1000, 2000],
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

  describe("removeEntity", () => {
    it("removes the entity from internal map", () => {
      layer.addEntity(1, DEFAULT_OPTS);
      expect(getEntity(1)).toBeDefined();
      layer.removeEntity(1);
      expect(getEntity(1)).toBeUndefined();
    });
  });
});
