import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { MapControls } from "../components/MapControls";
import {
  createTestEngine,
  TestProviders,
  makeManifest,
} from "./test-helpers";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MapControls", () => {
  it("renders zoom in and zoom out buttons", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadOperation(makeManifest([]));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <MapControls />
      </TestProviders>
    ));

    expect(screen.getByTitle("Zoom in")).toBeTruthy();
    expect(screen.getByTitle("Zoom out")).toBeTruthy();
  });

  it("zoom in calls renderer.setView with zoom + 1", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadOperation(makeManifest([]));

    const getZoomSpy = vi.spyOn(renderer, "getZoom").mockReturnValue(5);
    const getCenterSpy = vi.spyOn(renderer, "getCenter").mockReturnValue([100, 200]);
    const setViewSpy = vi.spyOn(renderer, "setView");

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <MapControls />
      </TestProviders>
    ));

    fireEvent.click(screen.getByTitle("Zoom in"));

    expect(setViewSpy).toHaveBeenCalledWith([100, 200], 6);
  });

  it("zoom out calls renderer.setView with zoom - 1", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadOperation(makeManifest([]));

    const getZoomSpy = vi.spyOn(renderer, "getZoom").mockReturnValue(5);
    const getCenterSpy = vi.spyOn(renderer, "getCenter").mockReturnValue([100, 200]);
    const setViewSpy = vi.spyOn(renderer, "setView");

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <MapControls />
      </TestProviders>
    ));

    fireEvent.click(screen.getByTitle("Zoom out"));

    expect(setViewSpy).toHaveBeenCalledWith([100, 200], 4);
  });

  it("style switcher hidden when no styles available", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadOperation(makeManifest([]));

    // MockRenderer.getMapStyles() already returns [] by default
    vi.spyOn(renderer, "getMapStyles").mockReturnValue([]);

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <MapControls />
      </TestProviders>
    ));

    // Zoom buttons should exist
    expect(screen.getByTitle("Zoom in")).toBeTruthy();
    expect(screen.getByTitle("Zoom out")).toBeTruthy();

    // Style buttons should not exist (no available styles)
    expect(screen.queryByTitle("Topographic")).toBeNull();
    expect(screen.queryByTitle("Satellite")).toBeNull();
  });
});
