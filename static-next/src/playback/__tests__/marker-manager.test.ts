import { describe, expect, it, vi } from "vitest";
import {
  parseMarkerPosition,
  findPositionIndex,
  MarkerManager,
} from "../marker-manager";
import type { MarkerDef } from "../../data/types";
import type { MapRenderer } from "../../renderers/renderer.interface";

// ─── parseMarkerPosition ───

describe("parseMarkerPosition", () => {
  describe("protobuf format", () => {
    it("parses basic position", () => {
      const result = parseMarkerPosition([10, 500.0, 600.0, 0, 90, 0.8]);
      expect(result.frameNum).toBe(10);
      expect(result.position).toEqual([500.0, 600.0]);
      expect(result.direction).toBe(90);
      expect(result.alpha).toBe(0.8);
      expect(result.linePoints).toBeUndefined();
    });

    it("parses position with line coordinates", () => {
      const result = parseMarkerPosition([
        5, 100, 200, 0, 45, 1, 300, 400, 500, 600,
      ]);
      expect(result.frameNum).toBe(5);
      expect(result.position).toEqual([100, 200]);
      expect(result.direction).toBe(45);
      expect(result.alpha).toBe(1);
      expect(result.linePoints).toEqual([
        [300, 400],
        [500, 600],
      ]);
    });

    it("defaults direction and alpha when missing", () => {
      const result = parseMarkerPosition([0, 10, 20]);
      expect(result.direction).toBe(0);
      expect(result.alpha).toBe(1);
    });

    it("ignores odd trailing line coord (needs pairs)", () => {
      // 7 elements: frameNum + pos(3) + dir + alpha + 1 lone coord
      const result = parseMarkerPosition([0, 10, 20, 0, 0, 1, 99]);
      expect(result.linePoints).toBeUndefined();
    });
  });

  describe("JSON format", () => {
    it("parses [frameNum, [x, y], dir, alpha]", () => {
      const result = parseMarkerPosition([10, [500, 600], 90, 0.5]);
      expect(result.frameNum).toBe(10);
      expect(result.position).toEqual([500, 600]);
      expect(result.direction).toBe(90);
      expect(result.alpha).toBe(0.5);
      expect(result.linePoints).toBeUndefined();
    });

    it("parses [frameNum, [x, y, z], dir, alpha]", () => {
      const result = parseMarkerPosition([10, [500, 600, 50], 180, 1]);
      expect(result.position).toEqual([500, 600]);
    });

    it("unwraps nested [[x, y, z]]", () => {
      const result = parseMarkerPosition([10, [[500, 600, 50]], 0, 1]);
      expect(result.position).toEqual([500, 600]);
    });

    it("parses polyline coordinates", () => {
      const result = parseMarkerPosition([
        10,
        [
          [100, 200],
          [300, 400],
          [500, 600],
        ],
        0,
        1,
      ]);
      expect(result.linePoints).toEqual([
        [100, 200],
        [300, 400],
        [500, 600],
      ]);
      expect(result.position).toEqual([100, 200]);
    });

    it("defaults direction and alpha when missing", () => {
      const result = parseMarkerPosition([0, [10, 20]]);
      expect(result.direction).toBe(0);
      expect(result.alpha).toBe(1);
    });
  });
});

// ─── findPositionIndex ───

describe("findPositionIndex", () => {
  it("returns -1 for empty positions", () => {
    expect(findPositionIndex([], 5, 0, 100)).toBe(-1);
  });

  it("returns -1 when frame is before startFrame", () => {
    expect(findPositionIndex([[10], [20], [30]], 5, 10, 30)).toBe(-1);
  });

  it("returns -1 when frame is after endFrame", () => {
    expect(findPositionIndex([[10], [20], [30]], 35, 10, 30)).toBe(-1);
  });

  it("finds exact frame match", () => {
    const positions: [number][] = [[0], [10], [20], [30]];
    expect(findPositionIndex(positions, 20, 0, 30)).toBe(2);
  });

  it("finds closest preceding frame (interpolation)", () => {
    const positions: [number][] = [[0], [10], [20], [30]];
    expect(findPositionIndex(positions, 15, 0, 30)).toBe(1);
    expect(findPositionIndex(positions, 25, 0, 30)).toBe(2);
  });

  it("returns last index at endFrame", () => {
    const positions: [number][] = [[0], [10], [20]];
    expect(findPositionIndex(positions, 30, 0, 30)).toBe(2);
  });

  it("handles single position", () => {
    expect(findPositionIndex([[5]], 5, 5, 100)).toBe(0);
    expect(findPositionIndex([[5]], 50, 5, 100)).toBe(0);
  });

  it("treats endFrame -1 as infinite", () => {
    const positions: [number][] = [[0], [10]];
    expect(findPositionIndex(positions, 9999, 0, -1)).toBe(1);
  });

  it("treats endFrame 4294967295 (uint32 max) as infinite", () => {
    const positions: [number][] = [[0], [10]];
    expect(findPositionIndex(positions, 9999, 0, 4294967295)).toBe(1);
  });

  it("returns first index when frame equals startFrame", () => {
    const positions: [number][] = [[5], [15], [25]];
    expect(findPositionIndex(positions, 5, 5, 25)).toBe(0);
  });
});

// ─── MarkerManager ───

function makeDef(type: string, overrides?: Partial<MarkerDef>): MarkerDef {
  return {
    shape: "ICON",
    type,
    side: "GLOBAL",
    color: "FF0000",
    positions: [[0, 100, 200, 0, 0, 1]],
    player: -1,
    alpha: 1,
    startFrame: 0,
    endFrame: -1,
    ...overrides,
  };
}

function makeStubRenderer() {
  return {
    createBriefingMarker: vi.fn(() => ({}) as any),
    updateBriefingMarker: vi.fn(),
    removeBriefingMarker: vi.fn(),
  } as unknown as MapRenderer;
}

