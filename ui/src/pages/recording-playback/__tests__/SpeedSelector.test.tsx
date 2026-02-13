import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { SpeedSelector } from "../components/SpeedSelector";
import { createTestEngine, TestProviders } from "./test-helpers";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderSpeedSelector() {
  const { engine, renderer } = createTestEngine();

  const result = render(() => (
    <TestProviders engine={engine} renderer={renderer}>
      <SpeedSelector />
    </TestProviders>
  ));

  return { engine, renderer, ...result };
}

describe("SpeedSelector", () => {
  it("shows current speed (default '10x')", () => {
    renderSpeedSelector();

    expect(screen.getByText("10x")).toBeTruthy();
  });

  it("opens dropdown showing all speed options on click", () => {
    renderSpeedSelector();

    // Dropdown should not be visible initially
    expect(screen.queryByText("1x")).toBeNull();

    // Click the speed button to open the popup
    const speedButton = screen.getByText("10x").closest("button")!;
    fireEvent.click(speedButton);

    // All speed options should now be visible
    expect(screen.getByText("1x")).toBeTruthy();
    expect(screen.getByText("2x")).toBeTruthy();
    expect(screen.getByText("5x")).toBeTruthy();
    expect(screen.getByText("20x")).toBeTruthy();
    expect(screen.getByText("30x")).toBeTruthy();
    expect(screen.getByText("60x")).toBeTruthy();
  });

  it("selecting a speed sets engine speed and closes dropdown", () => {
    const { engine } = renderSpeedSelector();

    // Open the popup
    const speedButton = screen.getByText("10x").closest("button")!;
    fireEvent.click(speedButton);

    // Select 5x
    const option5x = screen.getByText("5x");
    fireEvent.click(option5x);

    // Engine speed should be updated
    expect(engine.playbackSpeed()).toBe(5);

    // Dropdown should be closed (1x from dropdown should be gone)
    expect(screen.queryByText("1x")).toBeNull();
  });

  it("closes dropdown on outside click", () => {
    renderSpeedSelector();

    // Open the popup
    const speedButton = screen.getByText("10x").closest("button")!;
    fireEvent.click(speedButton);

    // Dropdown should be open
    expect(screen.getByText("1x")).toBeTruthy();

    // Click outside (dispatch pointerdown on document body)
    const event = new MouseEvent("pointerdown", { bubbles: true });
    document.dispatchEvent(event);

    // Dropdown should be closed
    expect(screen.queryByText("1x")).toBeNull();
  });
});
