import { describe, expect, it, vi } from "vitest";
import {
  parseMarkerPosition,
  findPositionIndex,
  MarkerManager,
} from "../markerManager";
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

  it("treats FRAME_FOREVER (-1) as infinite", () => {
    const positions: [number][] = [[0], [10]];
    expect(findPositionIndex(positions, 9999, 0, -1)).toBe(1);
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

  it("interpolates projectile markers between keyframes", () => {
    const renderer = makeStubRenderer();
    const mgr = new MarkerManager(renderer);

    // Projectile with two keyframes: frame 0 at (100,200), frame 10 at (200,400)
    mgr.loadMarkers([
      makeDef("mil_triangle", {
        positions: [
          [0, 100, 200, 0, 0, 1],
          [10, 200, 400, 0, 90, 1],
        ],
      }),
    ]);

    // Frame 0 — creates + updates at first keyframe
    mgr.updateFrame(0);
    expect(renderer.createBriefingMarker).toHaveBeenCalledTimes(1);
    expect(renderer.updateBriefingMarker).toHaveBeenCalledTimes(1);
    const firstUpdate = (renderer.updateBriefingMarker as any).mock.calls[0][1];
    expect(firstUpdate.position[0]).toBeCloseTo(100);
    expect(firstUpdate.position[1]).toBeCloseTo(200);

    // Frame 5 — midpoint, should interpolate (150, 300)
    mgr.updateFrame(5);
    expect(renderer.updateBriefingMarker).toHaveBeenCalledTimes(2);
    const midUpdate = (renderer.updateBriefingMarker as any).mock.calls[1][1];
    expect(midUpdate.position[0]).toBeCloseTo(150);
    expect(midUpdate.position[1]).toBeCloseTo(300);
    expect(midUpdate.direction).toBeCloseTo(45);

    // Frame 5 again — same frame, should skip
    mgr.updateFrame(5);
    expect(renderer.updateBriefingMarker).toHaveBeenCalledTimes(2);

    // Frame 7 — different frame, should interpolate (170, 340)
    mgr.updateFrame(7);
    expect(renderer.updateBriefingMarker).toHaveBeenCalledTimes(3);
    const lateUpdate = (renderer.updateBriefingMarker as any).mock.calls[2][1];
    expect(lateUpdate.position[0]).toBeCloseTo(170);
    expect(lateUpdate.position[1]).toBeCloseTo(340);
  });

  it("does not interpolate non-projectile markers between keyframes", () => {
    const renderer = makeStubRenderer();
    const mgr = new MarkerManager(renderer);

    // Regular briefing marker with two keyframes
    mgr.loadMarkers([
      makeDef("mil_dot", {
        side: "WEST",
        positions: [
          [0, 100, 200, 0, 0, 1],
          [10, 200, 400, 0, 90, 1],
        ],
      }),
    ]);

    mgr.updateFrame(0);
    expect(renderer.updateBriefingMarker).toHaveBeenCalledTimes(1);

    // Frame 5 — same keyframe index, non-projectile should skip
    mgr.updateFrame(5);
    expect(renderer.updateBriefingMarker).toHaveBeenCalledTimes(1);
  });

  it("interpolates alpha between keyframes for projectiles", () => {
    const renderer = makeStubRenderer();
    const mgr = new MarkerManager(renderer);

    mgr.loadMarkers([
      makeDef("mil_triangle", {
        positions: [
          [0, 100, 100, 0, 0, 1.0],
          [10, 200, 200, 0, 0, 0.0],
        ],
      }),
    ]);

    mgr.updateFrame(0);
    mgr.updateFrame(5);
    const update = (renderer.updateBriefingMarker as any).mock.calls[1][1];
    expect(update.alpha).toBeCloseTo(0.5);
  });

  it("does not interpolate projectile with only one keyframe", () => {
    const renderer = makeStubRenderer();
    const mgr = new MarkerManager(renderer);

    // Single keyframe — no next keyframe to interpolate toward
    mgr.loadMarkers([
      makeDef("Minefield", {
        positions: [[0, 100, 200, 0, 0, 1]],
      }),
    ]);

    mgr.updateFrame(0);
    expect(renderer.updateBriefingMarker).toHaveBeenCalledTimes(1);

    // Frame 5 — still same posIndex, no next keyframe, should skip
    mgr.updateFrame(5);
    expect(renderer.updateBriefingMarker).toHaveBeenCalledTimes(1);
  });

  it("interpolates magIcons projectiles the same as mil_triangle", () => {
    const renderer = makeStubRenderer();
    const mgr = new MarkerManager(renderer);

    mgr.loadMarkers([
      makeDef("magIcons/gear_M67.paa", {
        player: 1,
        positions: [
          [0, 0, 0, 0, 0, 1],
          [20, 100, 100, 0, 0, 1],
        ],
      }),
    ]);

    mgr.updateFrame(0);
    mgr.updateFrame(10); // midpoint
    const update = (renderer.updateBriefingMarker as any).mock.calls[1][1];
    expect(update.position[0]).toBeCloseTo(50);
    expect(update.position[1]).toBeCloseTo(50);
  });

  it("projectile reaches exact keyframe position when posIndex advances", () => {
    const renderer = makeStubRenderer();
    const mgr = new MarkerManager(renderer);

    mgr.loadMarkers([
      makeDef("mil_triangle", {
        positions: [
          [0, 0, 0, 0, 0, 1],
          [10, 100, 200, 0, 90, 1],
          [20, 300, 400, 0, 180, 1],
        ],
      }),
    ]);

    mgr.updateFrame(0);
    // At frame 10, posIndex advances to 1 — position should be exact keyframe 1
    mgr.updateFrame(10);
    const update = (renderer.updateBriefingMarker as any).mock.calls[1][1];
    expect(update.position[0]).toBeCloseTo(100);
    expect(update.position[1]).toBeCloseTo(200);
    expect(update.direction).toBeCloseTo(90);
  });

  it("projectile at last keyframe shows exact position (no interpolation)", () => {
    const renderer = makeStubRenderer();
    const mgr = new MarkerManager(renderer);

    mgr.loadMarkers([
      makeDef("mil_triangle", {
        positions: [
          [0, 0, 0, 0, 0, 1],
          [10, 500, 500, 0, 90, 1],
        ],
        endFrame: 15,
      }),
    ]);

    mgr.updateFrame(0);
    // At frame 10, posIndex=1 (last keyframe), no next keyframe
    mgr.updateFrame(10);
    const atKeyframe = (renderer.updateBriefingMarker as any).mock.calls[1][1];
    expect(atKeyframe.position[0]).toBeCloseTo(500);
    expect(atKeyframe.position[1]).toBeCloseTo(500);

    // At frame 12, still at last keyframe, no interpolation — should skip
    mgr.updateFrame(12);
    expect(renderer.updateBriefingMarker).toHaveBeenCalledTimes(2);
  });

  it("interpolates across three keyframes sequentially", () => {
    const renderer = makeStubRenderer();
    const mgr = new MarkerManager(renderer);

    mgr.loadMarkers([
      makeDef("mil_triangle", {
        positions: [
          [0, 0, 0, 0, 0, 1],
          [10, 100, 0, 0, 0, 1],
          [20, 100, 100, 0, 0, 1],
        ],
      }),
    ]);

    mgr.updateFrame(0);

    // Between keyframes 0 and 1: X moves, Y stays 0
    mgr.updateFrame(5);
    const seg1 = (renderer.updateBriefingMarker as any).mock.calls[1][1];
    expect(seg1.position[0]).toBeCloseTo(50);
    expect(seg1.position[1]).toBeCloseTo(0);

    // At keyframe 1 boundary
    mgr.updateFrame(10);
    const atKf1 = (renderer.updateBriefingMarker as any).mock.calls[2][1];
    expect(atKf1.position[0]).toBeCloseTo(100);
    expect(atKf1.position[1]).toBeCloseTo(0);

    // Between keyframes 1 and 2: X stays 100, Y moves
    mgr.updateFrame(15);
    const seg2 = (renderer.updateBriefingMarker as any).mock.calls[3][1];
    expect(seg2.position[0]).toBeCloseTo(100);
    expect(seg2.position[1]).toBeCloseTo(50);
  });

  it("clamps interpolation t to [0, 1]", () => {
    const renderer = makeStubRenderer();
    const mgr = new MarkerManager(renderer);

    // Two keyframes with a span of 0 frames (same frame number)
    mgr.loadMarkers([
      makeDef("mil_triangle", {
        positions: [
          [5, 100, 100, 0, 0, 1],
          [5, 200, 200, 0, 90, 1],
        ],
        startFrame: 5,
      }),
    ]);

    // span is 0, so t = Infinity — should be clamped to 1, giving position B
    mgr.updateFrame(5);
    const update = (renderer.updateBriefingMarker as any).mock.calls[0][1];
    expect(update.position[0]).toBeCloseTo(200);
    expect(update.position[1]).toBeCloseTo(200);
  });

  it("interpolation resets after projectile is removed and re-created", () => {
    const renderer = makeStubRenderer();
    const mgr = new MarkerManager(renderer);

    mgr.loadMarkers([
      makeDef("mil_triangle", {
        positions: [
          [0, 0, 0, 0, 0, 1],
          [10, 100, 100, 0, 0, 1],
        ],
        startFrame: 0,
        endFrame: 10,
      }),
    ]);

    mgr.updateFrame(5);
    expect(renderer.createBriefingMarker).toHaveBeenCalledTimes(1);
    const mid = (renderer.updateBriefingMarker as any).mock.calls[0][1];
    expect(mid.position[0]).toBeCloseTo(50);

    // Remove
    mgr.updateFrame(15);
    expect(renderer.removeBriefingMarker).toHaveBeenCalledTimes(1);

    // Seek back — should re-create and interpolate fresh
    mgr.updateFrame(2);
    expect(renderer.createBriefingMarker).toHaveBeenCalledTimes(2);
    const rewind = (renderer.updateBriefingMarker as any).mock.calls[1][1];
    expect(rewind.position[0]).toBeCloseTo(20);
    expect(rewind.position[1]).toBeCloseTo(20);
  });
});

