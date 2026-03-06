import { describe, it, expect, beforeEach, afterEach } from "vitest";
import L from "leaflet";
import { METERS_PER_DEGREE } from "../../../utils/coordinates";
import { closestEquivalentAngle } from "../../../utils/math";
import {
  armaToLatLngMapLibre,
  latLngToArmaMapLibre,
  LeafletRenderer,
} from "../leafletRenderer";
import { sideStyle } from "../leafletIcons";
import type { MapRenderer } from "../../renderer.interface";
import { createSignal } from "solid-js";

// ------------------------------------------------------------------
// Coordinate conversion (MapLibre / EPSG:3857 mode) — pure functions
// ------------------------------------------------------------------

describe("armaToLatLngMapLibre", () => {
  it("converts [0, 0] to LatLng(0, 0)", () => {
    const ll = armaToLatLngMapLibre([0, 0]);
    expect(ll.lat).toBeCloseTo(0);
    expect(ll.lng).toBeCloseTo(0);
  });

  it("converts Arma meters to degrees at the equator", () => {
    const ll = armaToLatLngMapLibre([METERS_PER_DEGREE, METERS_PER_DEGREE]);
    expect(ll.lat).toBeCloseTo(1, 5);
    expect(ll.lng).toBeCloseTo(1, 5);
  });

  it("maps Arma X to longitude and Arma Y to latitude", () => {
    const ll = armaToLatLngMapLibre([5000, 10000]);
    expect(ll.lat).toBeCloseTo(10000 / METERS_PER_DEGREE, 8);
    expect(ll.lng).toBeCloseTo(5000 / METERS_PER_DEGREE, 8);
  });

  it("handles typical Altis coordinates (~30km world)", () => {
    // Altis worldSize = 30720
    const center: [number, number] = [15360, 15360];
    const ll = armaToLatLngMapLibre(center);
    // Should be near ~0.138 degrees
    expect(ll.lat).toBeCloseTo(15360 / METERS_PER_DEGREE, 6);
    expect(ll.lng).toBeCloseTo(15360 / METERS_PER_DEGREE, 6);
  });
});

describe("latLngToArmaMapLibre", () => {
  it("converts LatLng(0, 0) to [0, 0]", () => {
    const coord = latLngToArmaMapLibre(L.latLng(0, 0));
    expect(coord[0]).toBeCloseTo(0);
    expect(coord[1]).toBeCloseTo(0);
  });

  it("round-trips through armaToLatLng and back", () => {
    const original: [number, number] = [12345, 67890];
    const ll = armaToLatLngMapLibre(original);
    const result = latLngToArmaMapLibre(ll);
    expect(result[0]).toBeCloseTo(original[0], 4);
    expect(result[1]).toBeCloseTo(original[1], 4);
  });

  it("round-trips zero coordinates", () => {
    const ll = armaToLatLngMapLibre([0, 0]);
    const result = latLngToArmaMapLibre(ll);
    expect(result[0]).toBeCloseTo(0);
    expect(result[1]).toBeCloseTo(0);
  });

  it("correctly maps lat to Arma Y and lng to Arma X", () => {
    const latDeg = 0.1;
    const lngDeg = 0.05;
    const coord = latLngToArmaMapLibre(L.latLng(latDeg, lngDeg));
    expect(coord[0]).toBeCloseTo(lngDeg * METERS_PER_DEGREE, 4);
    expect(coord[1]).toBeCloseTo(latDeg * METERS_PER_DEGREE, 4);
  });
});

// ------------------------------------------------------------------
// closestEquivalentAngle integration
// ------------------------------------------------------------------

describe("closestEquivalentAngle for marker rotation", () => {
  it("chooses shortest rotation path across 360 boundary", () => {
    expect(closestEquivalentAngle(350, 10)).toBeCloseTo(370);
    expect(closestEquivalentAngle(10, 350)).toBeCloseTo(-10);
  });

  it("returns same angle when no rotation needed", () => {
    expect(closestEquivalentAngle(90, 90)).toBeCloseTo(90);
  });

  it("handles half-circle rotation", () => {
    // 180 and -180 are equivalent rotations; the function returns -180
    // which is equally valid (both are 180 degrees from 0)
    const result = closestEquivalentAngle(0, 180);
    expect(Math.abs(result)).toBeCloseTo(180);
  });

  it("handles negative angles", () => {
    const result = closestEquivalentAngle(-10, 350);
    // -10 and 350 are equivalent, delta should be 0
    expect(result).toBeCloseTo(-10);
  });
});

// ------------------------------------------------------------------
// Side styles
// ------------------------------------------------------------------

describe("sideStyle", () => {
  it("returns blufor for WEST", () => {
    expect(sideStyle("WEST")).toEqual({ cssClass: "blufor", colour: "#004d99" });
  });

  it("returns opfor for EAST", () => {
    expect(sideStyle("EAST")).toEqual({ cssClass: "opfor", colour: "#800000" });
  });

  it("returns ind for GUER", () => {
    expect(sideStyle("GUER")).toEqual({ cssClass: "ind", colour: "#007f00" });
  });

  it("returns civ for CIV", () => {
    expect(sideStyle("CIV")).toEqual({ cssClass: "civ", colour: "#650080" });
  });
});

