import { describe, it, expect } from "vitest";
import L from "leaflet";
import { METERS_PER_DEGREE } from "../../../utils/coordinates";
import { closestEquivalentAngle } from "../../../utils/math";
import {
  armaToLatLngMapLibre,
  latLngToArmaMapLibre,
} from "../leafletRenderer";
import { sideStyle } from "../leafletIcons";
import type { MapRenderer } from "../../renderer.interface";
import type { LeafletRenderer } from "../leafletRenderer";

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