// ─── MarkerManager.setSideFilter ───

describe("MarkerManager.setSideFilter", () => {
  it("only creates markers matching the active side", () => {
    const renderer = makeStubRenderer();
    const mgr = new MarkerManager(renderer);
    mgr.loadMarkers([
      makeDef("mil_dot", { side: "WEST" }),
      makeDef("mil_dot", { side: "EAST" }),
    ]);

    mgr.setSideFilter("WEST");
    mgr.updateFrame(0);
    expect(renderer.createBriefingMarker).toHaveBeenCalledTimes(1);
  });

  it("always shows GLOBAL markers regardless of side filter", () => {
    const renderer = makeStubRenderer();
    const mgr = new MarkerManager(renderer);
    mgr.loadMarkers([
      makeDef("mil_dot", { side: "GLOBAL" }),
      makeDef("mil_dot", { side: "WEST" }),
      makeDef("mil_dot", { side: "EAST" }),
    ]);

    mgr.setSideFilter("WEST");
    mgr.updateFrame(0);
    // GLOBAL + WEST = 2
    expect(renderer.createBriefingMarker).toHaveBeenCalledTimes(2);
  });

  it("removes visible markers when switching to a different side", () => {
    const renderer = makeStubRenderer();
    const mgr = new MarkerManager(renderer);
    mgr.loadMarkers([
      makeDef("mil_dot", { side: "WEST" }),
      makeDef("mil_dot", { side: "EAST" }),
    ]);

    mgr.setSideFilter("WEST");
    mgr.updateFrame(0);
    expect(renderer.createBriefingMarker).toHaveBeenCalledTimes(1);

    // Switch to EAST — WEST marker should be removed
    mgr.setSideFilter("EAST");
    expect(renderer.removeBriefingMarker).toHaveBeenCalledTimes(1);

    // EAST marker created on next updateFrame
    mgr.updateFrame(0);
    expect(renderer.createBriefingMarker).toHaveBeenCalledTimes(2);
  });

  it("keeps GLOBAL markers when switching sides", () => {
    const renderer = makeStubRenderer();
    const mgr = new MarkerManager(renderer);
    mgr.loadMarkers([
      makeDef("mil_dot", { side: "GLOBAL" }),
      makeDef("mil_dot", { side: "WEST" }),
    ]);

    mgr.setSideFilter("WEST");
    mgr.updateFrame(0);
    expect(renderer.createBriefingMarker).toHaveBeenCalledTimes(2);

    // Switch to EAST — WEST removed, GLOBAL kept
    mgr.setSideFilter("EAST");
    expect(renderer.removeBriefingMarker).toHaveBeenCalledTimes(1);
  });

  it("shows all markers when filter is null", () => {
    const renderer = makeStubRenderer();
    const mgr = new MarkerManager(renderer);
    mgr.loadMarkers([
      makeDef("mil_dot", { side: "WEST" }),
      makeDef("mil_dot", { side: "EAST" }),
      makeDef("mil_dot", { side: "GUER" }),
    ]);

    mgr.setSideFilter(null);
    mgr.updateFrame(0);
    expect(renderer.createBriefingMarker).toHaveBeenCalledTimes(3);
  });

  it("removes non-matching markers that were created before filter was set", () => {
    const renderer = makeStubRenderer();
    const mgr = new MarkerManager(renderer);
    mgr.loadMarkers([
      makeDef("mil_dot", { side: "WEST" }),
      makeDef("mil_dot", { side: "EAST" }),
    ]);

    // No filter — both created
    mgr.updateFrame(0);
    expect(renderer.createBriefingMarker).toHaveBeenCalledTimes(2);

    // Set filter — EAST removed immediately
    mgr.setSideFilter("WEST");
    expect(renderer.removeBriefingMarker).toHaveBeenCalledTimes(1);
  });

  it("is a no-op when setting the same side twice", () => {
    const renderer = makeStubRenderer();
    const mgr = new MarkerManager(renderer);
    mgr.loadMarkers([
      makeDef("mil_dot", { side: "WEST" }),
      makeDef("mil_dot", { side: "EAST" }),
    ]);

    mgr.setSideFilter("WEST");
    mgr.updateFrame(0);
    expect(renderer.createBriefingMarker).toHaveBeenCalledTimes(1);

    // Same side again — no removal, no re-creation
    mgr.setSideFilter("WEST");
    expect(renderer.removeBriefingMarker).not.toHaveBeenCalled();
  });
});