// ------------------------------------------------------------------
// setMarkerDisplayMode — text label visibility (sector markers)
// ------------------------------------------------------------------

describe("setMarkerDisplayMode", () => {
  let map: L.Map;
  let group: L.LayerGroup;
  let renderer: any;
  let container: HTMLElement;

  function createTextLabel(text: string): L.Marker {
    return L.marker([0, 0], {
      icon: L.divIcon({
        className: "marker-text-label",
        html: `<span>${text}</span>`,
        iconSize: [0, 0],
        iconAnchor: [-30, 0],
      }),
      interactive: false,
    });
  }

  function createIconMarkerWithPopup(text: string): L.Marker {
    const m = L.marker([0, 0], { interactive: false });
    const popup = L.popup({ autoPan: false, autoClose: false, closeButton: false });
    popup.setContent(text);
    m.bindPopup(popup);
    return m;
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    map = L.map(container, { crs: L.CRS.Simple, center: [0, 0], zoom: 1 });
    group = L.layerGroup().addTo(map);

    // Build a minimal renderer shape with just the fields setMarkerDisplayMode needs
    const [mdm, setMdm] = createSignal<"all" | "noLabels" | "none">("all");

    renderer = Object.create(LeafletRenderer.prototype);
    renderer._markerDisplayMode = mdm;
    renderer._setMarkerDisplayMode = setMdm;
    renderer.map = map;
    renderer.layers = { briefingMarkers: group };
  });

  afterEach(() => {
    map.remove();
    container.remove();
  });

  it("hides text labels when switching to noLabels", () => {
    const label = createTextLabel("Sector Alpha");
    label.addTo(group);

    renderer.setMarkerDisplayMode("noLabels");

    const el = label.getElement();
    expect(el).toBeTruthy();
    expect(el!.style.display).toBe("none");
  });

  it("shows text labels when switching back to all", () => {
    const label = createTextLabel("Sector Alpha");
    label.addTo(group);

    renderer.setMarkerDisplayMode("noLabels");
    expect(label.getElement()!.style.display).toBe("none");

    renderer.setMarkerDisplayMode("all");
    expect(label.getElement()!.style.display).toBe("");
  });

  it("does not hide ICON markers with popups when switching to noLabels", () => {
    const icon = createIconMarkerWithPopup("Player marker");
    icon.addTo(group);

    renderer.setMarkerDisplayMode("noLabels");

    const el = icon.getElement();
    expect(el).toBeTruthy();
    // Element should remain visible (display is not "none")
    expect(el!.style.display).not.toBe("none");
  });

  it("removes briefingMarkers layer group from map in none mode", () => {
    const label = createTextLabel("Sector Bravo");
    label.addTo(group);

    renderer.setMarkerDisplayMode("none");

    expect(map.hasLayer(group)).toBe(false);
  });

  it("restores layer group and text label visibility when switching from none to all", () => {
    const label = createTextLabel("Sector Charlie");
    label.addTo(group);

    renderer.setMarkerDisplayMode("none");
    expect(map.hasLayer(group)).toBe(false);

    renderer.setMarkerDisplayMode("all");
    expect(map.hasLayer(group)).toBe(true);
    // Text label should be visible
    const el = label.getElement();
    expect(el).toBeTruthy();
    expect(el!.style.display).not.toBe("none");
  });

  it("hides text labels when switching from none to noLabels", () => {
    const label = createTextLabel("Sector Delta");
    label.addTo(group);

    renderer.setMarkerDisplayMode("none");
    renderer.setMarkerDisplayMode("noLabels");

    expect(map.hasLayer(group)).toBe(true);
    const el = label.getElement();
    expect(el).toBeTruthy();
    expect(el!.style.display).toBe("none");
  });

  it("handles mixed text labels and icon markers correctly", () => {
    const label1 = createTextLabel("Sector Echo");
    const label2 = createTextLabel("Sector Foxtrot");
    const icon = createIconMarkerWithPopup("Blufor HQ");
    label1.addTo(group);
    label2.addTo(group);
    icon.addTo(group);

    renderer.setMarkerDisplayMode("noLabels");

    // Text labels hidden
    expect(label1.getElement()!.style.display).toBe("none");
    expect(label2.getElement()!.style.display).toBe("none");
    // Icon marker still visible
    expect(icon.getElement()!.style.display).not.toBe("none");

    renderer.setMarkerDisplayMode("all");

    // Text labels restored
    expect(label1.getElement()!.style.display).toBe("");
    expect(label2.getElement()!.style.display).toBe("");
  });
});

// ------------------------------------------------------------------
// Type-level: LeafletRenderer satisfies MapRenderer
// ------------------------------------------------------------------

describe("LeafletRenderer type check", () => {
  it("satisfies the MapRenderer interface at the type level", () => {
    // This block purely checks that LeafletRenderer assignable to MapRenderer compiles.
    // If LeafletRenderer is missing any method, TypeScript will error here.
    const check: MapRenderer extends MapRenderer ? true : false = true;
    expect(check).toBe(true);

    // We can also verify the concrete type. This line only compiles if
    // LeafletRenderer implements MapRenderer:
    type Check = LeafletRenderer extends MapRenderer ? "ok" : "fail";
    const result: Check = "ok";
    expect(result).toBe("ok");
  });
});
