import { createSignal } from "solid-js";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { BottomBar } from "../components/BottomBar";
import type { Manifest } from "../../../data/types";
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
});

/** Render BottomBar with a custom manifest for testing time modes. */
function renderBottomBarWithManifest(manifest: Manifest) {
  const { engine, renderer } = createTestEngine();
  engine.loadRecording(manifest);

  const [panelOpen, setPanelOpen] = createSignal(true);
  const onTogglePanel = vi.fn(() => setPanelOpen((v) => !v));

  const result = render(() => (
    <TestProviders engine={engine} renderer={renderer}>
      <BottomBar panelOpen={panelOpen} onTogglePanel={onTogglePanel} />
    </TestProviders>
  ));

  return { engine, renderer, onTogglePanel, ...result };
}

describe("BottomBar - time mode dropdown", () => {
  it("opens and closes the time mode dropdown", () => {
    renderBottomBar();

    const timeModeButton = screen.getByText("Recording Time Elapsed").closest("button")!;

    // Dropdown should be closed initially — no "In-Game World Time" option visible
    expect(screen.queryByText("In-Game World Time")).toBeNull();

    // Open the dropdown
    fireEvent.click(timeModeButton);

    // All three time mode options should be visible (button text + dropdown option for "elapsed")
    expect(screen.getAllByText("Recording Time Elapsed").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("In-Game World Time")).toBeTruthy();
    expect(screen.getByText("Server Time UTC")).toBeTruthy();

    // Close by clicking the button again
    fireEvent.click(timeModeButton);

    // The dropdown options disappear (only the button text remains)
    // "In-Game World Time" only appears in the dropdown, not the button
    expect(screen.queryByText("In-Game World Time")).toBeNull();
  });

  it("selects a time mode and closes dropdown", () => {
    // Create manifest with mission date so "mission" mode is available
    const manifest = makeManifest([], [], 200);
    manifest.times = [
      {
        frameNum: 0,
        systemTimeUtc: "2024-01-15T12:00:00",
        date: "2035-06-10T05:30:00",
        timeMultiplier: 1,
      },
    ];
    renderBottomBarWithManifest(manifest);

    const timeModeButton = screen.getByText("Recording Time Elapsed").closest("button")!;

    // Open dropdown
    fireEvent.click(timeModeButton);

    // Click "In-Game World Time"
    const missionOption = screen.getAllByText("In-Game World Time").find(
      (el) => el.tagName === "BUTTON",
    )!;
    fireEvent.click(missionOption);

    // Dropdown should close
    expect(screen.queryByText("Server Time UTC")).toBeNull();

    // The button text should now show "In-Game World Time"
    expect(screen.getByText("In-Game World Time")).toBeTruthy();
  });

  it("disables 'system' time mode when no times array", () => {
    // Default manifest has empty times array
    renderBottomBar();

    const timeModeButton = screen.getByText("Recording Time Elapsed").closest("button")!;
    fireEvent.click(timeModeButton);

    // Find the "Server Time UTC" button in the dropdown
    const systemOption = screen.getAllByText("Server Time UTC").find(
      (el) => el.tagName === "BUTTON",
    )! as HTMLButtonElement;

    expect(systemOption.disabled).toBe(true);
  });

  it("disables 'mission' time mode when no missionDate", () => {
    // Default manifest has no times entries => no missionDate
    renderBottomBar();

    const timeModeButton = screen.getByText("Recording Time Elapsed").closest("button")!;
    fireEvent.click(timeModeButton);

    const missionOption = screen.getAllByText("In-Game World Time").find(
      (el) => el.tagName === "BUTTON",
    )! as HTMLButtonElement;

    expect(missionOption.disabled).toBe(true);
  });

  it("enables 'system' time mode when times array is populated", () => {
    const manifest = makeManifest([], [], 200);
    manifest.times = [
      { frameNum: 0, systemTimeUtc: "2024-01-15T12:00:00" },
      { frameNum: 100, systemTimeUtc: "2024-01-15T12:01:40" },
    ];
    renderBottomBarWithManifest(manifest);

    const timeModeButton = screen.getByText("Recording Time Elapsed").closest("button")!;
    fireEvent.click(timeModeButton);

    const systemOption = screen.getAllByText("Server Time UTC").find(
      (el) => el.tagName === "BUTTON",
    )! as HTMLButtonElement;

    expect(systemOption.disabled).toBe(false);
  });

  it("enables 'mission' time mode when missionDate is present", () => {
    const manifest = makeManifest([], [], 200);
    manifest.times = [
      {
        frameNum: 0,
        systemTimeUtc: "2024-01-15T12:00:00",
        date: "2035-06-10T05:30:00",
        timeMultiplier: 1,
      },
    ];
    renderBottomBarWithManifest(manifest);

    const timeModeButton = screen.getByText("Recording Time Elapsed").closest("button")!;
    fireEvent.click(timeModeButton);

    const missionOption = screen.getAllByText("In-Game World Time").find(
      (el) => el.tagName === "BUTTON",
    )! as HTMLButtonElement;

    expect(missionOption.disabled).toBe(false);
  });

  it("'elapsed' mode is always available", () => {
    renderBottomBar();

    const timeModeButton = screen.getByText("Recording Time Elapsed").closest("button")!;
    fireEvent.click(timeModeButton);

    const elapsedOption = screen.getAllByText("Recording Time Elapsed").find(
      (el) => el.tagName === "BUTTON" && el !== timeModeButton,
    )! as HTMLButtonElement;

    expect(elapsedOption.disabled).toBe(false);
  });

  it("displays total time from endFrame", () => {
    // frameCount=200, endFrame=199, captureDelayMs=1000: 199*1000=199000ms = 0:03:19
    renderBottomBar(200);

    // The time display shows "current / total" — total is based on endFrame
    expect(screen.getByText("0:03:19")).toBeTruthy();
  });

  it("closes time mode dropdown when clicking outside", () => {
    renderBottomBar();

    const timeModeButton = screen.getByText("Recording Time Elapsed").closest("button")!;
    fireEvent.click(timeModeButton);

    // Dropdown is open
    expect(screen.getByText("In-Game World Time")).toBeTruthy();

    // Click outside (on the container itself)
    fireEvent(document, new MouseEvent("pointerdown", { bubbles: true }));

    // Dropdown should close
    expect(screen.queryByText("In-Game World Time")).toBeNull();
  });
});

