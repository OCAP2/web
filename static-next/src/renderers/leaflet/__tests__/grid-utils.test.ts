import { describe, it, expect } from "vitest";
import {
  getGridInterval,
  formatGridLabel,
  formatCoordLabel,
  computeGridLines,
} from "../grid-utils";

// ------------------------------------------------------------------
// getGridInterval — Legacy mode (zoom levels ~0-8)
// ------------------------------------------------------------------

describe("getGridInterval (legacy mode)", () => {
  it("returns 5000 at zoom 1", () => {
    expect(getGridInterval(1, false)).toBe(5000);
  });

  it("returns 5000 at zoom 2 (boundary)", () => {
    expect(getGridInterval(2, false)).toBe(5000);
  });

  it("returns 1000 at zoom 3", () => {
    expect(getGridInterval(3, false)).toBe(1000);
  });

  it("returns 1000 at zoom 4 (boundary)", () => {
    expect(getGridInterval(4, false)).toBe(1000);
  });

  it("returns 500 at zoom 5", () => {
    expect(getGridInterval(5, false)).toBe(500);
  });

  it("returns 500 at zoom 6 (boundary)", () => {
    expect(getGridInterval(6, false)).toBe(500);
  });

  it("returns 100 at zoom 7", () => {
    expect(getGridInterval(7, false)).toBe(100);
  });

  it("returns 100 at zoom 8", () => {
    expect(getGridInterval(8, false)).toBe(100);
  });

  it("returns 5000 at zoom 0", () => {
    expect(getGridInterval(0, false)).toBe(5000);
  });
});

// ------------------------------------------------------------------
// getGridInterval — MapLibre mode (zoom levels ~10-20)
// ------------------------------------------------------------------

describe("getGridInterval (MapLibre mode)", () => {
  it("returns 5000 at zoom 11", () => {
    expect(getGridInterval(11, true)).toBe(5000);
  });

  it("returns 5000 at zoom 12 (boundary)", () => {
    expect(getGridInterval(12, true)).toBe(5000);
  });

  it("returns 1000 at zoom 13", () => {
    expect(getGridInterval(13, true)).toBe(1000);
  });

  it("returns 1000 at zoom 14 (boundary)", () => {
    expect(getGridInterval(14, true)).toBe(1000);
  });

  it("returns 500 at zoom 15", () => {
    expect(getGridInterval(15, true)).toBe(500);
  });

  it("returns 500 at zoom 16 (boundary)", () => {
    expect(getGridInterval(16, true)).toBe(500);
  });

  it("returns 100 at zoom 17", () => {
    expect(getGridInterval(17, true)).toBe(100);
  });

  it("returns 100 at zoom 20", () => {
    expect(getGridInterval(20, true)).toBe(100);
  });

  it("returns 5000 at zoom 10", () => {
    expect(getGridInterval(10, true)).toBe(5000);
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
// formatCoordLabel — grid coordinate labels
// ------------------------------------------------------------------

describe("formatCoordLabel", () => {
  it("shows km value when interval >= 1000", () => {
    expect(formatCoordLabel(5000, 1000)).toBe("5");
  });

  it("shows km value for large coordinates", () => {
    expect(formatCoordLabel(15000, 5000)).toBe("15");
  });

  it("shows meter value when interval < 1000", () => {
    expect(formatCoordLabel(500, 500)).toBe("500");
  });

  it("shows meter value at 100m interval", () => {
    expect(formatCoordLabel(2300, 100)).toBe("2300");
  });

  it("shows 0 for origin in km mode", () => {
    expect(formatCoordLabel(0, 1000)).toBe("0");
  });

  it("shows 0 for origin in meter mode", () => {
    expect(formatCoordLabel(0, 500)).toBe("0");
  });
});

// ------------------------------------------------------------------
// computeGridLines — grid line positions
// ------------------------------------------------------------------

describe("computeGridLines", () => {
  it("snaps line positions to interval boundaries", () => {
    const result = computeGridLines(
      { minX: 0, maxX: 10000, minY: 0, maxY: 10000 },
      5000,
    );
    expect(result.x).toEqual([0, 5000, 10000]);
    expect(result.y).toEqual([0, 5000, 10000]);
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

  it("handles small intervals (100m)", () => {
    const result = computeGridLines(
      { minX: 0, maxX: 500, minY: 0, maxY: 500 },
      100,
    );
    expect(result.x).toEqual([0, 100, 200, 300, 400, 500]);
    expect(result.y).toEqual([0, 100, 200, 300, 400, 500]);
  });

  it("returns single lines when bounds are within one interval", () => {
    const result = computeGridLines(
      { minX: 100, maxX: 400, minY: 100, maxY: 400 },
      500,
    );
    // floor(100/500)*500 = 0, ceil(400/500)*500 = 500
    expect(result.x).toEqual([0, 500]);
    expect(result.y).toEqual([0, 500]);
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
      5000,
    );
    expect(result.x).toEqual([0, 5000, 10000, 15000, 20000, 25000, 30000]);
    expect(result.y).toEqual([0, 5000, 10000, 15000, 20000, 25000, 30000]);
  });
});
