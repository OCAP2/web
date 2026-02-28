import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { MapControls } from "../components/MapControls";
import type { MapStyleInfo } from "../../../renderers/renderer.types";
import {
  createTestEngine,
  TestProviders,
  makeManifest,
} from "./testHelpers";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("MapControls", () => {
  it("renders zoom in and zoom out buttons", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(makeManifest([]));

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
    engine.loadRecording(makeManifest([]));

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
    engine.loadRecording(makeManifest([]));

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
    engine.loadRecording(makeManifest([]));

    // MockRenderer.mapStyles() already returns [] by default

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

const twoStyles: MapStyleInfo[] = [
  { label: "Topographic", available: true, previewUrl: "http://example.com/topo.png" },
  { label: "Satellite", available: true, previewUrl: "http://example.com/sat.png" },
];

const mixedStyles: MapStyleInfo[] = [
  { label: "Topographic", available: true, previewUrl: "http://example.com/topo.png" },
  { label: "Satellite", available: true, previewUrl: "http://example.com/sat.png" },
  { label: "Debug", available: false },
];

describe("MapControls - style switcher", () => {
  it("renders style buttons when 2+ available styles", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(makeManifest([]));

    renderer.setMapStylesForTest(twoStyles);
    renderer.setActiveStyleIndexForTest(0);

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <MapControls />
      </TestProviders>
    ));

    expect(screen.getByTitle("Topographic")).toBeTruthy();
    expect(screen.getByTitle("Satellite")).toBeTruthy();
  });

  it("highlights the active style button", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(makeManifest([]));

    renderer.setMapStylesForTest(twoStyles);
    renderer.setActiveStyleIndexForTest(1);

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <MapControls />
      </TestProviders>
    ));

    const topoBtn = screen.getByTitle("Topographic");
    const satBtn = screen.getByTitle("Satellite");

    // Active style (index 1 = Satellite) should have the active class
    // Non-active should have the default class
    // We can verify by checking the class names contain "active" or "default"
    expect(satBtn.className).toContain("Active");
    expect(topoBtn.className).toContain("Default");
  });

  it("clicking a style calls renderer.setMapStyle(index)", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(makeManifest([]));

    renderer.setMapStylesForTest(twoStyles);
    renderer.setActiveStyleIndexForTest(0);
    const setMapStyleSpy = vi.spyOn(renderer, "setMapStyle");

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <MapControls />
      </TestProviders>
    ));

    const satBtn = screen.getByTitle("Satellite");
    fireEvent.click(satBtn);

    expect(setMapStyleSpy).toHaveBeenCalledWith(1);
  });

  it("filters out unavailable styles from the switcher", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(makeManifest([]));

    renderer.setMapStylesForTest(mixedStyles);
    renderer.setActiveStyleIndexForTest(0);

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <MapControls />
      </TestProviders>
    ));

    // Only available styles should be rendered
    expect(screen.getByTitle("Topographic")).toBeTruthy();
    expect(screen.getByTitle("Satellite")).toBeTruthy();
    expect(screen.queryByTitle("Debug")).toBeNull();
  });

  it("shows preview tooltip on mouse enter and hides on mouse leave", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(makeManifest([]));

    renderer.setMapStylesForTest(twoStyles);
    renderer.setActiveStyleIndexForTest(0);

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <MapControls />
      </TestProviders>
    ));

    const satBtn = screen.getByTitle("Satellite");

    // No preview image initially
    expect(screen.queryByAltText("Style preview")).toBeNull();

    // Mouse enter shows preview
    fireEvent.mouseEnter(satBtn);
    const previewImg = screen.getByAltText("Style preview") as HTMLImageElement;
    expect(previewImg).toBeTruthy();
    expect(previewImg.src).toBe("http://example.com/sat.png");

    // Mouse leave hides preview
    fireEvent.mouseLeave(satBtn);
    expect(screen.queryByAltText("Style preview")).toBeNull();
  });

  it("does not show style switcher when only 1 style is available", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(makeManifest([]));

    renderer.setMapStylesForTest([
      { label: "Topographic", available: true, previewUrl: "http://example.com/topo.png" },
    ]);
    renderer.setActiveStyleIndexForTest(0);

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <MapControls />
      </TestProviders>
    ));

    // Only 1 available style — switcher should be hidden
    expect(screen.queryByTitle("Topographic")).toBeNull();
  });

  it("clicking active style still calls setMapStyle", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(makeManifest([]));

    renderer.setMapStylesForTest(twoStyles);
    renderer.setActiveStyleIndexForTest(0);
    const setMapStyleSpy = vi.spyOn(renderer, "setMapStyle");

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <MapControls />
      </TestProviders>
    ));

    // Click the already-active style
    const topoBtn = screen.getByTitle("Topographic");
    fireEvent.click(topoBtn);

    expect(setMapStyleSpy).toHaveBeenCalledWith(0);
  });

  it("preview tooltip shows nothing when style has no previewUrl", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(makeManifest([]));

    const stylesNoPreview: MapStyleInfo[] = [
      { label: "Topographic", available: true },
      { label: "Satellite", available: true },
    ];

    renderer.setMapStylesForTest(stylesNoPreview);
    renderer.setActiveStyleIndexForTest(0);

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <MapControls />
      </TestProviders>
    ));

    const satBtn = screen.getByTitle("Satellite");
    fireEvent.mouseEnter(satBtn);

    // No preview image because previewUrl is undefined (setHoveredPreview gets null)
    expect(screen.queryByAltText("Style preview")).toBeNull();
  });
});
