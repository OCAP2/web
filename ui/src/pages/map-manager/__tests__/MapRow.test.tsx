import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@solidjs/testing-library";
import { MapRow } from "../MapRow";
import type { MapInfo } from "../types";

const baseMap: MapInfo = {
  name: "Stratis",
  worldSize: 8192,
  status: "complete",
  files: { "satellite.pmtiles": 120, "heightmap.pmtiles": 40 },
  featureLayers: ["roads"],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MapRow", () => {
  it("renders map name", () => {
    const { container } = render(() => (
      <MapRow map={baseMap} selected={false} onSelect={() => {}} />
    ));
    expect(container.textContent).toContain("Stratis");
  });

  it("renders world size formatted", () => {
    const { container } = render(() => (
      <MapRow map={baseMap} selected={false} onSelect={() => {}} />
    ));
    expect(container.textContent).toContain("8.2 km");
  });

  it("renders layer count", () => {
    const { container } = render(() => (
      <MapRow map={baseMap} selected={false} onSelect={() => {}} />
    ));
    expect(container.textContent).toContain("1");
  });

  it("renders disk size formatted", () => {
    const { container } = render(() => (
      <MapRow map={baseMap} selected={false} onSelect={() => {}} />
    ));
    // 160 MB total = 160 * 1_048_576
    expect(container.textContent).toContain("160.0 MB");
  });

  it("renders status label", () => {
    const { container } = render(() => (
      <MapRow map={baseMap} selected={false} onSelect={() => {}} />
    ));
    expect(container.textContent).toContain("Complete");
  });

  it("shows dash when worldSize is missing", () => {
    const map: MapInfo = { ...baseMap, worldSize: undefined };
    const { container } = render(() => (
      <MapRow map={map} selected={false} onSelect={() => {}} />
    ));
    expect(container.textContent).toContain("—");
  });

  it("shows dash when no files", () => {
    const map: MapInfo = { ...baseMap, files: undefined };
    const { container } = render(() => (
      <MapRow map={map} selected={false} onSelect={() => {}} />
    ));
    expect(container.textContent).toContain("—");
  });

  it("calls onSelect when clicked", () => {
    const onSelect = vi.fn();
    const { container } = render(() => (
      <MapRow map={baseMap} selected={false} onSelect={onSelect} />
    ));
    fireEvent.click(container.firstElementChild!);
    expect(onSelect).toHaveBeenCalled();
  });

  it("renders incomplete as Partial", () => {
    const map: MapInfo = { ...baseMap, status: "incomplete" };
    const { container } = render(() => (
      <MapRow map={map} selected={false} onSelect={() => {}} />
    ));
    expect(container.textContent).toContain("Partial");
  });
});
