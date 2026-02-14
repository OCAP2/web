import { describe, it, expect } from "vitest";
import { METERS_PER_DEGREE } from "../coordinates";
import type { ArmaCoord } from "../coordinates";

describe("coordinates", () => {
  it("METERS_PER_DEGREE is 111320", () => {
    expect(METERS_PER_DEGREE).toBe(111320);
  });

  it("ArmaCoord type compiles as [number, number]", () => {
    const coord: ArmaCoord = [100, 200];
    expect(coord).toEqual([100, 200]);
  });

  it("ArmaCoord type accepts [number, number, number] with elevation", () => {
    const coord: ArmaCoord = [100, 200, 50];
    expect(coord).toEqual([100, 200, 50]);
  });
});
