import { describe, expect, it } from "vitest";
import {
  TFAR_DEFAULT_PROPAGATION,
  TFAR_T_MAX_METERS,
} from "../../../data/radioPropagation";
import { makeFlatDem, type DemGrid } from "../demGrid";
import {
  calcTerrainInterception,
  effectiveDistance,
  inTfarRange,
  marchCoverage,
} from "../tfarCoverage";

function makeHorizontalRidgeDem(
  worldSize: number,
  ridgeY: number,
  height: number,
  cellSize = 25,
): DemGrid {
  const cols = Math.ceil(worldSize / cellSize) + 1;
  const rows = cols;
  const data = new Float32Array(cols * rows);
  const ridgeRow = Math.round(ridgeY / cellSize);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (Math.abs(r - ridgeRow) <= 1) data[r * cols + c] = height;
    }
  }
  return { cols, rows, originX: 0, originY: 0, cellSize, worldSize, data };
}

function makeRidgeDem(
  worldSize: number,
  ridgeX: number,
  height: number,
  cellSize = 25,
): DemGrid {
  const cols = Math.ceil(worldSize / cellSize) + 1;
  const rows = cols;
  const data = new Float32Array(cols * rows);
  const ridgeCol = Math.round(ridgeX / cellSize);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (Math.abs(c - ridgeCol) <= 1) data[r * cols + c] = height;
    }
  }
  return { cols, rows, originX: 0, originY: 0, cellSize, worldSize, data };
}

describe("effectiveDistance", () => {
  it("matches the TFAR worked example for a 100 m ridge at 3 km", () => {
    expect(effectiveDistance(3000, 100, TFAR_DEFAULT_PROPAGATION)).toBe(4750);
    expect(effectiveDistance(3500, 100, TFAR_DEFAULT_PROPAGATION)).toBe(5425);
  });

  it("ignores terrain when the coefficient is 0", () => {
    const flat = { ...TFAR_DEFAULT_PROPAGATION, terrainInterceptionCoefficient: 0 };
    expect(effectiveDistance(4000, 250, flat)).toBe(4000);
  });

  it("grows range when TFAR_globalRadioRangeCoef is above 1", () => {
    const boosted = { ...TFAR_DEFAULT_PROPAGATION, globalRadioRangeCoef: 2 };
    expect(effectiveDistance(4000, 0, boosted)).toBe(2000);
  });
});

describe("calcTerrainInterception", () => {
  it("is 0 on flat ground", () => {
    const dem = makeFlatDem(8000, 0, 50);
    expect(calcTerrainInterception(dem, 100, 100, 1.6, 3100, 100, 1.6)).toBe(0);
  });

  it("finds about 100 m of extra midpoint height for a 100 m ridge", () => {
    const dem = makeRidgeDem(8000, 1500, 100);
    const t = calcTerrainInterception(dem, 0, 4000, 1.6, 3000, 4000, 1.6);
    expect(t).toBeGreaterThan(80);
    expect(t).toBeLessThan(130);
  });

  it("caps T at 250 m even when the wall is 400 m", () => {
    const dem = makeRidgeDem(8000, 1500, 400);
    const t = calcTerrainInterception(dem, 0, 4000, 1.6, 3000, 4000, 1.6);
    expect(t).toBeGreaterThan(TFAR_T_MAX_METERS - 15);
    expect(t).toBeLessThanOrEqual(TFAR_T_MAX_METERS);
  });
});

describe("inTfarRange", () => {
  it("keeps a 5 km radio in range at 3 km behind a 100 m ridge", () => {
    const dem = makeRidgeDem(8000, 1500, 100);
    expect(
      inTfarRange(dem, 0, 4000, 1.6, 3000, 4000, 1.6, 5000, TFAR_DEFAULT_PROPAGATION),
    ).toBe(true);
  });

  it("drops the same radio at 3.5 km behind that ridge", () => {
    const dem = makeRidgeDem(8000, 1500, 100);
    expect(
      inTfarRange(dem, 0, 4000, 1.6, 3500, 4000, 1.6, 5000, TFAR_DEFAULT_PROPAGATION),
    ).toBe(false);
  });
});

