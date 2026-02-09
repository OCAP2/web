import { describe, it, expect } from "vitest";
import {
  createZoomInfoControl,
  createScaleControl,
  createLayerControl,
} from "../leaflet-controls";

// ------------------------------------------------------------------
// ZoomInfo control — smoke tests
// ------------------------------------------------------------------

describe("createZoomInfoControl", () => {
  it("returns a control object", () => {
    const control = createZoomInfoControl();
    expect(control).toBeDefined();
    expect(typeof control.onAdd).toBe("function");
    expect(typeof control.onRemove).toBe("function");
  });

  it("accepts custom position option", () => {
    const control = createZoomInfoControl({ position: "topright" });
    expect(control).toBeDefined();
    expect(control.getPosition()).toBe("topright");
  });

  it("defaults to topleft position", () => {
    const control = createZoomInfoControl();
    expect(control.getPosition()).toBe("topleft");
  });
});

// ------------------------------------------------------------------
// Scale control — smoke tests
// ------------------------------------------------------------------

describe("createScaleControl", () => {
  it("returns a scale control object", () => {
    const control = createScaleControl();
    expect(control).toBeDefined();
    expect(typeof control.onAdd).toBe("function");
  });

  it("is positioned at bottomleft", () => {
    const control = createScaleControl();
    expect(control.getPosition()).toBe("bottomleft");
  });
});

// ------------------------------------------------------------------
// Layer control — smoke tests
// ------------------------------------------------------------------

describe("createLayerControl", () => {
  it("returns a layer control object", () => {
    const control = createLayerControl({}, {});
    expect(control).toBeDefined();
    expect(typeof control.onAdd).toBe("function");
  });

  it("is positioned at topright", () => {
    const control = createLayerControl({}, {});
    expect(control.getPosition()).toBe("topright");
  });
});