// ─── MarkerManager layer classification ───

describe("MarkerManager layer classification", () => {
  it("assigns known system marker types (player=-1) to systemMarkers layer", () => {
    const renderer = makeStubRenderer();
    const mgr = new MarkerManager(renderer);
    mgr.loadMarkers([makeDef("ObjectMarker", { player: -1, side: "GLOBAL" })]);
    mgr.updateFrame(0);
    expect(renderer.createBriefingMarker).toHaveBeenCalledWith(
      expect.objectContaining({ layer: "systemMarkers" }),
    );
  });

  it("assigns unknown marker types with player=-1 to briefingMarkers layer", () => {
    const renderer = makeStubRenderer();
    const mgr = new MarkerManager(renderer);
    mgr.loadMarkers([makeDef("loc_Tree", { player: -1, side: "GLOBAL" })]);
    mgr.updateFrame(0);
    expect(renderer.createBriefingMarker).toHaveBeenCalledWith(
      expect.objectContaining({ layer: "briefingMarkers" }),
    );
  });

  it("assigns projectile markers (magIcons on GLOBAL) to projectileMarkers layer", () => {
    const renderer = makeStubRenderer();
    const mgr = new MarkerManager(renderer);
    mgr.loadMarkers([
      makeDef("magIcons/gear_M67.paa", { player: 1, side: "GLOBAL" }),
    ]);
    mgr.updateFrame(0);
    expect(renderer.createBriefingMarker).toHaveBeenCalledWith(
      expect.objectContaining({ layer: "projectileMarkers" }),
    );
  });

  it("assigns Minefield on GLOBAL to projectileMarkers layer", () => {
    const renderer = makeStubRenderer();
    const mgr = new MarkerManager(renderer);
    mgr.loadMarkers([
      makeDef("Minefield", { player: 1, side: "GLOBAL" }),
    ]);
    mgr.updateFrame(0);
    expect(renderer.createBriefingMarker).toHaveBeenCalledWith(
      expect.objectContaining({ layer: "projectileMarkers" }),
    );
  });

  it("assigns mil_triangle on GLOBAL to projectileMarkers layer", () => {
    const renderer = makeStubRenderer();
    const mgr = new MarkerManager(renderer);
    mgr.loadMarkers([
      makeDef("mil_triangle", { player: 1, side: "GLOBAL" }),
    ]);
    mgr.updateFrame(0);
    expect(renderer.createBriefingMarker).toHaveBeenCalledWith(
      expect.objectContaining({ layer: "projectileMarkers" }),
    );
  });

  it("assigns player-owned non-GLOBAL ICON markers to briefingMarkers layer", () => {
    const renderer = makeStubRenderer();
    const mgr = new MarkerManager(renderer);
    mgr.loadMarkers([makeDef("mil_dot", { player: 1, side: "WEST" })]);
    mgr.updateFrame(0);
    expect(renderer.createBriefingMarker).toHaveBeenCalledWith(
      expect.objectContaining({ layer: "briefingMarkers" }),
    );
  });

  it("assigns non-ICON shapes to briefingMarkers layer regardless of player/side", () => {
    const renderer = makeStubRenderer();
    const mgr = new MarkerManager(renderer);
    mgr.loadMarkers([
      makeDef("mil_dot", { shape: "RECTANGLE", player: -1, side: "GLOBAL" }),
    ]);
    mgr.updateFrame(0);
    expect(renderer.createBriefingMarker).toHaveBeenCalledWith(
      expect.objectContaining({ layer: "briefingMarkers" }),
    );
  });
});

