import { createSignal } from "solid-js";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { BottomBar } from "../components/BottomBar";
import {
  createTestEngine,
  TestProviders,
  makeManifest,
} from "./test-helpers";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderBottomBar(frameCount = 200) {
  const { engine, renderer } = createTestEngine();
  engine.loadOperation(makeManifest([], [], frameCount));

  const [panelOpen, setPanelOpen] = createSignal(true);
  const onTogglePanel = vi.fn(() => setPanelOpen((v) => !v));

  const result = render(() => (
    <TestProviders engine={engine} renderer={renderer}>
      <BottomBar panelOpen={panelOpen} onTogglePanel={onTogglePanel} />
    </TestProviders>
  ));

  return { engine, renderer, onTogglePanel, ...result };
}

describe("BottomBar", () => {
  it("play button calls togglePlayPause", () => {
    const { engine } = renderBottomBar();
    const spy = vi.spyOn(engine, "togglePlayPause");

    // The play button is the middle button in the center controls group.
    // Find all buttons, the play button is identifiable by its classList or position.
    const allButtons = screen.getAllByRole("button");
    // The play/pause button is in the center group, between skip-back and skip-forward.
    // We can identify it: it's the one that is NOT the Panel button, NOT a skip button,
    // NOT the speed button, NOT a dropdown button.
    // Easiest: find buttons and identify by the panel text, speed text, etc.
    // The play button is the only one with the playBtn class - but we can't query by class.
    // Instead, find the panel button and skip it; the center has 3 buttons (skip-back, play, skip-forward).
    const panelButton = screen.getByText("Panel").closest("button")!;
    const nonPanelButtons = allButtons.filter((b) => b !== panelButton);

    // Among center buttons: skip-back (index 0), play (index 1), skip-forward (index 2)
    // But we also have speed, time mode, and names buttons on the right.
    // The center buttons come after the panel button in DOM order.
    // Let's just find all buttons and pick the second one after panel (skip-back is first, play is second).
    // Actually, let's get them from the container more reliably.
    // Panel is in controlsLeft. Next group is controlsCenter with 3 buttons. Then controlsRight with speed + dropdowns.

    // The simplest: the play button is the 2nd button in the container after the panel button.
    const playButton = nonPanelButtons[1]; // skip-back=0, play=1
    fireEvent.click(playButton);

    expect(spy).toHaveBeenCalledOnce();
  });

  it("skip back button calls seekTo(0)", () => {
    const { engine } = renderBottomBar();
    engine.seekTo(50); // move away from 0
    const spy = vi.spyOn(engine, "seekTo");

    const allButtons = screen.getAllByRole("button");
    const panelButton = screen.getByText("Panel").closest("button")!;
    const nonPanelButtons = allButtons.filter((b) => b !== panelButton);

    const skipBackButton = nonPanelButtons[0];
    fireEvent.click(skipBackButton);

    expect(spy).toHaveBeenCalledWith(0);
  });

  it("skip forward button calls seekTo(endFrame)", () => {
    const { engine } = renderBottomBar(200);
    const spy = vi.spyOn(engine, "seekTo");

    const allButtons = screen.getAllByRole("button");
    const panelButton = screen.getByText("Panel").closest("button")!;
    const nonPanelButtons = allButtons.filter((b) => b !== panelButton);

    const skipForwardButton = nonPanelButtons[2];
    fireEvent.click(skipForwardButton);

    expect(spy).toHaveBeenCalledWith(engine.endFrame());
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
});