describe("BottomBar - names dropdown", () => {
  it("opens and closes the names dropdown", () => {
    renderBottomBar();

    const namesButton = screen.getByText("Players Only").closest("button")!;

    // Dropdown is closed
    expect(screen.queryByText("All Names")).toBeNull();

    // Open
    fireEvent.click(namesButton);

    // All name modes visible (button text + dropdown option for "players")
    expect(screen.getAllByText("Players Only").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("All Names")).toBeTruthy();
    expect(screen.getByText("Hide All")).toBeTruthy();

    // Close by clicking again
    fireEvent.click(namesButton);
    expect(screen.queryByText("All Names")).toBeNull();
  });

  it("selects 'All Names' mode and calls renderer.setNameDisplayMode", () => {
    const { renderer } = renderBottomBar();
    const spy = vi.spyOn(renderer, "setNameDisplayMode");

    const namesButton = screen.getByText("Players Only").closest("button")!;
    fireEvent.click(namesButton);

    const allOption = screen.getAllByText("All Names").find(
      (el) => el.tagName === "BUTTON",
    )!;
    fireEvent.click(allOption);

    expect(spy).toHaveBeenCalledWith("all");

    // Dropdown should close
    expect(screen.queryByText("Hide All")).toBeNull();

    // Button should now show "All Names"
    expect(screen.getByText("All Names")).toBeTruthy();
  });

  it("selects 'Hide All' mode and calls renderer.setNameDisplayMode", () => {
    const { renderer } = renderBottomBar();
    const spy = vi.spyOn(renderer, "setNameDisplayMode");

    const namesButton = screen.getByText("Players Only").closest("button")!;
    fireEvent.click(namesButton);

    const hideAllOption = screen.getAllByText("Hide All").find(
      (el) => el.tagName === "BUTTON",
    )!;
    fireEvent.click(hideAllOption);

    expect(spy).toHaveBeenCalledWith("none");

    // Button should now show "Hide All"
    expect(screen.getByText("Hide All")).toBeTruthy();
  });

  it("selects 'All Names' mode from default 'Players Only'", () => {
    const { renderer } = renderBottomBar();
    const spy = vi.spyOn(renderer, "setNameDisplayMode");

    const namesButton = screen.getByText("Players Only").closest("button")!;
    fireEvent.click(namesButton);
    const allOption = screen.getAllByText("All Names").find(
      (el) => el.tagName === "BUTTON",
    )!;
    fireEvent.click(allOption);

    expect(spy).toHaveBeenCalledWith("all");

    // Button should now show "All Names"
    expect(screen.getByText("All Names")).toBeTruthy();
  });

  it("closes names dropdown when clicking outside", () => {
    renderBottomBar();

    const namesButton = screen.getByText("Players Only").closest("button")!;
    fireEvent.click(namesButton);

    // Dropdown is open
    expect(screen.getByText("All Names")).toBeTruthy();

    // Click outside
    fireEvent(document, new MouseEvent("pointerdown", { bubbles: true }));

    // Dropdown should close
    expect(screen.queryByText("All Names")).toBeNull();
  });
});

