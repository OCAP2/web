import { describe, expect, it } from "vitest";
import {
  decodeDemBinary,
  encodeDemBinary,
  makeFlatDem,
  nearestOnDem,
  projectCoverageOrigin,
  sampleDem,
  worldHasElevation,
} from "../demGrid";

describe("dem.bin roundtrip", () => {
  it("encodes and decodes heights to a tenth of a metre", () => {
    const grid = makeFlatDem(1000, 42.5, 100);
    grid.data[3] = -12.3;
    const back = decodeDemBinary(encodeDemBinary(grid));
    expect(back.cols).toBe(grid.cols);
    expect(back.rows).toBe(grid.rows);
    expect(back.cellSize).toBe(grid.cellSize);
    expect(back.worldSize).toBe(1000);
    expect(back.data[0]).toBeCloseTo(42.5, 1);
    expect(back.data[3]).toBeCloseTo(-12.3, 1);
  });

  it("rejects a truncated buffer", () => {
    expect(() => decodeDemBinary(new Uint8Array(8))).toThrow(/too small/);
  });
});

describe("sampleDem", () => {
  it("bilinearly interpolates between cells", () => {
    const grid = makeFlatDem(100, 0, 50);
    grid.data[0] = 0;
    grid.data[1] = 10;
    grid.data[grid.cols] = 20;
    grid.data[grid.cols + 1] = 30;
    expect(sampleDem(grid, 0, 0)).toBeCloseTo(0);
    expect(sampleDem(grid, 50, 0)).toBeCloseTo(10);
    expect(sampleDem(grid, 25, 0)).toBeCloseTo(5);
  });
});

describe("worldHasElevation", () => {
  it("requires a tile URL or world name, and a world size", () => {
    expect(worldHasElevation({ tileBaseUrl: "/maps/altis", worldSize: 30720 })).toBe(true);
    expect(worldHasElevation({ worldName: "brf_sumava", worldSize: 12288 })).toBe(true);
    expect(worldHasElevation({ worldSize: 30720 })).toBe(false);
    expect(worldHasElevation({ tileBaseUrl: "/maps/altis", worldSize: 0 })).toBe(false);
  });

  it("is false when the map has neither a DEM nor a heightmap", () => {
    expect(
      worldHasElevation({
        tileBaseUrl: "/maps/altis",
        worldSize: 30720,
        hasDem: false,
        hasHeightmap: false,
      }),
    ).toBe(false);
  });

  it("still tries a local DEM when the CDN map has no elevation", () => {
    expect(
      worldHasElevation({
        worldName: "brf_sumava",
        worldSize: 12288,
        tileBaseUrl: "https://maps.ocap2.com/brf_sumava",
        hasDem: false,
        hasHeightmap: false,
      }),
    ).toBe(true);
  });
});

describe("nearestOnDem", () => {
  it("clamps off-map positions onto the DEM rectangle", () => {
    const grid = makeFlatDem(1000, 0, 100);
    expect(nearestOnDem(grid, 400, 400)).toEqual([400, 400]);
    expect(nearestOnDem(grid, 400, -900)).toEqual([400, 0]);
    expect(nearestOnDem(grid, 2000, 2000)).toEqual([1000, 1000]);
  });

  it("records the shift from an off-map radio back onto the edge", () => {
    const grid = makeFlatDem(12288, 200, 48);
    const projected = projectCoverageOrigin(grid, [8492, -904, 221]);
    expect(projected.x).toBeCloseTo(8492);
    expect(projected.y).toBe(0);
    expect(projected.shiftY).toBeCloseTo(-904);
    expect(projected.offDem).toBe(true);
  });
});