// ─── MarkerManager popup text (ICON markers) ───

describe("MarkerManager ICON marker popup text", () => {
  const entityLookup = (id: number) => {
    const names: Record<number, string> = { 1: "Kevin", 2: "Anna" };
    return names[id] ?? null;
  };

  it("system marker (player=-1) uses just the text", () => {
    const renderer = makeStubRenderer();
    const mgr = new MarkerManager(renderer);
    mgr.loadMarkers(
      [makeDef("mil_dot", { player: -1, text: "Objective Alpha" })],
      entityLookup,
    );
    mgr.updateFrame(0);
    expect(renderer.createBriefingMarker).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Objective Alpha" }),
    );
  });

  it("system marker with no text passes undefined", () => {
    const renderer = makeStubRenderer();
    const mgr = new MarkerManager(renderer);
    mgr.loadMarkers(
      [makeDef("mil_dot", { player: -1 })],
      entityLookup,
    );
    mgr.updateFrame(0);
    expect(renderer.createBriefingMarker).toHaveBeenCalledWith(
      expect.objectContaining({ text: undefined }),
    );
  });

  it("player-owned non-GLOBAL marker shows SIDE PlayerName Text", () => {
    const renderer = makeStubRenderer();
    const mgr = new MarkerManager(renderer);
    mgr.loadMarkers(
      [makeDef("mil_dot", { player: 1, side: "WEST", text: "80,4" })],
      entityLookup,
    );
    mgr.updateFrame(0);
    expect(renderer.createBriefingMarker).toHaveBeenCalledWith(
      expect.objectContaining({ text: "WEST Kevin 80,4" }),
    );
  });

  it("player-owned GLOBAL marker shows just text", () => {
    const renderer = makeStubRenderer();
    const mgr = new MarkerManager(renderer);
    mgr.loadMarkers(
      [makeDef("mil_dot", { player: 1, side: "GLOBAL", text: "Supply" })],
      entityLookup,
    );
    mgr.updateFrame(0);
    expect(renderer.createBriefingMarker).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Supply" }),
    );
  });

  it("projectile marker (magIcons) on GLOBAL shows PlayerName Text", () => {
    const renderer = makeStubRenderer();
    const mgr = new MarkerManager(renderer);
    mgr.loadMarkers(
      [makeDef("magIcons/gear_M67.paa", { player: 1, side: "GLOBAL", text: "" })],
      entityLookup,
    );
    mgr.updateFrame(0);
    expect(renderer.createBriefingMarker).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Kevin" }),
    );
  });

  it("objective marker (Terminal in text) shows just text", () => {
    const renderer = makeStubRenderer();
    const mgr = new MarkerManager(renderer);
    mgr.loadMarkers(
      [makeDef("mil_dot", { player: 1, side: "WEST", text: "Terminal Alpha" })],
      entityLookup,
    );
    mgr.updateFrame(0);
    expect(renderer.createBriefingMarker).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Terminal Alpha" }),
    );
  });

  it("system marker type on GLOBAL has no popup text", () => {
    const renderer = makeStubRenderer();
    const mgr = new MarkerManager(renderer);
    mgr.loadMarkers(
      [makeDef("ObjectMarker", { player: 1, side: "GLOBAL", text: "border" })],
      entityLookup,
    );
    mgr.updateFrame(0);
    expect(renderer.createBriefingMarker).toHaveBeenCalledWith(
      expect.objectContaining({ text: undefined }),
    );
  });

  it("works without entity lookup (no names)", () => {
    const renderer = makeStubRenderer();
    const mgr = new MarkerManager(renderer);
    mgr.loadMarkers(
      [makeDef("mil_dot", { player: 1, side: "WEST", text: "Mark" })],
    );
    mgr.updateFrame(0);
    expect(renderer.createBriefingMarker).toHaveBeenCalledWith(
      expect.objectContaining({ text: "WEST Mark" }),
    );
  });
});