describe("BottomBar - markers dropdown", () => {
  it("opens and closes the markers dropdown", () => {
    renderBottomBar();

    const markersButton = screen.getByText("All Markers").closest("button")!;

    // Dropdown is closed
    expect(screen.queryByText("Markers Only")).toBeNull();

    // Open
    fireEvent.click(markersButton);

    expect(screen.getAllByText("All Markers").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Markers Only")).toBeTruthy();
    expect(screen.getByText("Hide Markers")).toBeTruthy();

    // Close by clicking again
    fireEvent.click(markersButton);
    expect(screen.queryByText("Markers Only")).toBeNull();
  });

  it("selects 'Markers Only' and calls renderer.setMarkerDisplayMode", () => {
    const { renderer } = renderBottomBar();
    const spy = vi.spyOn(renderer, "setMarkerDisplayMode");

    const markersButton = screen.getByText("All Markers").closest("button")!;
    fireEvent.click(markersButton);

    const option = screen.getAllByText("Markers Only").find(
      (el) => el.tagName === "BUTTON",
    )!;
    fireEvent.click(option);

    expect(spy).toHaveBeenCalledWith("noLabels");
    expect(screen.queryByText("Hide Markers")).toBeNull();
    expect(screen.getByText("Markers Only")).toBeTruthy();
  });

  it("selects 'Hide Markers' and calls renderer.setMarkerDisplayMode", () => {
    const { renderer } = renderBottomBar();
    const spy = vi.spyOn(renderer, "setMarkerDisplayMode");

    const markersButton = screen.getByText("All Markers").closest("button")!;
    fireEvent.click(markersButton);

    const option = screen.getAllByText("Hide Markers").find(
      (el) => el.tagName === "BUTTON",
    )!;
    fireEvent.click(option);

    expect(spy).toHaveBeenCalledWith("none");
    expect(screen.getByText("Hide Markers")).toBeTruthy();
  });

  it("closes markers dropdown when clicking outside", () => {
    renderBottomBar();

    const markersButton = screen.getByText("All Markers").closest("button")!;
    fireEvent.click(markersButton);

    expect(screen.getByText("Markers Only")).toBeTruthy();

    fireEvent(document, new MouseEvent("pointerdown", { bubbles: true }));

    expect(screen.queryByText("Markers Only")).toBeNull();
  });
});
