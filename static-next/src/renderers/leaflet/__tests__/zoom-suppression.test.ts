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

  function getInternalLayer(handle: BriefingMarkerHandle): L.Layer {
    return (handle as any)._internal.layer;
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
});
