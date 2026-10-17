import { describe, expect, it } from "vitest";
import {
  ACRE_DEFAULT_PROPAGATION,
  ACRE_SIGNAL_MODEL_ARCADE,
  TFAR_DEFAULT_PROPAGATION,
} from "../../../data/radioPropagation";
import { makeFlatDem, type DemGrid } from "../demGrid";
import { inTfarRange, marchCoverage } from "../tfarCoverage";
import { inAcreRange, marchAcreCoverage, acreDiffractionLoss } from "../acreCoverage";

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
      if (c === ridgeCol) data[r * cols + c] = height;
    }
  }
  return { cols, rows, originX: 0, originY: 0, cellSize, worldSize, data };
}

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
      if (r === ridgeRow) data[r * cols + c] = height;
    }
  }
  return { cols, rows, originX: 0, originY: 0, cellSize, worldSize, data };
}

describe("inAcreRange", () => {
  it("keeps a 5 km radio in range at 3 km on flat ground", () => {
    const dem = makeFlatDem(8000, 0, 50);
    expect(
      inAcreRange(dem, 0, 4000, 1.6, 3000, 4000, 1.6, 5000, ACRE_DEFAULT_PROPAGATION, 60),
    ).toBe(true);
  });

  it("drops the same radio at 3 km behind a 100 m ridge", () => {
    const dem = makeRidgeDem(8000, 1500, 100);
    expect(
      inAcreRange(dem, 0, 4000, 1.6, 3000, 4000, 1.6, 5000, ACRE_DEFAULT_PROPAGATION, 60),
    ).toBe(false);
  });

  it("stays in range behind that ridge when terrainLoss is 0", () => {
    const dem = makeRidgeDem(8000, 1500, 100);
    expect(
      inAcreRange(
        dem,
        0,
        4000,
        1.6,
        3000,
        4000,
        1.6,
        5000,
        { ...ACRE_DEFAULT_PROPAGATION, terrainLoss: 0 },
        60,
      ),
    ).toBe(true);
  });

  it("stays in range behind that ridge in arcade mode even with terrainLoss 1", () => {
    const dem = makeRidgeDem(8000, 1500, 100);
    expect(
      inAcreRange(
        dem,
        0,
        4000,
        1.6,
        3000,
        4000,
        1.6,
        5000,
        { ...ACRE_DEFAULT_PROPAGATION, signalModel: ACRE_SIGNAL_MODEL_ARCADE },
        60,
      ),
    ).toBe(true);
  });

  it("does not reuse TFAR's coefficient for the same ridge", () => {
    const dem = makeRidgeDem(8000, 1500, 100);
    const tfarInRange = inTfarRange(
      dem,
      0,
      4000,
      1.6,
      3000,
      4000,
      1.6,
      5000,
      TFAR_DEFAULT_PROPAGATION,
    );
    const acreInRange = inAcreRange(
      dem,
      0,
      4000,
      1.6,
      3000,
      4000,
      1.6,
      5000,
      ACRE_DEFAULT_PROPAGATION,
      60,
    );
    expect(tfarInRange).toBe(true);
    expect(acreInRange).toBe(false);
  });

  it("does not treat bilinear noise as knife edges on raised flat ground", () => {
    const dem = makeFlatDem(8000, 20, 50);
    expect(acreDiffractionLoss(dem, 1000, 1000, 21.6, 6000, 5000, 21.6, 60)).toBe(0);
  });
});

describe("marchAcreCoverage", () => {
  it("is a circle of rangeMeters on a flat DEM", () => {
    const dem = makeFlatDem(12000, 20, 50);
    const verts = marchAcreCoverage(dem, [4000, 4000], {
      rangeMeters: 5000,
      propagation: ACRE_DEFAULT_PROPAGATION,
      frequencyMHz: 60,
      bearings: 16,
    });
    expect(verts).toHaveLength(16);
    for (const [x, y] of verts) {
      expect(Math.hypot(x - 4000, y - 4000)).toBeCloseTo(5000, -1);
    }
  });

  it("stays a circle when terrainLoss is 0 even if there is a ridge", () => {
    const dem = makeRidgeDem(12000, 6000, 180);
    const verts = marchAcreCoverage(dem, [4000, 6000], {
      rangeMeters: 3000,
      propagation: { ...ACRE_DEFAULT_PROPAGATION, terrainLoss: 0 },
      frequencyMHz: 60,
      bearings: 12,
    });
    for (const [x, y] of verts) {
      expect(Math.hypot(x - 4000, y - 6000)).toBeCloseTo(3000, -1);
    }
  });

  it("shortens farther than TFAR behind a 100 m ridge", () => {
    const dem = makeRidgeDem(12000, 5500, 100);
    const origin: [number, number] = [4000, 6000];
    const acre = marchAcreCoverage(dem, origin, {
      rangeMeters: 5000,
      propagation: ACRE_DEFAULT_PROPAGATION,
      frequencyMHz: 60,
      bearings: 16,
    });
    const tfar = marchCoverage(dem, origin, {
      rangeMeters: 5000,
      propagation: TFAR_DEFAULT_PROPAGATION,
      bearings: 16,
    });
    const acreEast = acre.reduce((best, v) => (v[0] > best[0] ? v : best));
    const tfarEast = tfar.reduce((best, v) => (v[0] > best[0] ? v : best));
    expect(acreEast[0] - 4000).toBeLessThan(tfarEast[0] - 4000);
    expect(acreEast[0] - 4000).toBeLessThan(2000);
  });

  it("shifts ACRE coverage onto an off-map radio", () => {
    const dem = makeFlatDem(8000, 20, 50);
    const origin: [number, number] = [4000, -900];
    const verts = marchAcreCoverage(dem, origin, {
      rangeMeters: 5000,
      propagation: ACRE_DEFAULT_PROPAGATION,
      frequencyMHz: 60,
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
    const verts = marchAcreCoverage(dem, origin, {
      rangeMeters: 5000,
      propagation: ACRE_DEFAULT_PROPAGATION,
      frequencyMHz: 60,
      bearings: 16,
    });
    const north = verts.reduce((best, v) => (v[1] > best[1] ? v : best));
    const south = verts.reduce((best, v) => (v[1] < best[1] ? v : best));
    expect(north[1] - origin[1]).toBeLessThan(origin[1] - south[1]);
    expect(origin[1] - south[1]).toBeGreaterThan(4500);
  });
});
