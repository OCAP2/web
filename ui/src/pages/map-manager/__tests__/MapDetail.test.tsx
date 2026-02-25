import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@solidjs/testing-library";
import { MapDetail } from "../MapDetail";
import type { MapInfo } from "../types";

const baseMap: MapInfo = {
  name: "Altis",
  worldSize: 30720,
  status: "complete",
  hasPreview: true,
  elevation: { min: 0, max: 350, avg: 85, stddev: 60 },
  featureLayers: ["roads", "buildings", "contours"],
  files: {
    "satellite.pmtiles": 500,
    "heightmap.pmtiles": 200,
    "color-relief.json": 1,
    "map.json": 1,
  },
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MapDetail", () => {
  it("renders map name in hero", () => {
    const { container } = render(() => (
      <MapDetail map={baseMap} baseUrl="" onClose={() => {}} onDelete={() => {}} />
    ));
    expect(container.textContent).toContain("Altis");
  });

  it("renders world size formatted", () => {
    const { container } = render(() => (
      <MapDetail map={baseMap} baseUrl="" onClose={() => {}} onDelete={() => {}} />
    ));
    expect(container.textContent).toContain("30.7 km");
  });

  it("renders status label", () => {
    const { container } = render(() => (
      <MapDetail map={baseMap} baseUrl="" onClose={() => {}} onDelete={() => {}} />
    ));
    expect(container.textContent).toContain("Complete");
  });

  it("renders elevation data", () => {
    const { container } = render(() => (
      <MapDetail map={baseMap} baseUrl="" onClose={() => {}} onDelete={() => {}} />
    ));
    expect(container.textContent).toContain("0m");
    expect(container.textContent).toContain("350m");
    expect(container.textContent).toContain("85m");
    expect(container.textContent).toContain("60m");
  });

  it("renders feature layers as tags", () => {
    const { container } = render(() => (
      <MapDetail map={baseMap} baseUrl="" onClose={() => {}} onDelete={() => {}} />
    ));
    expect(container.textContent).toContain("roads");
    expect(container.textContent).toContain("buildings");
    expect(container.textContent).toContain("contours");
  });

  it("renders tile file list with found/missing indicators", () => {
    const { container } = render(() => (
      <MapDetail map={baseMap} baseUrl="" onClose={() => {}} onDelete={() => {}} />
    ));
    expect(container.textContent).toContain("satellite.pmtiles");
    expect(container.textContent).toContain("heightmap.pmtiles");
    expect(container.textContent).toContain("map.json");
    // File sizes for found files
    expect(container.textContent).toContain("500 MB");
  });

  it("renders style variants", () => {
    const { container } = render(() => (
      <MapDetail map={baseMap} baseUrl="" onClose={() => {}} onDelete={() => {}} />
    ));
    expect(container.textContent).toContain("Topo");
    expect(container.textContent).toContain("Topo Dark");
    expect(container.textContent).toContain("Relief");
  });

  it("shows preview image when hasPreview is true", () => {
    const { container } = render(() => (
      <MapDetail map={baseMap} baseUrl="/api" onClose={() => {}} onDelete={() => {}} />
    ));
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.src).toContain("/api/images/maps/Altis/preview_256.png");
  });

  it("calls onClose when close button clicked", () => {
    const onClose = vi.fn();
    const { container } = render(() => (
      <MapDetail map={baseMap} baseUrl="" onClose={onClose} onDelete={() => {}} />
    ));
    // The close button is a button in the hero area
    const buttons = container.querySelectorAll("button");
    // First button is the close button (in hero)
    fireEvent.click(buttons[0]);
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onDelete when delete button clicked", () => {
    const onDelete = vi.fn();
    const { container } = render(() => (
      <MapDetail map={baseMap} baseUrl="" onClose={() => {}} onDelete={onDelete} />
    ));
    const buttons = container.querySelectorAll("button");
    // Last button is the delete button
    const deleteBtn = Array.from(buttons).find((b) =>
      b.textContent?.includes("Delete Map"),
    );
    expect(deleteBtn).toBeDefined();
    fireEvent.click(deleteBtn!);
    expect(onDelete).toHaveBeenCalled();
  });

  it("hides elevation when not provided", () => {
    const map: MapInfo = { ...baseMap, elevation: undefined };
    const { container } = render(() => (
      <MapDetail map={map} baseUrl="" onClose={() => {}} onDelete={() => {}} />
    ));
    // Section heading "Elevation" should be gone, but "Elevation" substring
    // still appears in style variant descriptions. Check for stat labels instead.
    expect(container.textContent).not.toContain("MIN");
    expect(container.textContent).not.toContain("MAX");
  });

  it("hides feature layers when empty", () => {
    const map: MapInfo = { ...baseMap, featureLayers: [] };
    const { container } = render(() => (
      <MapDetail map={map} baseUrl="" onClose={() => {}} onDelete={() => {}} />
    ));
    expect(container.textContent).not.toContain("Feature Layers");
  });

  it("renders world size in meters for info grid", () => {
    const { container } = render(() => (
      <MapDetail map={baseMap} baseUrl="" onClose={() => {}} onDelete={() => {}} />
    ));
    expect(container.textContent).toContain("30,720 m");
  });
});
