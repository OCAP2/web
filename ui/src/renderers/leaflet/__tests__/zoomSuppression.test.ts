import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import L from "leaflet";
import { LeafletRenderer } from "../leafletRenderer";
import type { BriefingMarkerHandle } from "../../renderer.types";

/**
 * Tests that briefing marker shapes (ELLIPSE, RECTANGLE, POLYLINE) use
 * an SVG renderer so they are rendered as vector paths rather than bitmap-
 * scaled canvas pixels during zoom animation.
 */

const WORLD_CONFIG = {
  worldName: "test",
  worldSize: 10000,
  imageSize: 10000,
  maxZoom: 4,
  minZoom: 0,
  multiplier: 1,
  tileBaseUrl: "",
};

describe("briefing marker SVG renderer", () => {
  let container: HTMLDivElement;
  let renderer: LeafletRenderer;

  beforeEach(() => {
    container = document.createElement("div");
    container.style.width = "400px";
    container.style.height = "400px";
    document.body.appendChild(container);

    renderer = new LeafletRenderer();
    renderer.init(container, WORLD_CONFIG as any);
  });

  afterEach(() => {
    renderer.dispose();
    document.body.removeChild(container);
  });

  function getInternal(handle: BriefingMarkerHandle): any {
    return (handle as any)._internal;
  }

  function getInternalLayer(handle: BriefingMarkerHandle): L.Layer {
    return getInternal(handle).layer;
  }

  it("creates ELLIPSE polygons with the SVG renderer", () => {
    const handle = renderer.createBriefingMarker({
      shape: "ELLIPSE",
      type: "mil_circle",
      color: "FF0000",
      side: "WEST",
      size: [100, 100],
    });

    const polygon = getInternalLayer(handle) as any;
    const svgRenderer = (renderer as any).svgRenderer;
    expect(polygon.options.renderer).toBe(svgRenderer);
  });

  it("creates RECTANGLE polygons with the SVG renderer", () => {
    const handle = renderer.createBriefingMarker({
      shape: "RECTANGLE",
      type: "mil_rectangle",
      color: "0000FF",
      side: "EAST",
      size: [200, 150],
    });

    const polygon = getInternalLayer(handle) as any;
    const svgRenderer = (renderer as any).svgRenderer;
    expect(polygon.options.renderer).toBe(svgRenderer);
  });

  it("creates POLYLINE with the SVG renderer", () => {
    const handle = renderer.createBriefingMarker({
      shape: "POLYLINE",
      type: "line",
      color: "00FF00",
      side: "GLOBAL",
    });

    const polyline = getInternalLayer(handle) as any;
    const svgRenderer = (renderer as any).svgRenderer;
    expect(polyline.options.renderer).toBe(svgRenderer);
  });

  it("ICON markers use default renderer (not SVG)", () => {
    const handle = renderer.createBriefingMarker({
      shape: "ICON",
      type: "mil_dot",
      color: "FF0000",
      side: "WEST",
    });

    // L.Marker doesn't use vector renderers at all
    const marker = getInternalLayer(handle) as any;
    expect(marker.options.renderer).toBeUndefined();
  });

  it("pattern brushes set _fillPatternId on the polygon", () => {
    const brushes = ["horizontal", "vertical", "fdiagonal", "bdiagonal", "diaggrid", "grid", "cross"];
    for (const brush of brushes) {
      const handle = renderer.createBriefingMarker({
        shape: "ELLIPSE",
        type: "mil_circle",
        color: "FF0000",
        side: "WEST",
        size: [100, 100],
        brush,
      });

      const internal = getInternal(handle);
      const polygon = internal.layer as any;
      expect(polygon.options._fillPatternId).toBeTruthy();
      expect(internal.patternId).toBe(polygon.options._fillPatternId);
    }
  });

  it("solid brushes do NOT set _fillPatternId", () => {
    const brushes = ["solid", "solidfull", "border", "solidborder", undefined];
    for (const brush of brushes) {
      const handle = renderer.createBriefingMarker({
        shape: "ELLIPSE",
        type: "mil_circle",
        color: "FF0000",
        side: "WEST",
        size: [100, 100],
        brush,
      });

      const internal = getInternal(handle);
      const polygon = internal.layer as any;
      expect(polygon.options._fillPatternId).toBeFalsy();
      expect(internal.patternId).toBeUndefined();
    }
  });

  it("solid brush stores shapeOpts with fillOpacity 0.3", () => {
    const handle = renderer.createBriefingMarker({
      shape: "ELLIPSE", type: "mil_circle", color: "FF0000", side: "WEST",
      size: [100, 100], brush: "solid",
    });
    const internal = getInternal(handle);
    expect(internal.shapeOpts).toEqual({ stroke: false, fill: true, fillOpacity: 0.3 });
  });

  it("solidfull brush stores shapeOpts with fillOpacity 0.8", () => {
    const handle = renderer.createBriefingMarker({
      shape: "RECTANGLE", type: "mil_rectangle", color: "0000FF", side: "EAST",
      size: [200, 150], brush: "solidfull",
    });
    const internal = getInternal(handle);
    expect(internal.shapeOpts).toEqual({ stroke: false, fill: true, fillOpacity: 0.8 });
  });

  it("border brush stores shapeOpts with stroke and no fill", () => {
    const handle = renderer.createBriefingMarker({
      shape: "ELLIPSE", type: "mil_circle", color: "FF0000", side: "WEST",
      size: [100, 100], brush: "border",
    });
    const internal = getInternal(handle);
    expect(internal.shapeOpts).toEqual({ stroke: true, fill: false, fillOpacity: 0 });
  });

  it("solidborder brush stores shapeOpts with stroke and fill", () => {
    const handle = renderer.createBriefingMarker({
      shape: "ELLIPSE", type: "mil_circle", color: "FF0000", side: "WEST",
      size: [100, 100], brush: "solidborder",
    });
    const internal = getInternal(handle);
    expect(internal.shapeOpts).toEqual({ stroke: true, fill: true, fillOpacity: 0.3 });
  });

  it("pattern brushes also store shapeOpts", () => {
    const handle = renderer.createBriefingMarker({
      shape: "ELLIPSE", type: "mil_circle", color: "FF0000", side: "WEST",
      size: [100, 100], brush: "grid",
    });
    const internal = getInternal(handle);
    expect(internal.shapeOpts).toEqual({ stroke: false, fill: true, fillOpacity: 1.0 });
  });

  it("updateBriefingMarker applies per-brush opacity for solidfull", () => {
    const handle = renderer.createBriefingMarker({
      shape: "ELLIPSE", type: "mil_circle", color: "FF0000", side: "WEST",
      size: [100, 100], brush: "solidfull",
    });
    const polygon = getInternalLayer(handle) as L.Polygon;
    const setStyleSpy = vi.spyOn(polygon, "setStyle");

    renderer.updateBriefingMarker(handle, {
      position: [5000, 5000], direction: 0, alpha: 1,
    });

    // solidfull: fill=true, fillOpacity=0.8, stroke=false → opacity=0, fillOpacity=min(0.8, 1)=0.8
    const lastCall = setStyleSpy.mock.calls[setStyleSpy.mock.calls.length - 1][0] as any;
    expect(lastCall.fillOpacity).toBe(0.8);
    expect(lastCall.opacity).toBe(0);
  });

  it("updateBriefingMarker applies zero opacity for border brush", () => {
    const handle = renderer.createBriefingMarker({
      shape: "ELLIPSE", type: "mil_circle", color: "FF0000", side: "WEST",
      size: [100, 100], brush: "border",
    });
    const polygon = getInternalLayer(handle) as L.Polygon;
    const setStyleSpy = vi.spyOn(polygon, "setStyle");

    renderer.updateBriefingMarker(handle, {
      position: [5000, 5000], direction: 0, alpha: 1,
    });

    // border: fill=false, stroke=true → opacity=1, fillOpacity=0
    const lastCall = setStyleSpy.mock.calls[setStyleSpy.mock.calls.length - 1][0] as any;
    expect(lastCall.fillOpacity).toBe(0);
    expect(lastCall.opacity).toBe(1);
  });

  it("updateBriefingMarker sets both opacities to 0 when alpha is 0", () => {
    const handle = renderer.createBriefingMarker({
      shape: "ELLIPSE", type: "mil_circle", color: "FF0000", side: "WEST",
      size: [100, 100], brush: "solidborder",
    });
    const polygon = getInternalLayer(handle) as L.Polygon;
    const setStyleSpy = vi.spyOn(polygon, "setStyle");

    renderer.updateBriefingMarker(handle, {
      position: [5000, 5000], direction: 0, alpha: 0,
    });

    const lastCall = setStyleSpy.mock.calls[setStyleSpy.mock.calls.length - 1][0] as any;
    expect(lastCall.fillOpacity).toBe(0);
    expect(lastCall.opacity).toBe(0);
  });

  it("RECTANGLE rotates clockwise from north (matching Arma convention)", () => {
    // A narrow rectangle [5, 100] at direction=90° (east) should be
    // wider in X (lng) than in Y (lat). Before the fix, the rotation
    // was counter-clockwise, mirroring the shape.
    const handle = renderer.createBriefingMarker({
      shape: "RECTANGLE",
      type: "mil_dot",
      color: "008000",
      side: "GLOBAL",
      size: [5, 100],
      brush: "solidborder",
    });

    renderer.updateBriefingMarker(handle, {
      position: [5000, 5000],
      direction: 90,
      alpha: 1,
    });

    const polygon = getInternalLayer(handle) as L.Polygon;
    const latlngs = polygon.getLatLngs()[0] as L.LatLng[];
    expect(latlngs.length).toBe(4);

    const lngs = latlngs.map((ll) => ll.lng);
    const lats = latlngs.map((ll) => ll.lat);
    const lngSpan = Math.max(...lngs) - Math.min(...lngs);
    const latSpan = Math.max(...lats) - Math.min(...lats);

    // Long axis (100) along east-west → lngSpan >> latSpan
    expect(lngSpan).toBeGreaterThan(latSpan * 5);
  });

  it("RECTANGLE at direction=45 has long axis pointing NE", () => {
    const handle = renderer.createBriefingMarker({
      shape: "RECTANGLE",
      type: "mil_dot",
      color: "008000",
      side: "GLOBAL",
      size: [5, 100],
      brush: "solid",
    });

    renderer.updateBriefingMarker(handle, {
      position: [5000, 5000],
      direction: 45,
      alpha: 1,
    });

    const polygon = getInternalLayer(handle) as L.Polygon;
    const latlngs = polygon.getLatLngs()[0] as L.LatLng[];

    // Find the point furthest from center in the +lng direction (east).
    // For CW 45° from north, the top of the rectangle should be NE of
    // center — both higher lat AND higher lng.
    const centerLat = latlngs.reduce((s, ll) => s + ll.lat, 0) / 4;
    const centerLng = latlngs.reduce((s, ll) => s + ll.lng, 0) / 4;

    // The point with max lng should also have lat > center (NE quadrant)
    const eastmost = latlngs.reduce((a, b) => (b.lng > a.lng ? b : a));
    expect(eastmost.lng).toBeGreaterThan(centerLng);
    // In legacy mode higher Arma Y = higher lat, so NE = higher lat + higher lng
    expect(eastmost.lat).toBeGreaterThan(centerLat);
  });

  it("ELLIPSE rotates clockwise from north", () => {
    // An elongated ellipse [20, 100] at direction=90° should extend
    // more in X (lng) than Y (lat).
    const handle = renderer.createBriefingMarker({
      shape: "ELLIPSE",
      type: "mil_circle",
      color: "FF0000",
      side: "WEST",
      size: [20, 100],
    });

    renderer.updateBriefingMarker(handle, {
      position: [5000, 5000],
      direction: 90,
      alpha: 1,
    });

    const polygon = getInternalLayer(handle) as L.Polygon;
    const latlngs = polygon.getLatLngs()[0] as L.LatLng[];

    const lngs = latlngs.map((ll) => ll.lng);
    const lats = latlngs.map((ll) => ll.lat);
    const lngSpan = Math.max(...lngs) - Math.min(...lngs);
    const latSpan = Math.max(...lats) - Math.min(...lats);

    // Long axis (100) along east-west → lngSpan >> latSpan
    expect(lngSpan).toBeGreaterThan(latSpan * 3);
  });

  it("hides entity popups when zoomed out below threshold", () => {
    const handle = renderer.createEntityMarker(1, {
      position: [5000, 5000],
      direction: 0,
      iconType: "man",
      side: "WEST",
      name: "Rifleman",
      isPlayer: true,
    });

    const map = (renderer as any).map as L.Map;
    const marker = (handle as any)._internal.marker as L.Marker;
    const popup = marker.getPopup()!;

    // Zoom above threshold first (>4 for legacy) — popup should be visible
    map.setZoom(5, { animate: false });
    renderer.updateEntityMarker(handle, {
      position: [5000, 5000], direction: 0, alive: 1, side: "WEST",
      name: "Rifleman", iconType: "man", isPlayer: true, isInVehicle: false,
    });
    expect((renderer as any).hideMarkerPopups).toBe(false);
    expect(popup.getElement()?.style.display).not.toBe("none");

    // Zoom below threshold (<=4) — popup should hide
    map.setZoom(2, { animate: false });
    renderer.updateEntityMarker(handle, {
      position: [5000, 5000], direction: 0, alive: 1, side: "WEST",
      name: "Rifleman", iconType: "man", isPlayer: true, isInVehicle: false,
    });

    expect((renderer as any).hideMarkerPopups).toBe(true);
    expect(popup.getElement()?.style.display).toBe("none");
  });

  it("shows entity popups when zoomed above threshold", () => {
    const handle = renderer.createEntityMarker(1, {
      position: [5000, 5000],
      direction: 0,
      iconType: "man",
      side: "WEST",
      name: "Rifleman",
      isPlayer: true,
    });

    const map = (renderer as any).map as L.Map;

    // First zoom out to hide
    map.setZoom(2, { animate: false });
    renderer.updateEntityMarker(handle, {
      position: [5000, 5000],
      direction: 0,
      alive: 1,
      side: "WEST",
      name: "Rifleman",
      iconType: "man",
      isPlayer: true,
      isInVehicle: false,
    });
    expect((renderer as any).hideMarkerPopups).toBe(true);

    // Then zoom back in above threshold
    map.setZoom(5, { animate: false });
    renderer.updateEntityMarker(handle, {
      position: [5000, 5000],
      direction: 0,
      alive: 1,
      side: "WEST",
      name: "Rifleman",
      iconType: "man",
      isPlayer: true,
      isInVehicle: false,
    });

    expect((renderer as any).hideMarkerPopups).toBe(false);
    const popup = (handle as any)._internal.marker.getPopup()!;
    const popupEl = popup.getElement();
    expect(popupEl?.style.display).not.toBe("none");
  });

  it("hideMarkerPopups is initially set based on starting zoom", () => {
    // WORLD_CONFIG has maxZoom=4; legacy threshold is <=4
    // The map starts at center zoom which is maxZoom
    const hideMarkerPopups = (renderer as any).hideMarkerPopups as boolean;
    // Starting zoom = maxZoom (4) which is <= threshold (4) → hidden
    expect(hideMarkerPopups).toBe(true);
  });

  it("uses leaflet-popup-unit class for infantry markers", () => {
    const handle = renderer.createEntityMarker(1, {
      position: [5000, 5000],
      direction: 0,
      iconType: "man",
      side: "WEST",
      name: "Rifleman",
      isPlayer: true,
    });
    const marker = (handle as any)._internal.marker as L.Marker;
    const popup = marker.getPopup()!;
    expect((popup.options as any).className).toBe("leaflet-popup-unit");
  });

  it("uses leaflet-popup-vehicle class for vehicle markers", () => {
    const handle = renderer.createEntityMarker(2, {
      position: [5000, 5000],
      direction: 0,
      iconType: "car",
      side: "WEST",
      name: "Hunter",
      isPlayer: false,
    });
    const marker = (handle as any)._internal.marker as L.Marker;
    const popup = marker.getPopup()!;
    expect((popup.options as any).className).toBe("leaflet-popup-vehicle");
  });

  it("removeBriefingMarker removes ICON from briefingMarkers layer", () => {
    const handle = renderer.createBriefingMarker({
      shape: "ICON",
      type: "mil_dot",
      color: "FF0000",
      side: "WEST",
      layer: "briefingMarkers",
    });

    const layer = getInternalLayer(handle);
    const layers = (renderer as any).layers;
    expect(layers.briefingMarkers.hasLayer(layer)).toBe(true);

    renderer.removeBriefingMarker(handle);
    expect(layers.briefingMarkers.hasLayer(layer)).toBe(false);
  });

  it("removeBriefingMarker removes ICON from projectileMarkers layer", () => {
    const handle = renderer.createBriefingMarker({
      shape: "ICON",
      type: "magIcons/gear_smokegrenade_white_ca.paa",
      color: "FF0000",
      side: "GLOBAL",
      layer: "projectileMarkers",
    });

    const layer = getInternalLayer(handle);
    const layers = (renderer as any).layers;
    expect(layers.projectileMarkers.hasLayer(layer)).toBe(true);
    expect(layers.briefingMarkers.hasLayer(layer)).toBe(false);

    renderer.removeBriefingMarker(handle);
    expect(layers.projectileMarkers.hasLayer(layer)).toBe(false);
  });

  it("removeBriefingMarker removes ICON from systemMarkers layer", () => {
    const handle = renderer.createBriefingMarker({
      shape: "ICON",
      type: "mil_dot",
      color: "FF0000",
      side: "GLOBAL",
      layer: "systemMarkers",
    });

    const layer = getInternalLayer(handle);
    const layers = (renderer as any).layers;
    expect(layers.systemMarkers.hasLayer(layer)).toBe(true);
    expect(layers.briefingMarkers.hasLayer(layer)).toBe(false);

    renderer.removeBriefingMarker(handle);
    expect(layers.systemMarkers.hasLayer(layer)).toBe(false);
  });

  it("removeBriefingMarker cleans up pattern from SVG defs", () => {
    const handle = renderer.createBriefingMarker({
      shape: "ELLIPSE",
      type: "mil_circle",
      color: "FF0000",
      side: "WEST",
      size: [100, 100],
      brush: "grid",
    });

    const internal = getInternal(handle);
    const patternId = internal.patternId;
    const svgDefs = (renderer as any).svgDefs as SVGDefsElement;

    // Pattern should exist in defs
    expect(svgDefs.querySelector(`#${patternId}`)).not.toBeNull();

    renderer.removeBriefingMarker(handle);

    // Pattern should be removed from defs
    expect(svgDefs.querySelector(`#${patternId}`)).toBeNull();
  });
});
