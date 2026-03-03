import { describe, it, expect, vi } from "vitest";
import { MockRenderer } from "../mockRenderer";
import type { MapRenderer } from "../renderer.interface";

describe("MapRenderer interface", () => {
  it("MockRenderer implements MapRenderer", () => {
    // The primary test is that this compiles without error.
    const renderer: MapRenderer = new MockRenderer();
    expect(renderer).toBeDefined();
  });

  it("createEntityMarker returns a handle", () => {
    const renderer = new MockRenderer();
    const handle = renderer.createEntityMarker(1, {
      position: [0, 0],
      direction: 0,
      iconType: "man",
      side: "WEST",
      name: "Player1",
      isPlayer: true,
    });
    expect(handle).toBeDefined();
    expect(handle._internal).toBeDefined();
  });

  it("createBriefingMarker returns a handle", () => {
    const renderer = new MockRenderer();
    const handle = renderer.createBriefingMarker({
      shape: "ICON",
      type: "mil_dot",
      color: "#FF0000",
      text: "Alpha",
      side: "WEST",
    });
    expect(handle).toBeDefined();
    expect(handle._internal).toBeDefined();
  });

  it("addLine returns a handle", () => {
    const renderer = new MockRenderer();
    const handle = renderer.addLine([0, 0], [100, 100], {
      color: "#FF0000",
      weight: 2,
      opacity: 0.8,
    });
    expect(handle).toBeDefined();
    expect(handle._internal).toBeDefined();
  });


  it("each handle has a unique _internal value", () => {
    const renderer = new MockRenderer();
    const h1 = renderer.createEntityMarker(1, {
      position: [0, 0],
      direction: 0,
      iconType: "man",
      side: "WEST",
      name: "A",
      isPlayer: false,
    });
    const h2 = renderer.createEntityMarker(2, {
      position: [100, 100],
      direction: 0,
      iconType: "car",
      side: "EAST",
      name: "B",
      isPlayer: false,
    });
    expect(h1._internal).not.toBe(h2._internal);
  });

  it("events can be registered and unregistered", () => {
    const renderer = new MockRenderer();
    const cb = vi.fn();

    renderer.on("zoom", cb);
    expect(renderer.listenerCount("zoom")).toBe(1);

    renderer.off("zoom", cb);
    expect(renderer.listenerCount("zoom")).toBe(0);
  });

  it("multiple listeners for different events", () => {
    const renderer = new MockRenderer();
    const cb1 = vi.fn();
    const cb2 = vi.fn();

    renderer.on("zoom", cb1);
    renderer.on("click", cb2);
    expect(renderer.listenerCount("zoom")).toBe(1);
    expect(renderer.listenerCount("click")).toBe(1);

    renderer.on("zoom", cb2);
    expect(renderer.listenerCount("zoom")).toBe(2);
  });

  it("dispose clears all listeners", () => {
    const renderer = new MockRenderer();
    renderer.on("zoom", vi.fn());
    renderer.on("click", vi.fn());
    renderer.on("dragstart", vi.fn());

    renderer.dispose();

    expect(renderer.listenerCount("zoom")).toBe(0);
    expect(renderer.listenerCount("click")).toBe(0);
    expect(renderer.listenerCount("dragstart")).toBe(0);
  });

  it("getZoom returns a number", () => {
    const renderer = new MockRenderer();
    expect(typeof renderer.getZoom()).toBe("number");
  });

  it("getCenter returns an ArmaCoord", () => {
    const renderer = new MockRenderer();
    const center = renderer.getCenter();
    expect(center).toEqual([0, 0]);
    expect(center).toHaveLength(2);
  });

  it("getControls returns an object", () => {
    const renderer = new MockRenderer();
    const controls = renderer.getControls();
    expect(controls).toBeDefined();
    expect(typeof controls).toBe("object");
  });
});
