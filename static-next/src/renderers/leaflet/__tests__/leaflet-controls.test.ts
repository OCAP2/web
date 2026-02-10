import { describe, it, expect } from "vitest";
import L from "leaflet";
import {
  createScaleControl,
  createLayerControl,
  createBasemapControl,
  createMaplibreStyleControl,
} from "../leaflet-controls";

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

// ------------------------------------------------------------------
// Basemap control — smoke tests
// ------------------------------------------------------------------

describe("createBasemapControl", () => {
  it("returns a control positioned at bottomright", () => {
    const layers = [
      L.tileLayer("https://example.com/{z}/{x}/{y}.png", { label: "Topo" } as any),
      L.tileLayer("https://example.com/dark/{z}/{x}/{y}.png", { label: "Dark" } as any),
    ];
    const control = createBasemapControl(layers);
    expect(control).toBeDefined();
    expect(control.getPosition()).toBe("bottomright");
    expect(typeof control.onAdd).toBe("function");
  });

  it("creates container with basemaps class", () => {
    const layers = [
      L.tileLayer("https://example.com/{z}/{x}/{y}.png"),
      L.tileLayer("https://example.com/dark/{z}/{x}/{y}.png"),
    ];
    const control = createBasemapControl(layers);
    // Create a minimal map for onAdd
    const div = document.createElement("div");
    document.body.appendChild(div);
    const map = L.map(div, { center: [0, 0], zoom: 1 });
    const container = control.onAdd!(map);
    expect(container.classList.contains("basemaps")).toBe(true);
    expect(container.classList.contains("closed")).toBe(true);
    // First layer should be added to map and marked active
    expect(container.querySelector(".basemap.active")).not.toBeNull();
    // Second layer should be marked alt
    expect(container.querySelector(".basemap.alt")).not.toBeNull();
    map.remove();
    document.body.removeChild(div);
  });
});

// ------------------------------------------------------------------
// MapLibre style control — smoke tests
// ------------------------------------------------------------------

describe("createMaplibreStyleControl", () => {
  it("returns a control positioned at bottomright", () => {
    const candidates = [
      { label: "Topo", url: "https://example.com/topo.json" },
      { label: "Dark", url: "https://example.com/dark.json" },
    ];
    const control = createMaplibreStyleControl({}, candidates);
    expect(control).toBeDefined();
    expect(control.getPosition()).toBe("bottomright");
    expect(typeof control.onAdd).toBe("function");
  });

  it("creates container with maplibre-styles class", () => {
    const candidates = [
      { label: "Topo", url: "https://example.com/topo.json" },
    ];
    const control = createMaplibreStyleControl({}, candidates);
    const div = document.createElement("div");
    document.body.appendChild(div);
    const map = L.map(div, { center: [0, 0], zoom: 1 });
    const container = control.onAdd!(map);
    expect(container.classList.contains("maplibre-styles")).toBe(true);
    expect(container.classList.contains("closed")).toBe(true);
    // Should be hidden initially (until probing completes)
    expect(container.style.display).toBe("none");
    map.remove();
    document.body.removeChild(div);
  });
});
