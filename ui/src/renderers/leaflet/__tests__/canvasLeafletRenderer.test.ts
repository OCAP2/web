import { describe, it, expect, vi, beforeEach } from "vitest";
import { CanvasLeafletRenderer } from "../canvasLeafletRenderer";
import type {
  EntityMarkerOpts,
  EntityMarkerState,
  MarkerHandle,
} from "../../renderer.types";
import type { ArmaCoord } from "../../../utils/coordinates";

// --------------- Helpers ---------------

function makeMockCanvasLayer() {
  return {
    addEntity: vi.fn(),
    updateEntity: vi.fn(),
    removeEntity: vi.fn(),
    setSmoothingEnabled: vi.fn(),
    dispose: vi.fn(),
    setFireLines: vi.fn(),
    clearFireLines: vi.fn(),
    setGridVisible: vi.fn(),
  };
}

function makeRenderer(mockCanvasLayer: ReturnType<typeof makeMockCanvasLayer>) {
  // Bypass the constructor (which calls super() and creates SolidJS signals)
  // by using Object.create to get just the prototype chain.
  const renderer = Object.create(
    CanvasLeafletRenderer.prototype,
  ) as any;
  renderer.canvasLayer = mockCanvasLayer;
  renderer.pendingFireLines = [];
  return renderer as CanvasLeafletRenderer;
}

function makeOpts(overrides?: Partial<EntityMarkerOpts>): EntityMarkerOpts {
  return {
    position: [100, 200] as ArmaCoord,
    direction: 90,
    iconType: "man",
    side: "WEST",
    name: "Unit1",
    isPlayer: true,
    ...overrides,
  };
}

