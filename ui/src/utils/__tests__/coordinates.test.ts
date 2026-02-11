import { describe, it, expect } from "vitest";
import { METERS_PER_DEGREE } from "../coordinates";
import type { ArmaCoord, ArmaCoord3D } from "../coordinates";

describe("coordinates", () => {
  it("METERS_PER_DEGREE is 111320", () => {
    expect(METERS_PER_DEGREE).toBe(111320);
  });

  it("ArmaCoord type compiles as [number, number]", () => {
    const coord: ArmaCoord = [100, 200];
    expect(coord).toEqual([100, 200]);
  });

  it("ArmaCoord3D type compiles as [number, number, number]", () => {
    const coord: ArmaCoord3D = [100, 200, 50];
    expect(coord).toEqual([100, 200, 50]);
  });
});
