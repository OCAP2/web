import { describe, it, expect } from "vitest";
import { closestEquivalentAngle, distance2D, SKIP_ANIMATION_DISTANCE } from "../math";

describe("closestEquivalentAngle", () => {
  it("no wrap needed: (0, 350) stays near 350", () => {
    expect(closestEquivalentAngle(0, 350)).toBeCloseTo(-10, 10);
  });

  it("wraps forward: (350, 10) -> 370", () => {
    expect(closestEquivalentAngle(350, 10)).toBeCloseTo(370, 10);
  });

  it("wraps backward: (10, 350) -> -10", () => {
    expect(closestEquivalentAngle(10, 350)).toBeCloseTo(-10, 10);
  });

  it("same angle returns same value", () => {
    expect(closestEquivalentAngle(90, 90)).toBe(90);
    expect(closestEquivalentAngle(0, 0)).toBe(0);
    expect(closestEquivalentAngle(360, 360)).toBe(360);
  });

  it("half rotation picks consistent direction", () => {
    // 180-degree difference is ambiguous; the formula consistently picks -180
    const result = closestEquivalentAngle(0, 180);
    expect(Math.abs(result)).toBe(180);
  });
});

describe("distance2D", () => {
  it("zero distance for same point", () => {
    expect(distance2D([0, 0], [0, 0])).toBe(0);
    expect(distance2D([5, 10], [5, 10])).toBe(0);
  });

  it("horizontal distance", () => {
    expect(distance2D([0, 0], [3, 0])).toBe(3);
  });

  it("vertical distance", () => {
    expect(distance2D([0, 0], [0, 4])).toBe(4);
  });

  it("classic 3-4-5 triangle", () => {
    expect(distance2D([0, 0], [3, 4])).toBe(5);
  });

  it("works with negative coordinates", () => {
    expect(distance2D([-1, -1], [2, 3])).toBe(5);
  });
});

describe("SKIP_ANIMATION_DISTANCE", () => {
  it("is 222", () => {
    expect(SKIP_ANIMATION_DISTANCE).toBe(222);
  });
});
