import { describe, it, expect, beforeEach, afterEach } from "vitest";
import L from "leaflet";
import { createScaleControl } from "../leafletControls";
import { LeafletRenderer, latLngToArmaMapLibre } from "../leafletRenderer";
import { METERS_PER_DEGREE } from "../../../utils/coordinates";
import {
  armaMetersBetween,
  formatScaleLabel,
  niceScaleDistance,
  scaleBarWidthPx,
} from "../scaleBar";

describe("createScaleControl", () => {
  it("returns a scale control object", () => {
    const control = createScaleControl((ll) => [ll.lng, ll.lat]);
    expect(control).toBeDefined();
    expect(typeof control.onAdd).toBe("function");
  });

  it("is positioned at bottomleft", () => {
    const control = createScaleControl((ll) => [ll.lng, ll.lat]);
    expect(control.getPosition()).toBe("bottomleft");
  });
});

describe("OcapScaleControl on a map", () => {
  let container: HTMLDivElement;
  let map: L.Map;

  beforeEach(() => {
    container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", { value: 400, configurable: true });
    Object.defineProperty(container, "clientHeight", { value: 400, configurable: true });
    document.body.appendChild(container);
    map = L.map(container, {
      crs: L.CRS.Simple,
      center: [0, 0],
      zoom: 0,
      attributionControl: false,
      zoomControl: false,
    });
    map.invalidateSize();
  });

  afterEach(() => {
    map.remove();
    container.remove();
  });

  function scaleLabel(): string {
    return (
      container.querySelector(".leaflet-control-scale-line")?.textContent ?? ""
    );
  }

  it("labels a sub-metre span in centimetres instead of sticking at 1 m", () => {
    // 100 px of the scale bar equals 40 cm of world — Leaflet would say "1 m".
    createScaleControl((ll) => [ll.lng * 0.004, ll.lat * 0.004]).addTo(map);
    map.fire("move");
    expect(scaleLabel()).toMatch(/cm$/);
    expect(scaleLabel()).not.toBe("1 m");
  });

  it("labels a multi-kilometre span in km", () => {
    createScaleControl((ll) => [ll.lng * 200, ll.lat * 200]).addTo(map);
    map.fire("move");
    expect(scaleLabel()).toMatch(/km$/);
  });
});

describe("scale bar uses Arma metres in legacy CRS", () => {
  let container: HTMLDivElement;
  let renderer: LeafletRenderer;

  const WORLD = {
    worldName: "test",
    worldSize: 10000,
    imageSize: 10000,
    maxZoom: 4,
    minZoom: 0,
    multiplier: 1,
    tileBaseUrl: "",
  };

  beforeEach(() => {
    container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", { value: 400, configurable: true });
    Object.defineProperty(container, "clientHeight", { value: 400, configurable: true });
    document.body.appendChild(container);
    renderer = new LeafletRenderer();
    renderer.init(container, WORLD as any);
    const map = (renderer as any).map as L.Map;
    map.invalidateSize();
    map.fire("move");
  });

  afterEach(() => {
    renderer.dispose();
    container.remove();
  });

  function scaleLabel(): string {
    return (
      container.querySelector(".leaflet-control-scale-line")?.textContent ?? ""
    );
  }

  it("shows metres at native tile zoom, not a 2^maxZoom-scaled fraction", () => {
    // Native zoom = 4, 1 px = 1 m, 100 px ≈ 100 m → "100 m".
    // Leaflet Control.Scale would report ~100 / 2^4 = 6 m.
    const map = (renderer as any).map as L.Map;
    map.setZoom(4, { animate: false });
    expect(scaleLabel()).toBe("100 m");
  });

  it("still changes the label after zooming past 1 m of world", () => {
    const map = (renderer as any).map as L.Map;
    // maxZoom is native+4 = 8; 1 m = 16 px, 100 px ≈ 6.25 m → "5 m".
    map.setZoom(8, { animate: false });
    expect(scaleLabel()).toBe("5 m");
  });

  it("matches 1 px = 1 m at native zoom for every zoom 0..8", () => {
    const map = (renderer as any).map as L.Map;
    const expected: Record<number, string> = {
      0: "1 km",
      1: "500 m",
      2: "200 m",
      3: "200 m",
      4: "100 m",
      5: "50 m",
      6: "20 m",
      7: "10 m",
      8: "5 m",
    };
    for (const zoom of Object.keys(expected).map(Number)) {
      map.setZoom(zoom, { animate: false });
      const y = map.getSize().y / 2;
      const from = map.containerPointToLatLng([0, y]);
      const to = map.containerPointToLatLng([100, y]);
      const span = armaMetersBetween(
        (renderer as any).latLngToArma(from),
        (renderer as any).latLngToArma(to),
      );
      // 100 px / 2^(zoom - 4) metres when multiplier = 1.
      expect(span, `zoom ${zoom} span`).toBeCloseTo(100 / 2 ** (zoom - 4), 6);
      expect(scaleLabel(), `zoom ${zoom} label`).toBe(expected[zoom]);
      const line = container.querySelector(".leaflet-control-scale-line") as HTMLElement;
      expect(line.style.width).toBe(
        `${scaleBarWidthPx(niceScaleDistance(span), span)}px`,
      );
    }
  });

  it("Leaflet CRS.distance is 2^maxNativeZoom too small at native zoom", () => {
    const map = (renderer as any).map as L.Map;
    map.setZoom(4, { animate: false });
    const y = map.getSize().y / 2;
    const from = map.containerPointToLatLng([0, y]);
    const to = map.containerPointToLatLng([100, y]);
    const armaMeters = armaMetersBetween(
      (renderer as any).latLngToArma(from),
      (renderer as any).latLngToArma(to),
    );
    const leafletUnits = map.distance(from, to);
    expect(armaMeters).toBeCloseTo(100, 6);
    expect(leafletUnits).toBeCloseTo(100 / 2 ** 4, 6);
    expect(armaMeters / leafletUnits).toBeCloseTo(16, 6);
  });
});

