import { createSignal } from "solid-js";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { BottomBar } from "../components/BottomBar";
import type { TimeMode } from "../../../playback/time";
import {
  createTestEngine,
  TestProviders,
  makeManifest,
} from "./testHelpers";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderBottomBar(frameCount = 200) {
  const { engine, renderer } = createTestEngine();
  engine.loadRecording(makeManifest([], [], frameCount));

  const [panelOpen, setPanelOpen] = createSignal(true);
  const onTogglePanel = vi.fn(() => setPanelOpen((v) => !v));
  const [timeMode] = createSignal<TimeMode>("elapsed");

  const result = render(() => (
    <TestProviders engine={engine} renderer={renderer}>
      <BottomBar panelOpen={panelOpen} onTogglePanel={onTogglePanel} timeMode={timeMode} />
    </TestProviders>
  ));

  return { engine, renderer, onTogglePanel, ...result };
}

describe("BottomBar", () => {
  it("play button calls togglePlayPause", () => {
    const { engine } = renderBottomBar();
    const spy = vi.spyOn(engine, "togglePlayPause");

    const allButtons = screen.getAllByRole("button");
    const panelButton = screen.getByText("Panel").closest("button")!;
    const nonPanelButtons = allButtons.filter((b) => b !== panelButton);

    // Center: prev-kill=0, step-back=1, play=2, step-forward=3, next-kill=4
    const playButton = nonPanelButtons[2];
    fireEvent.click(playButton);

    expect(spy).toHaveBeenCalledOnce();
  });

  it("step back button pauses and steps back one frame", () => {
    const { engine } = renderBottomBar();
    engine.seekTo(50);
    const seekSpy = vi.spyOn(engine, "seekTo");
    const pauseSpy = vi.spyOn(engine, "pause");

    const allButtons = screen.getAllByRole("button");
    const panelButton = screen.getByText("Panel").closest("button")!;
    const nonPanelButtons = allButtons.filter((b) => b !== panelButton);

    const stepBackButton = nonPanelButtons[1];
    fireEvent.click(stepBackButton);

    expect(pauseSpy).toHaveBeenCalled();
    expect(seekSpy).toHaveBeenCalledWith(49);
  });

  it("step forward button pauses and steps forward one frame", () => {
    const { engine } = renderBottomBar(200);
    engine.seekTo(50);
    const seekSpy = vi.spyOn(engine, "seekTo");
    const pauseSpy = vi.spyOn(engine, "pause");

    const allButtons = screen.getAllByRole("button");
    const panelButton = screen.getByText("Panel").closest("button")!;
    const nonPanelButtons = allButtons.filter((b) => b !== panelButton);

    const stepForwardButton = nonPanelButtons[3];
    fireEvent.click(stepForwardButton);

    expect(pauseSpy).toHaveBeenCalled();
    expect(seekSpy).toHaveBeenCalledWith(51);
  });

  it("panel toggle button calls onTogglePanel", () => {
    const { onTogglePanel } = renderBottomBar();

    const panelButton = screen.getByText("Panel").closest("button")!;
    fireEvent.click(panelButton);

    expect(onTogglePanel).toHaveBeenCalledOnce();
  });

  it("shows speed display text (default '10x')", () => {
    renderBottomBar();

    expect(screen.getByText("10x")).toBeTruthy();
  });

  it("speed selector changes engine speed", () => {
    const { engine } = renderBottomBar();

    // Click the speed button to open the popup
    const speedButton = screen.getByText("10x").closest("button")!;
    fireEvent.click(speedButton);

    // Select a different speed
    const option5x = screen.getByText("5x");
    fireEvent.click(option5x);

    expect(engine.playbackSpeed()).toBe(5);
  });

  it("displays total time from endFrame", () => {
    // frameCount=200, endFrame=199, captureDelayMs=1000: 199*1000=199000ms = 0:03:19
    renderBottomBar(200);

    // The time display shows "current / total" — total is based on endFrame
    expect(screen.getByText("0:03:19")).toBeTruthy();
  });
});
