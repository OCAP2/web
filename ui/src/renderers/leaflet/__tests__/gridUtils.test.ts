import { describe, it, expect } from "vitest";
import {
  getGridLevels,
  formatGridLabel,
  formatCoordLabel,
  computeGridLines,
} from "../gridUtils";

// ------------------------------------------------------------------
// getGridLevels — Legacy mode (zoom levels ~0-8)
// ------------------------------------------------------------------

describe("getGridLevels (legacy mode)", () => {
  it("returns major=10000, no minor at zoom 0", () => {
    expect(getGridLevels(0, false)).toEqual({ major: 10000, minor: null });
  });

  it("returns major=10000, no minor at zoom 2 (boundary)", () => {
    expect(getGridLevels(2, false)).toEqual({ major: 10000, minor: null });
  });

  it("returns major=10000, minor=1000 at zoom 3", () => {
    expect(getGridLevels(3, false)).toEqual({ major: 10000, minor: 1000 });
  });

  it("returns major=10000, minor=1000 at zoom 5 (boundary)", () => {
    expect(getGridLevels(5, false)).toEqual({ major: 10000, minor: 1000 });
  });

  it("returns major=1000, minor=100 at zoom 6", () => {
    expect(getGridLevels(6, false)).toEqual({ major: 1000, minor: 100 });
  });

  it("returns major=1000, minor=100 at zoom 8", () => {
    expect(getGridLevels(8, false)).toEqual({ major: 1000, minor: 100 });
  });
});

// ------------------------------------------------------------------
// getGridLevels — MapLibre mode (zoom levels ~10-20)
// ------------------------------------------------------------------

describe("getGridLevels (MapLibre mode)", () => {
  it("returns major=10000, no minor at zoom 10", () => {
    expect(getGridLevels(10, true)).toEqual({ major: 10000, minor: null });
  });

  it("returns major=10000, no minor at zoom 12 (boundary)", () => {
    expect(getGridLevels(12, true)).toEqual({ major: 10000, minor: null });
  });

  it("returns major=10000, minor=1000 at zoom 13", () => {
    expect(getGridLevels(13, true)).toEqual({ major: 10000, minor: 1000 });
  });

  it("returns major=10000, minor=1000 at zoom 15 (boundary)", () => {
    expect(getGridLevels(15, true)).toEqual({ major: 10000, minor: 1000 });
  });

  it("returns major=1000, minor=100 at zoom 16", () => {
    expect(getGridLevels(16, true)).toEqual({ major: 1000, minor: 100 });
  });

  it("returns major=1000, minor=100 at zoom 20", () => {
    expect(getGridLevels(20, true)).toEqual({ major: 1000, minor: 100 });
  });
});

// ------------------------------------------------------------------
// formatGridLabel — human-readable interval labels
// ------------------------------------------------------------------

describe("formatGridLabel", () => {
  it('formats 5000 as "5km"', () => {
    expect(formatGridLabel(5000)).toBe("5km");
  });

  it('formats 1000 as "1km"', () => {
    expect(formatGridLabel(1000)).toBe("1km");
  });

  it('formats 500 as "500m"', () => {
    expect(formatGridLabel(500)).toBe("500m");
  });

  it('formats 100 as "100m"', () => {
    expect(formatGridLabel(100)).toBe("100m");
  });

  it('formats 2000 as "2km"', () => {
    expect(formatGridLabel(2000)).toBe("2km");
  });

  it('formats 250 as "250m"', () => {
    expect(formatGridLabel(250)).toBe("250m");
  });

  it('formats 10000 as "10km"', () => {
    expect(formatGridLabel(10000)).toBe("10km");
  });
});

// ------------------------------------------------------------------
// formatCoordLabel — Arma grid reference labels
// ------------------------------------------------------------------

