import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@solidjs/testing-library";
import { MapCard } from "../MapCard";
import type { MapInfo } from "../types";

const baseMap: MapInfo = {
  name: "Altis",
  worldSize: 30720,
  status: "complete",
  hasPreview: false,
  files: { "satellite.pmtiles": 500, "heightmap.pmtiles": 200 },
  featureLayers: ["roads", "buildings"],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MapCard", () => {
  it("renders the map name", () => {
    const { container } = render(() => (
      <MapCard map={baseMap} selected={false} baseUrl="" onSelect={() => {}} />
    ));
    expect(container.textContent).toContain("Altis");
  });

  it("renders world size", () => {
    const { container } = render(() => (
      <MapCard map={baseMap} selected={false} baseUrl="" onSelect={() => {}} />
    ));
    expect(container.textContent).toContain("30.7 km");
  });

  it("renders status badge", () => {
    const { container } = render(() => (
      <MapCard map={baseMap} selected={false} baseUrl="" onSelect={() => {}} />
    ));
    expect(container.textContent).toContain("COMPLETE");
  });

  it("renders disk size when files exist", () => {
    const { container } = render(() => (
      <MapCard map={baseMap} selected={false} baseUrl="" onSelect={() => {}} />
    ));
    // 700 MB total (500 + 200) * 1_048_576 bytes
    expect(container.textContent).toContain("700.0 MB");
  });

  it("renders feature layer count", () => {
    const { container } = render(() => (
      <MapCard map={baseMap} selected={false} baseUrl="" onSelect={() => {}} />
    ));
    expect(container.textContent).toContain("2");
  });

  it("calls onSelect when clicked", () => {
    const onSelect = vi.fn();
    const { container } = render(() => (
      <MapCard map={baseMap} selected={false} baseUrl="" onSelect={onSelect} />
    ));
    fireEvent.click(container.firstElementChild!);
    expect(onSelect).toHaveBeenCalled();
  });

  it("shows 'No preview' when hasPreview is false", () => {
    const { container } = render(() => (
      <MapCard map={baseMap} selected={false} baseUrl="" onSelect={() => {}} />
    ));
    expect(container.textContent).toContain("No preview");
  });

  it("shows preview image when hasPreview is true", () => {
    const map: MapInfo = { ...baseMap, hasPreview: true };
    const { container } = render(() => (
      <MapCard map={map} selected={false} baseUrl="/test" onSelect={() => {}} />
    ));
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.src).toContain("/test/images/maps/Altis/preview_256.png");
  });

  it("renders without worldSize", () => {
    const map: MapInfo = { ...baseMap, worldSize: undefined };
    const { container } = render(() => (
      <MapCard map={map} selected={false} baseUrl="" onSelect={() => {}} />
    ));
    expect(container.textContent).toContain("Altis");
    expect(container.textContent).not.toContain("km");
  });

  it("renders incomplete status", () => {
    const map: MapInfo = { ...baseMap, status: "incomplete" };
    const { container } = render(() => (
      <MapCard map={map} selected={false} baseUrl="" onSelect={() => {}} />
    ));
    expect(container.textContent).toContain("PARTIAL");
  });
});
