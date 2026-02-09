import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { EngineProvider } from "../../hooks/useEngine";
import { I18nProvider } from "../../hooks/useLocale";
import { RendererProvider } from "../../hooks/useRenderer";
import { MockRenderer } from "../../../renderers/mock-renderer";
import { EventManager } from "../../../playback/event-manager";
import { GameEvent } from "../../../playback/events/game-event";
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
  events?: Array<{ frameNum: number; type: string }>;
}) {
  const [currentFrame] = createSignal(overrides?.currentFrame ?? 0);
  const [isPlaying] = createSignal(overrides?.isPlaying ?? false);
  const [playbackSpeed] = createSignal(overrides?.playbackSpeed ?? 1);
  const [endFrame] = createSignal(overrides?.endFrame ?? 100);
  const [captureDelayMs] = createSignal(overrides?.captureDelayMs ?? 1000);

  const eventManager = new EventManager();
  if (overrides?.events) {
    overrides.events.forEach((ev, i) => {
      eventManager.addEvent(new GameEvent(ev.frameNum, ev.type, i));
    });
  }

  return {
    currentFrame,
    isPlaying,
    playbackSpeed,
    endFrame,
    captureDelayMs,
    eventManager,
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
    expect(button.dataset.playing).toBe("false");
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
    expect(button.dataset.playing).toBe("true");
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

  it("displays formatted timecode", () => {
    const engine = createMockEngine({
      currentFrame: 60,
      endFrame: 3600,
      captureDelayMs: 1000,
    });
    const renderer = new MockRenderer();

    const { getByTestId } = render(() => (
      <EngineProvider engine={engine}>
        <RendererProvider renderer={renderer}>
          <PlaybackControls />
        </RendererProvider>
      </EngineProvider>
    ));

    expect(getByTestId("timeline-current-time").textContent).toBe("0:01:00");
    expect(getByTestId("timeline-end-time").textContent).toBe("1:00:00");
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

  it("renders event tick marks", () => {
    const engine = createMockEngine({
      endFrame: 1000,
      events: [
        { frameNum: 100, type: "killed" },
        { frameNum: 500, type: "killed" },
      ],
    });
    const renderer = new MockRenderer();

    const { container } = render(() => (
      <EngineProvider engine={engine}>
        <RendererProvider renderer={renderer}>
          <Timeline />
        </RendererProvider>
      </EngineProvider>
    ));

    const ticks = container.querySelectorAll('[data-testid="event-tick"]');
    expect(ticks.length).toBe(2);
  });

  it("positions event ticks as percentage of endFrame", () => {
    const engine = createMockEngine({
      endFrame: 1000,
      events: [
        { frameNum: 250, type: "killed" },
      ],
    });
    const renderer = new MockRenderer();

    const { container } = render(() => (
      <EngineProvider engine={engine}>
        <RendererProvider renderer={renderer}>
          <Timeline />
        </RendererProvider>
      </EngineProvider>
    ));

    const tick = container.querySelector('[data-testid="event-tick"]') as HTMLElement;
    expect(tick).toBeDefined();
    expect(tick.style.left).toBe("25%");
  });

  it("renders no ticks when endFrame is 0", () => {
    const engine = createMockEngine({
      endFrame: 0,
      events: [
        { frameNum: 10, type: "killed" },
      ],
    });
    const renderer = new MockRenderer();

    const { container } = render(() => (
      <EngineProvider engine={engine}>
        <RendererProvider renderer={renderer}>
          <Timeline />
        </RendererProvider>
      </EngineProvider>
    ));

    const ticks = container.querySelectorAll('[data-testid="event-tick"]');
    expect(ticks.length).toBe(0);
  });

  it("event ticks are inside the event-timeline container", () => {
    const engine = createMockEngine({
      endFrame: 500,
      events: [
        { frameNum: 100, type: "killed" },
      ],
    });
    const renderer = new MockRenderer();

    const { container } = render(() => (
      <EngineProvider engine={engine}>
        <RendererProvider renderer={renderer}>
          <Timeline />
        </RendererProvider>
      </EngineProvider>
    ));

    const tick = container.querySelector('[data-testid="event-tick"]');
    expect(tick?.parentElement?.getAttribute("data-testid")).toBe("event-timeline");
  });
});

// ─── ToggleBar ───

describe("ToggleBar", () => {
  it("renders all toggle buttons", () => {
    const engine = createMockEngine();
    const renderer = new MockRenderer();

    const { getByTestId } = render(() => (
      <I18nProvider locale="en"><EngineProvider engine={engine}>
        <RendererProvider renderer={renderer}>
          <ToggleBar />
        </RendererProvider>
      </EngineProvider></I18nProvider>
    ));

    expect(getByTestId("toggle-fire-lines")).toBeDefined();
    expect(getByTestId("toggle-map-markers")).toBeDefined();
    expect(getByTestId("toggle-grid")).toBeDefined();
  });

  it("renders dropdowns", () => {
    const engine = createMockEngine();
    const renderer = new MockRenderer();

    const { getByTestId } = render(() => (
      <I18nProvider locale="en"><EngineProvider engine={engine}>
        <RendererProvider renderer={renderer}>
          <ToggleBar />
        </RendererProvider>
      </EngineProvider></I18nProvider>
    ));

    expect(getByTestId("toggle-names")).toBeDefined();
    expect(getByTestId("toggle-time")).toBeDefined();
  });

  it("renders fullscreen button", () => {
    const engine = createMockEngine();
    const renderer = new MockRenderer();

    const { getByTestId } = render(() => (
      <I18nProvider locale="en"><EngineProvider engine={engine}>
        <RendererProvider renderer={renderer}>
          <ToggleBar />
        </RendererProvider>
      </EngineProvider></I18nProvider>
    ));

    expect(getByTestId("fullscreen-button")).toBeDefined();
  });

  it("renders speed label and slider", () => {
    const engine = createMockEngine({ playbackSpeed: 10 });
    const renderer = new MockRenderer();

    const { getByTestId } = render(() => (
      <I18nProvider locale="en"><EngineProvider engine={engine}>
        <RendererProvider renderer={renderer}>
          <ToggleBar />
        </RendererProvider>
      </EngineProvider></I18nProvider>
    ));

    expect(getByTestId("speed-label").textContent).toBe("10x");
    expect(getByTestId("speed-slider")).toBeDefined();
  });

  it("calls engine.setSpeed when speed slider changes", () => {
    const engine = createMockEngine({ playbackSpeed: 1 });
    const renderer = new MockRenderer();

    const { getByTestId } = render(() => (
      <I18nProvider locale="en"><EngineProvider engine={engine}>
        <RendererProvider renderer={renderer}>
          <ToggleBar />
        </RendererProvider>
      </EngineProvider></I18nProvider>
    ));

    const slider = getByTestId("speed-slider") as HTMLInputElement;
    fireEvent.input(slider, { target: { value: "15" } });
    expect(engine.setSpeed).toHaveBeenCalledWith(15);
  });

  it("calls renderer.setLayerVisible for fire lines toggle", () => {
    const engine = createMockEngine();
    const renderer = new MockRenderer();
    const spy = vi.spyOn(renderer, "setLayerVisible");

    const { getByTestId } = render(() => (
      <I18nProvider locale="en"><EngineProvider engine={engine}>
        <RendererProvider renderer={renderer}>
          <ToggleBar />
        </RendererProvider>
      </EngineProvider></I18nProvider>
    ));

    fireEvent.click(getByTestId("toggle-fire-lines"));
    expect(spy).toHaveBeenCalledWith("projectileMarkers", false);
  });

  it("calls renderer.setLayerVisible for map markers toggle", () => {
    const engine = createMockEngine();
    const renderer = new MockRenderer();
    const spy = vi.spyOn(renderer, "setLayerVisible");

    const { getByTestId } = render(() => (
      <I18nProvider locale="en"><EngineProvider engine={engine}>
        <RendererProvider renderer={renderer}>
          <ToggleBar />
        </RendererProvider>
      </EngineProvider></I18nProvider>
    ));

    fireEvent.click(getByTestId("toggle-map-markers"));
    expect(spy).toHaveBeenCalledWith("briefingMarkers", false);
  });

  it("calls renderer.setLayerVisible for grid toggle (starts inactive)", () => {
    const engine = createMockEngine();
    const renderer = new MockRenderer();
    const spy = vi.spyOn(renderer, "setLayerVisible");

    const { getByTestId } = render(() => (
      <I18nProvider locale="en"><EngineProvider engine={engine}>
        <RendererProvider renderer={renderer}>
          <ToggleBar />
        </RendererProvider>
      </EngineProvider></I18nProvider>
    ));

    // Grid starts off (inactive), clicking turns it on
    fireEvent.click(getByTestId("toggle-grid"));
    expect(spy).toHaveBeenCalledWith("grid", true);
  });

  it("speed slider is inside a popup wrapper for hover access", () => {
    const engine = createMockEngine();
    const renderer = new MockRenderer();

    const { getByTestId } = render(() => (
      <I18nProvider locale="en"><EngineProvider engine={engine}>
        <RendererProvider renderer={renderer}>
          <ToggleBar />
        </RendererProvider>
      </EngineProvider></I18nProvider>
    ));

    const slider = getByTestId("speed-slider");
    // Slider should be inside the speed-slider-popup div
    expect(slider.parentElement?.getAttribute("data-testid")).toBe("speed-slider-popup");
    // Popup should be inside speed-slider-container
    expect(slider.parentElement?.parentElement?.getAttribute("data-testid")).toBe("speed-slider-container");
  });

  it("toggles back to visible on second click", () => {
    const engine = createMockEngine();
    const renderer = new MockRenderer();
    const spy = vi.spyOn(renderer, "setLayerVisible");

    const { getByTestId } = render(() => (
      <I18nProvider locale="en"><EngineProvider engine={engine}>
        <RendererProvider renderer={renderer}>
          <ToggleBar />
        </RendererProvider>
      </EngineProvider></I18nProvider>
    ));

    const toggle = getByTestId("toggle-fire-lines");
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith("projectileMarkers", true);
  });

  it("shows active/inactive state via CSS class", () => {
    const engine = createMockEngine();
    const renderer = new MockRenderer();

    const { getByTestId } = render(() => (
      <I18nProvider locale="en"><EngineProvider engine={engine}>
        <RendererProvider renderer={renderer}>
          <ToggleBar />
        </RendererProvider>
      </EngineProvider></I18nProvider>
    ));

    const toggle = getByTestId("toggle-fire-lines");
    expect(toggle.className).toContain("active");

    fireEvent.click(toggle);
    expect(toggle.className).toContain("inactive");
  });

  it("grid starts inactive (matching old frontend)", () => {
    const engine = createMockEngine();
    const renderer = new MockRenderer();

    const { getByTestId } = render(() => (
      <I18nProvider locale="en"><EngineProvider engine={engine}>
        <RendererProvider renderer={renderer}>
          <ToggleBar />
        </RendererProvider>
      </EngineProvider></I18nProvider>
    ));

    const toggle = getByTestId("toggle-grid");
    expect(toggle.className).toContain("inactive");
  });
});

// ─── BottomPanel ───

describe("BottomPanel", () => {
  it("renders all sub-components", () => {
    const engine = createMockEngine();
    const renderer = new MockRenderer();

    const { getByTestId } = render(() => (
      <I18nProvider locale="en"><EngineProvider engine={engine}>
        <RendererProvider renderer={renderer}>
          <BottomPanel />
        </RendererProvider>
      </EngineProvider></I18nProvider>
    ));

    expect(getByTestId("bottom-panel")).toBeDefined();
    expect(getByTestId("timeline")).toBeDefined();
    expect(getByTestId("playback-controls")).toBeDefined();
    expect(getByTestId("toggle-bar")).toBeDefined();
  });
});