function makeState(overrides?: Partial<EntityMarkerState>): EntityMarkerState {
  return {
    position: [150, 250] as ArmaCoord,
    direction: 180,
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

describe("CanvasLeafletRenderer", () => {
  let mockCanvasLayer: ReturnType<typeof makeMockCanvasLayer>;
  let renderer: CanvasLeafletRenderer;

  beforeEach(() => {
    mockCanvasLayer = makeMockCanvasLayer();
    renderer = makeRenderer(mockCanvasLayer);
  });

  // ---- Handle wrapping / round-trip ----

  describe("handle wrapping (round-trip via create + update)", () => {
    it("createEntityMarker returns a handle that updateEntityMarker can use", () => {
      const handle = renderer.createEntityMarker(42, makeOpts());
      expect(handle).toBeDefined();
      expect(mockCanvasLayer.addEntity).toHaveBeenCalledWith(42, expect.any(Object));

      const state = makeState();
      renderer.updateEntityMarker(handle, state);
      expect(mockCanvasLayer.updateEntity).toHaveBeenCalledWith(42, state);
    });

    it("preserves different entity IDs through handles", () => {
      const h1 = renderer.createEntityMarker(1, makeOpts());
      const h2 = renderer.createEntityMarker(2, makeOpts());
      const h3 = renderer.createEntityMarker(99, makeOpts());

      renderer.updateEntityMarker(h1, makeState());
      renderer.updateEntityMarker(h2, makeState());
      renderer.updateEntityMarker(h3, makeState());

      expect(mockCanvasLayer.updateEntity).toHaveBeenCalledTimes(3);
      expect(mockCanvasLayer.updateEntity.mock.calls[0][0]).toBe(1);
      expect(mockCanvasLayer.updateEntity.mock.calls[1][0]).toBe(2);
      expect(mockCanvasLayer.updateEntity.mock.calls[2][0]).toBe(99);
    });
  });

  // ---- createEntityMarker ----

  describe("createEntityMarker", () => {
    it("delegates to canvasLayer.addEntity with the correct id and opts", () => {
      const opts = makeOpts({ name: "Alpha", side: "EAST" });
      renderer.createEntityMarker(7, opts);

      expect(mockCanvasLayer.addEntity).toHaveBeenCalledOnce();
      expect(mockCanvasLayer.addEntity).toHaveBeenCalledWith(7, opts);
    });
  });

  // ---- updateEntityMarker ----

  describe("updateEntityMarker", () => {
    it("delegates to canvasLayer.updateEntity with the unwrapped id", () => {
      const handle = renderer.createEntityMarker(55, makeOpts());
      const state = makeState({ direction: 270, alive: 0 });

      renderer.updateEntityMarker(handle, state);

      expect(mockCanvasLayer.updateEntity).toHaveBeenCalledOnce();
      expect(mockCanvasLayer.updateEntity).toHaveBeenCalledWith(55, state);
    });
  });

  // ---- removeEntityMarker ----

  describe("removeEntityMarker", () => {
    it("delegates to canvasLayer.removeEntity with the unwrapped id", () => {
      const handle = renderer.createEntityMarker(10, makeOpts());
      renderer.removeEntityMarker(handle);

      expect(mockCanvasLayer.removeEntity).toHaveBeenCalledOnce();
      expect(mockCanvasLayer.removeEntity).toHaveBeenCalledWith(10);
    });
  });

  // ---- setSmoothingEnabled ----

  describe("setSmoothingEnabled", () => {
    it("delegates to canvasLayer.setSmoothingEnabled", () => {
      renderer.setSmoothingEnabled(true, 2.0);
      expect(mockCanvasLayer.setSmoothingEnabled).toHaveBeenCalledWith(true, 2.0);
    });

    it("passes false correctly", () => {
      renderer.setSmoothingEnabled(false);
      expect(mockCanvasLayer.setSmoothingEnabled).toHaveBeenCalledWith(false, undefined);
    });

    it("guards against null canvasLayer (pre-init)", () => {
      (renderer as any).canvasLayer = null;
      // Should not throw
      expect(() => renderer.setSmoothingEnabled(true)).not.toThrow();
    });
  });

  // ---- dispose ----

  describe("dispose", () => {
    it("calls canvasLayer.dispose", () => {
      // Mock super.dispose to avoid accessing real Leaflet map state
      const superDispose = vi.fn();
      Object.getPrototypeOf(CanvasLeafletRenderer.prototype).dispose = superDispose;

      renderer.dispose();
      expect(mockCanvasLayer.dispose).toHaveBeenCalledOnce();
    });

    it("calls super.dispose after canvasLayer.dispose", () => {
      const callOrder: string[] = [];
      mockCanvasLayer.dispose.mockImplementation(() => callOrder.push("canvas"));
      const superDispose = vi.fn(() => callOrder.push("super"));
      Object.getPrototypeOf(CanvasLeafletRenderer.prototype).dispose = superDispose;

      renderer.dispose();

      expect(callOrder).toEqual(["canvas", "super"]);
    });

    it("guards against null canvasLayer", () => {
      (renderer as any).canvasLayer = null;
      const superDispose = vi.fn();
      Object.getPrototypeOf(CanvasLeafletRenderer.prototype).dispose = superDispose;

      expect(() => renderer.dispose()).not.toThrow();
    });
  });

  // ---- addLine ----

  describe("addLine", () => {
    it("creates a fire line and delegates to canvasLayer.setFireLines", () => {
      const from: ArmaCoord = [100, 200] as ArmaCoord;
      const to: ArmaCoord = [300, 400] as ArmaCoord;
      const opts = { color: "#ff0000", weight: 2, opacity: 0.8 };

      const handle = renderer.addLine(from, to, opts);

      expect(handle).toBeDefined();
      expect(mockCanvasLayer.setFireLines).toHaveBeenCalledOnce();

      const lines = mockCanvasLayer.setFireLines.mock.calls[0][0];
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        fromX: 100,
        fromY: 200,
        toX: 300,
        toY: 400,
        color: "#ff0000",
        weight: 2,
        opacity: 0.8,
      });
    });

    it("accumulates multiple fire lines", () => {
      renderer.addLine([0, 0] as ArmaCoord, [10, 10] as ArmaCoord, {
        color: "red",
        weight: 1,
        opacity: 1,
      });
      renderer.addLine([20, 20] as ArmaCoord, [30, 30] as ArmaCoord, {
        color: "blue",
        weight: 2,
        opacity: 0.5,
      });

      expect(mockCanvasLayer.setFireLines).toHaveBeenCalledTimes(2);

      // Second call should include both lines
      const linesOnSecondCall = mockCanvasLayer.setFireLines.mock.calls[1][0];
      expect(linesOnSecondCall).toHaveLength(2);
      expect(linesOnSecondCall[0].color).toBe("red");
      expect(linesOnSecondCall[1].color).toBe("blue");
    });

    it("guards against null canvasLayer", () => {
      (renderer as any).canvasLayer = null;
      // Should not throw — the ?. operator guards the call
      expect(() =>
        renderer.addLine([0, 0] as ArmaCoord, [1, 1] as ArmaCoord, {
          color: "red",
          weight: 1,
          opacity: 1,
        }),
      ).not.toThrow();
    });
  });

  // ---- removeLine ----

  describe("removeLine", () => {
    it("clears fire lines and calls canvasLayer.clearFireLines on first call", () => {
      // Add two lines first
      const h1 = renderer.addLine([0, 0] as ArmaCoord, [1, 1] as ArmaCoord, {
        color: "red",
        weight: 1,
        opacity: 1,
      });
      const h2 = renderer.addLine([2, 2] as ArmaCoord, [3, 3] as ArmaCoord, {
        color: "blue",
        weight: 1,
        opacity: 1,
      });

      mockCanvasLayer.setFireLines.mockClear();
      mockCanvasLayer.clearFireLines.mockClear();

      // First removeLine clears everything
      renderer.removeLine(h1);
      expect(mockCanvasLayer.clearFireLines).toHaveBeenCalledOnce();
      expect((renderer as any).pendingFireLines).toHaveLength(0);
    });

    it("subsequent removeLine calls are no-ops", () => {
      const h1 = renderer.addLine([0, 0] as ArmaCoord, [1, 1] as ArmaCoord, {
        color: "red",
        weight: 1,
        opacity: 1,
      });
      const h2 = renderer.addLine([2, 2] as ArmaCoord, [3, 3] as ArmaCoord, {
        color: "blue",
        weight: 1,
        opacity: 1,
      });

      mockCanvasLayer.clearFireLines.mockClear();

      renderer.removeLine(h1);
      renderer.removeLine(h2);

      // Only called once — second call is a no-op because pendingFireLines is already empty
      expect(mockCanvasLayer.clearFireLines).toHaveBeenCalledOnce();
    });

    it("guards against null canvasLayer", () => {
      // Add a line so pendingFireLines is non-empty
      (renderer as any).pendingFireLines.push({
        fromX: 0, fromY: 0, toX: 1, toY: 1,
        color: "red", weight: 1, opacity: 1,
        cachedFromPx: 0, cachedFromPy: 0, cachedToPx: 0, cachedToPy: 0,
      });
      (renderer as any).canvasLayer = null;
      expect(() => renderer.removeLine({} as any)).not.toThrow();
    });
  });

  // ---- setLayerVisible (grid) ----

  describe("setLayerVisible", () => {
    it("delegates grid visibility to canvasLayer.setGridVisible", () => {
      // Mock super.setLayerVisible to avoid accessing SolidJS signals
      const superSetLayerVisible = vi.fn();
      Object.getPrototypeOf(CanvasLeafletRenderer.prototype).setLayerVisible =
        superSetLayerVisible;

      renderer.setLayerVisible("grid", true);
      expect(mockCanvasLayer.setGridVisible).toHaveBeenCalledWith(true);

      renderer.setLayerVisible("grid", false);
      expect(mockCanvasLayer.setGridVisible).toHaveBeenCalledWith(false);
    });

    it("calls super.setLayerVisible for all layers including grid", () => {
      const superSetLayerVisible = vi.fn();
      Object.getPrototypeOf(CanvasLeafletRenderer.prototype).setLayerVisible =
        superSetLayerVisible;

      renderer.setLayerVisible("grid", true);
      expect(superSetLayerVisible).toHaveBeenCalledWith("grid", true);
    });

    it("does not call canvasLayer.setGridVisible for non-grid layers", () => {
      const superSetLayerVisible = vi.fn();
      Object.getPrototypeOf(CanvasLeafletRenderer.prototype).setLayerVisible =
        superSetLayerVisible;

      renderer.setLayerVisible("entities", true);
      renderer.setLayerVisible("briefingMarkers", false);

      expect(mockCanvasLayer.setGridVisible).not.toHaveBeenCalled();
    });

    it("guards against null canvasLayer for grid", () => {
      const superSetLayerVisible = vi.fn();
      Object.getPrototypeOf(CanvasLeafletRenderer.prototype).setLayerVisible =
        superSetLayerVisible;

      (renderer as any).canvasLayer = null;
      expect(() => renderer.setLayerVisible("grid", true)).not.toThrow();
    });
  });
});