// ─── MarkerManager.setBlacklist ───

describe("MarkerManager.setBlacklist", () => {
  it("hides markers from blacklisted players", () => {
    const renderer = makeStubRenderer();
    const mgr = new MarkerManager(renderer);
    mgr.loadMarkers([
      makeDef("mil_dot", { player: 5, side: "WEST" }),
      makeDef("mil_dot", { player: 10, side: "WEST" }),
    ]);

    mgr.updateFrame(0);
    expect(renderer.createBriefingMarker).toHaveBeenCalledTimes(2);

    // Blacklist player 5 — its marker should be removed
    mgr.setBlacklist(new Set([5]));
    expect(renderer.removeBriefingMarker).toHaveBeenCalledTimes(1);
  });

  it("does not blacklist system markers (player === -1)", () => {
    const renderer = makeStubRenderer();
    const mgr = new MarkerManager(renderer);
    mgr.loadMarkers([
      makeDef("mil_dot", { player: -1, side: "GLOBAL" }),
    ]);

    mgr.updateFrame(0);
    expect(renderer.createBriefingMarker).toHaveBeenCalledTimes(1);

    // Blacklisting -1 should have no effect on system markers
    mgr.setBlacklist(new Set([-1]));
    expect(renderer.removeBriefingMarker).not.toHaveBeenCalled();
  });

  it("prevents blacklisted markers from appearing in updateFrame", () => {
    const renderer = makeStubRenderer();
    const mgr = new MarkerManager(renderer);
    mgr.loadMarkers([
      makeDef("mil_dot", { player: 3, side: "WEST" }),
    ]);

    // Blacklist before any frame update
    mgr.setBlacklist(new Set([3]));
    mgr.updateFrame(0);
    expect(renderer.createBriefingMarker).not.toHaveBeenCalled();
  });

  it("removes existing markers during updateFrame when blacklisted", () => {
    const renderer = makeStubRenderer();
    const mgr = new MarkerManager(renderer);
    mgr.loadMarkers([
      makeDef("mil_dot", { player: 7, side: "EAST" }),
    ]);

    // Show marker first
    mgr.updateFrame(0);
    expect(renderer.createBriefingMarker).toHaveBeenCalledTimes(1);

    // Now blacklist and update frame
    mgr.setBlacklist(new Set([7]));
    // setBlacklist already removed it, but updateFrame should also skip
    mgr.updateFrame(1);
    // No new creates
    expect(renderer.createBriefingMarker).toHaveBeenCalledTimes(1);
  });
});