describe("scale bar with a non-1 tile multiplier", () => {
  let container: HTMLDivElement;
  let renderer: LeafletRenderer;

  beforeEach(() => {
    container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", { value: 400, configurable: true });
    Object.defineProperty(container, "clientHeight", { value: 400, configurable: true });
    document.body.appendChild(container);
    renderer = new LeafletRenderer();
    renderer.init(container, {
      worldName: "test",
      worldSize: 10000,
      imageSize: 10000,
      maxZoom: 4,
      minZoom: 0,
      multiplier: 2,
      tileBaseUrl: "",
    } as any);
    const map = (renderer as any).map as L.Map;
    map.invalidateSize();
  });

  afterEach(() => {
    renderer.dispose();
    container.remove();
  });

  it("treats native zoom as 2 px per metre", () => {
    const map = (renderer as any).map as L.Map;
    map.setZoom(4, { animate: false });
    const y = map.getSize().y / 2;
    const from = map.containerPointToLatLng([0, y]);
    const to = map.containerPointToLatLng([100, y]);
    const span = armaMetersBetween(
      (renderer as any).latLngToArma(from),
      (renderer as any).latLngToArma(to),
    );
    expect(span).toBeCloseTo(50, 6);
    expect(
      container.querySelector(".leaflet-control-scale-line")?.textContent,
    ).toBe("50 m");
  });
});

describe("scale bar on EPSG:3857 (MapLibre mode conversion)", () => {
  let container: HTMLDivElement;
  let map: L.Map;

  beforeEach(() => {
    container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", { value: 400, configurable: true });
    Object.defineProperty(container, "clientHeight", { value: 400, configurable: true });
    document.body.appendChild(container);
    map = L.map(container, {
      crs: L.CRS.EPSG3857,
      center: [0, 0],
      zoom: 18,
      minZoom: 10,
      maxZoom: 22,
      attributionControl: false,
      zoomControl: false,
    });
    map.invalidateSize();
  });

  afterEach(() => {
    map.remove();
    container.remove();
  });

  it("labels 100 px at zoom 18 as 50 m of Arma world", () => {
    createScaleControl((ll) => latLngToArmaMapLibre(ll)).addTo(map);
    map.setView([0, 0], 18, { animate: false });
    const y = map.getSize().y / 2;
    const from = map.containerPointToLatLng([0, y]);
    const to = map.containerPointToLatLng([100, y]);
    const span = armaMetersBetween(latLngToArmaMapLibre(from), latLngToArmaMapLibre(to));
    const expected = 100 * (360 / (256 * 2 ** 18)) * METERS_PER_DEGREE;
    expect(span).toBeCloseTo(expected, 4);
    expect(span).toBeCloseTo(59.72, 1);
    expect(
      container.querySelector(".leaflet-control-scale-line")?.textContent,
    ).toBe(formatScaleLabel(niceScaleDistance(span)));
    expect(
      container.querySelector(".leaflet-control-scale-line")?.textContent,
    ).toBe("50 m");
  });

  it("drops from kilometres to metres as zoom increases, never sticking at 1 m", () => {
    createScaleControl((ll) => latLngToArmaMapLibre(ll)).addTo(map);
    const labels: string[] = [];
    for (const zoom of [12, 14, 16, 18, 20, 22]) {
      map.setView([0, 0], zoom, { animate: false });
      labels.push(
        container.querySelector(".leaflet-control-scale-line")?.textContent ?? "",
      );
    }
    expect(labels).toEqual(["2 km", "500 m", "200 m", "50 m", "10 m", "2 m"]);
  });
});