describe("marchCoverage", () => {
  it.each([0.5, 2])("matches the reachability radius with a range multiplier of %s", (coefficient) => {
    const dem = makeFlatDem(30000, 0, 100);
    const origin: [number, number] = [15000, 15000];
    const propagation = { ...TFAR_DEFAULT_PROPAGATION, globalRadioRangeCoef: coefficient };
    const radius = 5000 * coefficient;
    const verts = marchCoverage(dem, origin, { rangeMeters: 5000, propagation, bearings: 16 });
    expect(verts).toHaveLength(16);
    for (const [x, y] of verts) {
      expect(Math.hypot(x - origin[0], y - origin[1])).toBeCloseTo(radius, -1);
      expect(inTfarRange(dem, ...origin, 1.6, x, y, 1.6, 5000, propagation)).toBe(true);
    }
    expect(inTfarRange(dem, ...origin, 1.6, origin[0] + radius * 0.75, origin[1], 1.6, 5000, propagation)).toBe(true);
    expect(inTfarRange(dem, ...origin, 1.6, origin[0] + radius + 10, origin[1], 1.6, 5000, propagation)).toBe(false);
  });

  it("is a circle of rangeMeters on a flat DEM", () => {
    const dem = makeFlatDem(12000, 0, 50);
    const verts = marchCoverage(dem, [4000, 4000], {
      rangeMeters: 5000,
      propagation: TFAR_DEFAULT_PROPAGATION,
      bearings: 16,
    });
    expect(verts).toHaveLength(16);
    for (const [x, y] of verts) {
      expect(Math.hypot(x - 4000, y - 4000)).toBeCloseTo(5000, -1);
    }
  });

  it("stays a circle when C is 0 even if there is a ridge", () => {
    const dem = makeRidgeDem(12000, 6000, 180);
    const verts = marchCoverage(dem, [4000, 6000], {
      rangeMeters: 3000,
      propagation: { ...TFAR_DEFAULT_PROPAGATION, terrainInterceptionCoefficient: 0 },
      bearings: 12,
    });
    for (const [x, y] of verts) {
      expect(Math.hypot(x - 4000, y - 6000)).toBeCloseTo(3000, -1);
    }
  });

  it("shortens the far side of a 5 km radio behind a 100 m ridge", () => {
    const dem = makeRidgeDem(12000, 5500, 100);
    const verts = marchCoverage(dem, [4000, 6000], {
      rangeMeters: 5000,
      propagation: TFAR_DEFAULT_PROPAGATION,
      bearings: 16,
    });
    const east = verts.reduce((best, v) => (v[0] > best[0] ? v : best));
    const west = verts.reduce((best, v) => (v[0] < best[0] ? v : best));
    expect(east[0] - 4000).toBeLessThan(4000);
    expect(4000 - west[0]).toBeGreaterThan(4500);
  });

  it("shifts coverage from the nearest on-map point onto an off-map radio", () => {
    const dem = makeFlatDem(8000, 20, 50);
    const origin: [number, number] = [4000, -900];
    const verts = marchCoverage(dem, origin, {
      rangeMeters: 5000,
      propagation: TFAR_DEFAULT_PROPAGATION,
      bearings: 16,
    });
    expect(verts).toHaveLength(16);
    for (const [x, y] of verts) {
      expect(Math.hypot(x - origin[0], y - origin[1])).toBeCloseTo(5000, -1);
    }
  });

  it("keeps inland terrain when the radio is south of the map and shifts the polygon", () => {
    const dem = makeHorizontalRidgeDem(12000, 400, 120);
    const origin: [number, number, number] = [6000, -900, 400];
    const verts = marchCoverage(dem, origin, {
      rangeMeters: 5000,
      propagation: TFAR_DEFAULT_PROPAGATION,
      bearings: 16,
    });
    const north = verts.reduce((best, v) => (v[1] > best[1] ? v : best));
    const south = verts.reduce((best, v) => (v[1] < best[1] ? v : best));
    expect(north[1] - origin[1]).toBeLessThan(origin[1] - south[1]);
    expect(origin[1] - south[1]).toBeGreaterThan(4500);
  });
});