describe("MarkerManager.loadMarkers", () => {
  it("filters out Empty marker types", () => {
    const mgr = new MarkerManager(makeStubRenderer());
    mgr.loadMarkers([
      makeDef("mil_dot"),
      makeDef("Empty"),
      makeDef("EmptyIcon"),
    ]);
    // updateFrame should only process mil_dot
    mgr.updateFrame(0);
    const renderer = (mgr as any).renderer as ReturnType<
      typeof makeStubRenderer
    >;
    expect(renderer.createBriefingMarker).toHaveBeenCalledTimes(1);
  });

  it("filters out zoneTrigger marker types", () => {
    const mgr = new MarkerManager(makeStubRenderer());
    mgr.loadMarkers([makeDef("mil_dot"), makeDef("zoneTrigger_west")]);
    mgr.updateFrame(0);
    const renderer = (mgr as any).renderer as ReturnType<
      typeof makeStubRenderer
    >;
    expect(renderer.createBriefingMarker).toHaveBeenCalledTimes(1);
  });

  it("keeps all other marker types", () => {
    const mgr = new MarkerManager(makeStubRenderer());
    mgr.loadMarkers([
      makeDef("mil_dot"),
      makeDef("mil_triangle"),
      makeDef("respawn_inf"),
      makeDef("magIcons/gear_M67_CA.paa"),
    ]);
    mgr.updateFrame(0);
    const renderer = (mgr as any).renderer as ReturnType<
      typeof makeStubRenderer
    >;
    expect(renderer.createBriefingMarker).toHaveBeenCalledTimes(4);
  });
});

// ─── MarkerManager.updateFrame keyframe skipping ───

describe("MarkerManager.updateFrame keyframe skipping", () => {
  it("skips update when position keyframe has not changed", () => {
    const renderer = makeStubRenderer();
    const mgr = new MarkerManager(renderer);
    // Single keyframe at frame 0 — active for all frames (endFrame = -1)
    mgr.loadMarkers([makeDef("mil_dot")]);

    mgr.updateFrame(0);
    expect(renderer.createBriefingMarker).toHaveBeenCalledTimes(1);
    expect(renderer.updateBriefingMarker).toHaveBeenCalledTimes(1);

    // Same keyframe — should skip
    mgr.updateFrame(1);
    expect(renderer.updateBriefingMarker).toHaveBeenCalledTimes(1);

    mgr.updateFrame(5);
    expect(renderer.updateBriefingMarker).toHaveBeenCalledTimes(1);
  });

  it("updates when position keyframe changes", () => {
    const renderer = makeStubRenderer();
    const mgr = new MarkerManager(renderer);
    // Two keyframes: frame 0 and frame 10
    mgr.loadMarkers([
      makeDef("mil_dot", {
        positions: [
          [0, 100, 200, 0, 0, 1],
          [10, 300, 400, 0, 0, 1],
        ],
      }),
    ]);

    mgr.updateFrame(0); // keyframe index 0
    expect(renderer.updateBriefingMarker).toHaveBeenCalledTimes(1);

    mgr.updateFrame(5); // still keyframe index 0 — skip
    expect(renderer.updateBriefingMarker).toHaveBeenCalledTimes(1);

    mgr.updateFrame(10); // keyframe index 1 — update
    expect(renderer.updateBriefingMarker).toHaveBeenCalledTimes(2);

    mgr.updateFrame(15); // still keyframe index 1 — skip
    expect(renderer.updateBriefingMarker).toHaveBeenCalledTimes(2);
  });

  it("always updates on first appearance (create + update)", () => {
    const renderer = makeStubRenderer();
    const mgr = new MarkerManager(renderer);
    mgr.loadMarkers([makeDef("mil_dot", { startFrame: 5 })]);

    mgr.updateFrame(0); // before startFrame — not visible
    expect(renderer.createBriefingMarker).not.toHaveBeenCalled();

    mgr.updateFrame(5); // first appearance — must create + update
    expect(renderer.createBriefingMarker).toHaveBeenCalledTimes(1);
    expect(renderer.updateBriefingMarker).toHaveBeenCalledTimes(1);
  });

  it("resets keyframe tracking when marker is removed and re-added", () => {
    const renderer = makeStubRenderer();
    const mgr = new MarkerManager(renderer);
    mgr.loadMarkers([
      makeDef("mil_dot", { startFrame: 0, endFrame: 10 }),
    ]);

    mgr.updateFrame(0); // visible — create + update
    expect(renderer.createBriefingMarker).toHaveBeenCalledTimes(1);
    expect(renderer.updateBriefingMarker).toHaveBeenCalledTimes(1);

    mgr.updateFrame(15); // past endFrame — removed
    expect(renderer.removeBriefingMarker).toHaveBeenCalledTimes(1);

    // Seeking back — marker reappears, must create + update again
    mgr.updateFrame(0);
    expect(renderer.createBriefingMarker).toHaveBeenCalledTimes(2);
    expect(renderer.updateBriefingMarker).toHaveBeenCalledTimes(2);
  });

  it("does not skip updates across different markers", () => {
    const renderer = makeStubRenderer();
    const mgr = new MarkerManager(renderer);
    mgr.loadMarkers([
      makeDef("mil_dot"),
      makeDef("mil_triangle"),
    ]);

    mgr.updateFrame(0);
    expect(renderer.createBriefingMarker).toHaveBeenCalledTimes(2);
    expect(renderer.updateBriefingMarker).toHaveBeenCalledTimes(2);

    // Both at same keyframe — both should skip
    mgr.updateFrame(1);
    expect(renderer.updateBriefingMarker).toHaveBeenCalledTimes(2);
  });
});
