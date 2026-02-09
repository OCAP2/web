import { describe, it, expect, beforeEach } from "vitest";
import {
  getTransitionDuration,
  enableSmoothing,
  disableSmoothing,
  setZooming,
} from "../leaflet-smoothing";

// --------------- getTransitionDuration ---------------

describe("getTransitionDuration", () => {
  it("returns 1.0 s for speed 1", () => {
    expect(getTransitionDuration(1)).toBe(1);
  });

  it("returns 0.9 s for speed 2", () => {
    expect(getTransitionDuration(2)).toBe(0.9);
  });

  it("returns 0.8 s for speed 3", () => {
    expect(getTransitionDuration(3)).toBe(0.8);
  });

  it("returns 0.7 s for speed 4", () => {
    expect(getTransitionDuration(4)).toBe(0.7);
  });

  it("returns 0.6 s for speed 5", () => {
    expect(getTransitionDuration(5)).toBe(0.6);
  });

  it("returns 0.5 s for speed 6", () => {
    expect(getTransitionDuration(6)).toBe(0.5);
  });

  it("returns 0.4 s for speed 7", () => {
    expect(getTransitionDuration(7)).toBe(0.4);
  });

  it("returns 0.3 s for speed 8", () => {
    expect(getTransitionDuration(8)).toBe(0.3);
  });

  it("returns 0.2 s for speed 9", () => {
    expect(getTransitionDuration(9)).toBe(0.2);
  });

  it("returns 0.15 s for speed 10", () => {
    expect(getTransitionDuration(10)).toBe(0.15);
  });

  it("returns 0.15 s for speed 20 (any speed >= 10)", () => {
    expect(getTransitionDuration(20)).toBe(0.15);
  });

  it("returns 1.0 s for speed 0 (below minimum)", () => {
    expect(getTransitionDuration(0)).toBe(1);
  });

  it("returns 1.0 s for negative speed", () => {
    expect(getTransitionDuration(-5)).toBe(1);
  });
});

// --------------- enableSmoothing ---------------

describe("enableSmoothing", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
  });

  it("adds marker-transition class", () => {
    enableSmoothing(container, 5);
    expect(container.classList.contains("marker-transition")).toBe(true);
  });

  it("adds speed-N class for the given speed", () => {
    enableSmoothing(container, 3);
    expect(container.classList.contains("speed-3")).toBe(true);
  });

  it("removes previous speed class when speed changes", () => {
    enableSmoothing(container, 3);
    expect(container.classList.contains("speed-3")).toBe(true);

    enableSmoothing(container, 7);
    expect(container.classList.contains("speed-3")).toBe(false);
    expect(container.classList.contains("speed-7")).toBe(true);
  });

  it("does not add a speed class for speed >= 10 (uses default CSS rule)", () => {
    enableSmoothing(container, 10);
    expect(container.classList.contains("marker-transition")).toBe(true);
    // No speed-10 class; the default .marker-transition rule covers 0.15s
    for (let i = 1; i <= 20; i++) {
      expect(container.classList.contains(`speed-${i}`)).toBe(false);
    }
  });

  it("clamps fractional speeds to the floored integer", () => {
    enableSmoothing(container, 3.7);
    expect(container.classList.contains("speed-3")).toBe(true);
  });

  it("clamps speed below 1 to speed-1", () => {
    enableSmoothing(container, 0.5);
    expect(container.classList.contains("speed-1")).toBe(true);
  });
});

// --------------- disableSmoothing ---------------

describe("disableSmoothing", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
  });

  it("removes marker-transition class", () => {
    container.classList.add("marker-transition");
    disableSmoothing(container);
    expect(container.classList.contains("marker-transition")).toBe(false);
  });

  it("removes speed-N classes", () => {
    container.classList.add("marker-transition", "speed-5");
    disableSmoothing(container);
    expect(container.classList.contains("speed-5")).toBe(false);
  });

  it("is safe to call when no classes are present", () => {
    expect(() => disableSmoothing(container)).not.toThrow();
    expect(container.classList.length).toBe(0);
  });
});

// --------------- setZooming ---------------

describe("setZooming", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
  });

  it("adds zooming class when true", () => {
    setZooming(container, true);
    expect(container.classList.contains("zooming")).toBe(true);
  });

  it("removes zooming class when false", () => {
    container.classList.add("zooming");
    setZooming(container, false);
    expect(container.classList.contains("zooming")).toBe(false);
  });

  it("is idempotent when adding", () => {
    setZooming(container, true);
    setZooming(container, true);
    expect(container.classList.contains("zooming")).toBe(true);
  });

  it("is idempotent when removing", () => {
    setZooming(container, false);
    setZooming(container, false);
    expect(container.classList.contains("zooming")).toBe(false);
  });
});