describe("formatCoordLabel", () => {
  // 10km interval: 1 digit
  it("shows 1-digit label at 10km interval", () => {
    expect(formatCoordLabel(10000, 10000)).toBe("1");
    expect(formatCoordLabel(20000, 10000)).toBe("2");
    expect(formatCoordLabel(30000, 10000)).toBe("3");
  });

  it("shows 0 at origin for 10km interval", () => {
    expect(formatCoordLabel(0, 10000)).toBe("0");
  });

  // 1km interval: 2 digits zero-padded
  it("shows 2-digit label at 1km interval", () => {
    expect(formatCoordLabel(5000, 1000)).toBe("05");
    expect(formatCoordLabel(15000, 1000)).toBe("15");
    expect(formatCoordLabel(30000, 1000)).toBe("30");
  });

  it("shows 00 at origin for 1km interval", () => {
    expect(formatCoordLabel(0, 1000)).toBe("00");
  });

  // 100m interval: 3 digits zero-padded
  it("shows 3-digit label at 100m interval", () => {
    expect(formatCoordLabel(500, 100)).toBe("005");
    expect(formatCoordLabel(2300, 100)).toBe("023");
    expect(formatCoordLabel(30700, 100)).toBe("307");
  });

  it("shows 000 at origin for 100m interval", () => {
    expect(formatCoordLabel(0, 100)).toBe("000");
  });

  // fallback for unexpected intervals
  it("returns raw value for unknown interval", () => {
    expect(formatCoordLabel(500, 50)).toBe("500");
  });
});

// ------------------------------------------------------------------
// computeGridLines — grid line positions
// ------------------------------------------------------------------

describe("computeGridLines", () => {
  it("snaps line positions to interval boundaries", () => {
    const result = computeGridLines(
      { minX: 0, maxX: 10000, minY: 0, maxY: 10000 },
      10000,
    );
    expect(result.x).toEqual([0, 10000]);
    expect(result.y).toEqual([0, 10000]);
  });

  it("snaps bounds that are not on interval boundaries", () => {
    const result = computeGridLines(
      { minX: 1200, maxX: 4800, minY: 300, maxY: 9700 },
      1000,
    );
    // floor(1200/1000)*1000 = 1000, ceil(4800/1000)*1000 = 5000
    expect(result.x).toEqual([1000, 2000, 3000, 4000, 5000]);
    // floor(300/1000)*1000 = 0, ceil(9700/1000)*1000 = 10000
    expect(result.y).toEqual([0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000]);
  });

  it("handles bounds exactly on interval boundaries", () => {
    const result = computeGridLines(
      { minX: 2000, maxX: 4000, minY: 1000, maxY: 3000 },
      1000,
    );
    expect(result.x).toEqual([2000, 3000, 4000]);
    expect(result.y).toEqual([1000, 2000, 3000]);
  });

  it("handles 100m intervals", () => {
    const result = computeGridLines(
      { minX: 0, maxX: 500, minY: 0, maxY: 500 },
      100,
    );
    expect(result.x).toEqual([0, 100, 200, 300, 400, 500]);
    expect(result.y).toEqual([0, 100, 200, 300, 400, 500]);
  });

  it("returns bounding lines when bounds are within one interval", () => {
    const result = computeGridLines(
      { minX: 100, maxX: 400, minY: 100, maxY: 400 },
      1000,
    );
    // floor(100/1000)*1000 = 0, ceil(400/1000)*1000 = 1000
    expect(result.x).toEqual([0, 1000]);
    expect(result.y).toEqual([0, 1000]);
  });

  it("handles zero-width bounds", () => {
    const result = computeGridLines(
      { minX: 1000, maxX: 1000, minY: 1000, maxY: 1000 },
      1000,
    );
    expect(result.x).toEqual([1000]);
    expect(result.y).toEqual([1000]);
  });

  it("handles large world (Altis-scale, 30720m)", () => {
    const result = computeGridLines(
      { minX: 0, maxX: 30000, minY: 0, maxY: 30000 },
      10000,
    );
    expect(result.x).toEqual([0, 10000, 20000, 30000]);
    expect(result.y).toEqual([0, 10000, 20000, 30000]);
  });
});
