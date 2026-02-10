import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import L from "leaflet";
import { LeafletRenderer } from "../leaflet-renderer";
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