// ─── MarkerManager.getMarkerCountsByPlayer ───

describe("MarkerManager.getMarkerCountsByPlayer", () => {
  it("counts markers per player entity ID", () => {
    const mgr = new MarkerManager(makeStubRenderer());
    mgr.loadMarkers([
      makeDef("mil_dot", { player: 1 }),
      makeDef("mil_dot", { player: 1 }),
      makeDef("mil_dot", { player: 2 }),
    ]);

    const counts = mgr.getMarkerCountsByPlayer();
    expect(counts.get(1)).toBe(2);
    expect(counts.get(2)).toBe(1);
  });

  it("excludes system markers (player === -1)", () => {
    const mgr = new MarkerManager(makeStubRenderer());
    mgr.loadMarkers([
      makeDef("mil_dot", { player: -1 }),
      makeDef("mil_dot", { player: 3 }),
    ]);

    const counts = mgr.getMarkerCountsByPlayer();
    expect(counts.has(-1)).toBe(false);
    expect(counts.get(3)).toBe(1);
  });

  it("returns empty map when no markers loaded", () => {
    const mgr = new MarkerManager(makeStubRenderer());
    expect(mgr.getMarkerCountsByPlayer().size).toBe(0);
  });
});

// ─── MarkerManager.clear ───

describe("MarkerManager.clear", () => {
  it("removes all marker handles and resets state", () => {
    const renderer = makeStubRenderer();
    const mgr = new MarkerManager(renderer);
    mgr.loadMarkers([
      makeDef("mil_dot", { side: "WEST" }),
      makeDef("mil_dot", { side: "EAST" }),
    ]);

    mgr.updateFrame(0);
    expect(renderer.createBriefingMarker).toHaveBeenCalledTimes(2);

    mgr.clear();
    expect(renderer.removeBriefingMarker).toHaveBeenCalledTimes(2);

    // After clear, updateFrame should not create or remove anything
    (renderer.createBriefingMarker as ReturnType<typeof vi.fn>).mockClear();
    mgr.updateFrame(0);
    expect(renderer.createBriefingMarker).not.toHaveBeenCalled();
  });

  it("handles clear when no markers have handles", () => {
    const renderer = makeStubRenderer();
    const mgr = new MarkerManager(renderer);
    mgr.loadMarkers([makeDef("mil_dot")]);

    // Clear without ever calling updateFrame — no handles to remove
    mgr.clear();
    expect(renderer.removeBriefingMarker).not.toHaveBeenCalled();
  });
});

// ─── MarkerManager updateFrame side-filter removal ───

describe("MarkerManager updateFrame guard branches", () => {
  it("removes handle during updateFrame when side filter changes between frames", () => {
    const renderer = makeStubRenderer();
    const mgr = new MarkerManager(renderer);
    mgr.loadMarkers([
      makeDef("mil_dot", {
        side: "WEST",
        positions: [[0, 100, 200, 0, 0, 1], [5, 110, 210, 0, 0, 1]],
      }),
    ]);

    // Show with no filter
    mgr.updateFrame(0);
    expect(renderer.createBriefingMarker).toHaveBeenCalledTimes(1);

    // Change side filter to EAST — setSideFilter eagerly removes
    mgr.setSideFilter("EAST");
    expect(renderer.removeBriefingMarker).toHaveBeenCalledTimes(1);

    // updateFrame with filter still EAST — marker stays hidden
    mgr.updateFrame(5);
    expect(renderer.createBriefingMarker).toHaveBeenCalledTimes(1); // no new creates
  });
});
