import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { EngineProvider } from "../../hooks/useEngine";
import { RendererProvider } from "../../hooks/useRenderer";
import { MockRenderer } from "../../../renderers/mock-renderer";
import { PlaybackControls } from "../PlaybackControls";
import { Timeline } from "../Timeline";
import { ToggleBar } from "../ToggleBar";
import { BottomPanel } from "../BottomPanel";

/**
 * Create a mock engine with SolidJS signals for reactive properties
 * and vi.fn() stubs for command methods.
 */
function createMockEngine(overrides?: {
  currentFrame?: number;
  isPlaying?: boolean;
  playbackSpeed?: number;
  endFrame?: number;
  captureDelayMs?: number;
}) {
  const [currentFrame] = createSignal(overrides?.currentFrame ?? 0);
  const [isPlaying] = createSignal(overrides?.isPlaying ?? false);
  const [playbackSpeed] = createSignal(overrides?.playbackSpeed ?? 1);
  const [endFrame] = createSignal(overrides?.endFrame ?? 100);
  const [captureDelayMs] = createSignal(overrides?.captureDelayMs ?? 1000);

  return {
    currentFrame,
    isPlaying,
    playbackSpeed,
    endFrame,
    captureDelayMs,
    togglePlayPause: vi.fn(),
    seekTo: vi.fn(),
    setSpeed: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    followEntity: vi.fn(),
    unfollowEntity: vi.fn(),
    loadOperation: vi.fn(),
    dispose: vi.fn(),
  } as any;
}

afterEach(() => {
  cleanup();
});

// ─── PlaybackControls ───

describe("PlaybackControls", () => {
  it("renders play button when not playing", () => {
    const engine = createMockEngine({ isPlaying: false });
    const renderer = new MockRenderer();

    const { getByTestId } = render(() => (
      <EngineProvider engine={engine}>
        <RendererProvider renderer={renderer}>
          <PlaybackControls />
        </RendererProvider>
      </EngineProvider>
    ));

    const button = getByTestId("play-pause-button");
    expect(button.textContent).toBe("Play");
  });

  it("renders pause button when playing", () => {
    const engine = createMockEngine({ isPlaying: true });
    const renderer = new MockRenderer();

    const { getByTestId } = render(() => (
      <EngineProvider engine={engine}>
        <RendererProvider renderer={renderer}>
          <PlaybackControls />
        </RendererProvider>
      </EngineProvider>
    ));

    const button = getByTestId("play-pause-button");
    expect(button.textContent).toBe("Pause");
  });

  it("calls engine.togglePlayPause when play button is clicked", () => {
    const engine = createMockEngine();
    const renderer = new MockRenderer();

    const { getByTestId } = render(() => (
      <EngineProvider engine={engine}>
        <RendererProvider renderer={renderer}>
          <PlaybackControls />
        </RendererProvider>
      </EngineProvider>
    ));

    fireEvent.click(getByTestId("play-pause-button"));
    expect(engine.togglePlayPause).toHaveBeenCalledOnce();
  });

  it("displays current speed label", () => {
    const engine = createMockEngine({ playbackSpeed: 10 });
    const renderer = new MockRenderer();

    const { getByTestId } = render(() => (
      <EngineProvider engine={engine}>
        <RendererProvider renderer={renderer}>
          <PlaybackControls />
        </RendererProvider>
      </EngineProvider>
    ));

    expect(getByTestId("speed-label").textContent).toBe("10x");
  });

  it("calls engine.setSpeed when speed slider changes", () => {
    const engine = createMockEngine({ playbackSpeed: 1 });
    const renderer = new MockRenderer();

    const { getByTestId } = render(() => (
      <EngineProvider engine={engine}>
        <RendererProvider renderer={renderer}>
          <PlaybackControls />
        </RendererProvider>
      </EngineProvider>
    ));

    const slider = getByTestId("speed-slider") as HTMLInputElement;
    fireEvent.input(slider, { target: { value: "15" } });
    expect(engine.setSpeed).toHaveBeenCalledWith(15);
  });
});

// ─── Timeline ───

