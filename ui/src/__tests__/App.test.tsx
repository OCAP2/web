import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@solidjs/testing-library";
import { Router, Route } from "@solidjs/router";
import { App } from "../App";
import { RecordingSelector } from "../pages/recording-selector";

// Mock LeafletRenderer to avoid Leaflet in jsdom
vi.mock("../renderers/leaflet/leafletRenderer", () => ({
  LeafletRenderer: vi.fn().mockImplementation(() => ({
    init: vi.fn(),
    dispose: vi.fn(),
    getZoom: vi.fn().mockReturnValue(1),
    setView: vi.fn(),
    fitBounds: vi.fn(),
    getCenter: vi.fn().mockReturnValue([0, 0]),
    createEntityMarker: vi.fn(),
    updateEntityMarker: vi.fn(),
    removeEntityMarker: vi.fn(),
    createBriefingMarker: vi.fn(),
    updateBriefingMarker: vi.fn(),
    removeBriefingMarker: vi.fn(),
    addLine: vi.fn(),
    removeLine: vi.fn(),
    addPulse: vi.fn(),
    removePulse: vi.fn(),
    setLayerVisible: vi.fn(),
    setSmoothingEnabled: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    getControls: vi.fn().mockReturnValue({}),
  })),
}));

describe("App", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders without crashing", () => {
    const { container } = render(() => (
      <Router root={App}>
        <Route path="/" component={RecordingSelector} />
      </Router>
    ));
    expect(container).toBeDefined();
  });

  it("renders the recording selector on /", () => {
    const { getByTestId } = render(() => (
      <Router root={App}>
        <Route path="/" component={RecordingSelector} />
      </Router>
    ));
    expect(getByTestId("recording-selector")).toBeDefined();
  });
});
