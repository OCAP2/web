import { describe, it, expect } from "vitest";
import { createScaleControl } from "../leaflet-controls";

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