describe("Timeline", () => {
  it("renders with correct data-testid", () => {
    const engine = createMockEngine();
    const renderer = new MockRenderer();

    const { getByTestId } = render(() => (
      <EngineProvider engine={engine}>
        <RendererProvider renderer={renderer}>
          <Timeline />
        </RendererProvider>
      </EngineProvider>
    ));

    expect(getByTestId("timeline")).toBeDefined();
    expect(getByTestId("timeline-slider")).toBeDefined();
    expect(getByTestId("timeline-current-time")).toBeDefined();
    expect(getByTestId("timeline-end-time")).toBeDefined();
  });

  it("displays formatted elapsed time", () => {
    const engine = createMockEngine({
      currentFrame: 60,
      endFrame: 3600,
      captureDelayMs: 1000,
    });
    const renderer = new MockRenderer();

    const { getByTestId } = render(() => (
      <EngineProvider engine={engine}>
        <RendererProvider renderer={renderer}>
          <Timeline />
        </RendererProvider>
      </EngineProvider>
    ));

    expect(getByTestId("timeline-current-time").textContent).toBe("00:01:00");
    expect(getByTestId("timeline-end-time").textContent).toBe("01:00:00");
  });

  it("calls engine.seekTo when slider is moved", () => {
    const engine = createMockEngine({ endFrame: 500 });
    const renderer = new MockRenderer();

    const { getByTestId } = render(() => (
      <EngineProvider engine={engine}>
        <RendererProvider renderer={renderer}>
          <Timeline />
        </RendererProvider>
      </EngineProvider>
    ));

    const slider = getByTestId("timeline-slider") as HTMLInputElement;
    fireEvent.input(slider, { target: { value: "250" } });
    expect(engine.seekTo).toHaveBeenCalledWith(250);
  });
});

// ─── ToggleBar ───

describe("ToggleBar", () => {
  it("renders all toggle checkboxes", () => {
    const engine = createMockEngine();
    const renderer = new MockRenderer();

    const { getByTestId } = render(() => (
      <EngineProvider engine={engine}>
        <RendererProvider renderer={renderer}>
          <ToggleBar />
        </RendererProvider>
      </EngineProvider>
    ));

    expect(getByTestId("toggle-fire-lines")).toBeDefined();
    expect(getByTestId("toggle-map-markers")).toBeDefined();
    expect(getByTestId("toggle-grid")).toBeDefined();
  });

  it("calls renderer.setLayerVisible for fire lines toggle", () => {
    const engine = createMockEngine();
    const renderer = new MockRenderer();
    const spy = vi.spyOn(renderer, "setLayerVisible");

    const { getByTestId } = render(() => (
      <EngineProvider engine={engine}>
        <RendererProvider renderer={renderer}>
          <ToggleBar />
        </RendererProvider>
      </EngineProvider>
    ));

    fireEvent.change(getByTestId("toggle-fire-lines"));
    expect(spy).toHaveBeenCalledWith("projectileMarkers", false);
  });

  it("calls renderer.setLayerVisible for map markers toggle", () => {
    const engine = createMockEngine();
    const renderer = new MockRenderer();
    const spy = vi.spyOn(renderer, "setLayerVisible");

    const { getByTestId } = render(() => (
      <EngineProvider engine={engine}>
        <RendererProvider renderer={renderer}>
          <ToggleBar />
        </RendererProvider>
      </EngineProvider>
    ));

    fireEvent.change(getByTestId("toggle-map-markers"));
    expect(spy).toHaveBeenCalledWith("briefingMarkers", false);
  });

  it("calls renderer.setLayerVisible for grid toggle", () => {
    const engine = createMockEngine();
    const renderer = new MockRenderer();
    const spy = vi.spyOn(renderer, "setLayerVisible");

    const { getByTestId } = render(() => (
      <EngineProvider engine={engine}>
        <RendererProvider renderer={renderer}>
          <ToggleBar />
        </RendererProvider>
      </EngineProvider>
    ));

    fireEvent.change(getByTestId("toggle-grid"));
    expect(spy).toHaveBeenCalledWith("grid", false);
  });

  it("toggles back to visible on second click", () => {
    const engine = createMockEngine();
    const renderer = new MockRenderer();
    const spy = vi.spyOn(renderer, "setLayerVisible");

    const { getByTestId } = render(() => (
      <EngineProvider engine={engine}>
        <RendererProvider renderer={renderer}>
          <ToggleBar />
        </RendererProvider>
      </EngineProvider>
    ));

    const toggle = getByTestId("toggle-fire-lines");
    fireEvent.change(toggle);
    fireEvent.change(toggle);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith("projectileMarkers", true);
  });
});

// ─── BottomPanel ───

describe("BottomPanel", () => {
  it("renders all sub-components", () => {
    const engine = createMockEngine();
    const renderer = new MockRenderer();

    const { getByTestId } = render(() => (
      <EngineProvider engine={engine}>
        <RendererProvider renderer={renderer}>
          <BottomPanel />
        </RendererProvider>
      </EngineProvider>
    ));

    expect(getByTestId("bottom-panel")).toBeDefined();
    expect(getByTestId("timeline")).toBeDefined();
    expect(getByTestId("playback-controls")).toBeDefined();
    expect(getByTestId("toggle-bar")).toBeDefined();
  });
});
