import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import { CounterDisplay } from "../components/CounterDisplay";
import {
  createTestEngine,
  TestProviders,
  makeManifest,
} from "./testHelpers";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CounterDisplay", () => {
  it("is hidden when no counter state", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadOperation(makeManifest([], [], 100));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <CounterDisplay />
      </TestProviders>
    ));

    expect(screen.queryByTestId("counter-display")).toBeNull();
  });

  it("shows counter label", () => {
    const { engine, renderer } = createTestEngine();
    const events = [
      { type: "counterInit", frameNum: 0, data: [100, 80] } as any,
    ];
    engine.loadOperation(makeManifest([], events, 100));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <CounterDisplay />
      </TestProviders>
    ));

    const label = screen.getByTestId("counter-label");
    expect(label).toBeTruthy();
    expect(label.textContent).toBe("counterInit");
  });

  it("shows side values at frame 0", () => {
    const { engine, renderer } = createTestEngine();
    const events = [
      { type: "counterInit", frameNum: 0, data: [100, 80] } as any,
    ];
    engine.loadOperation(makeManifest([], events, 100));
    engine.seekTo(0);

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <CounterDisplay />
      </TestProviders>
    ));

    const side0 = screen.getByTestId("counter-side-0");
    expect(side0).toBeTruthy();
    expect(side0.textContent).toContain("100");

    const side1 = screen.getByTestId("counter-side-1");
    expect(side1).toBeTruthy();
    expect(side1.textContent).toContain("80");
  });

  it("updates values when seeking to a later frame", () => {
    const { engine, renderer } = createTestEngine();
    const events = [
      { type: "counterInit", frameNum: 0, data: [100, 80] } as any,
      { type: "counterSet", frameNum: 50, data: [90, 70] } as any,
    ];
    engine.loadOperation(makeManifest([], events, 100));
    engine.seekTo(0);

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <CounterDisplay />
      </TestProviders>
    ));

    // At frame 0 — initial values
    expect(screen.getByTestId("counter-side-0").textContent).toContain("100");
    expect(screen.getByTestId("counter-side-1").textContent).toContain("80");

    // Seek to frame 50 — updated values
    engine.seekTo(50);

    expect(screen.getByTestId("counter-side-0").textContent).toContain("90");
    expect(screen.getByTestId("counter-side-1").textContent).toContain("70");
  });

  it("shows correct data-testid attributes", () => {
    const { engine, renderer } = createTestEngine();
    const events = [
      { type: "counterInit", frameNum: 0, data: [100, 80] } as any,
    ];
    engine.loadOperation(makeManifest([], events, 100));
    engine.seekTo(0);

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <CounterDisplay />
      </TestProviders>
    ));

    expect(screen.getByTestId("counter-display")).toBeTruthy();
    expect(screen.getByTestId("counter-label")).toBeTruthy();
    expect(screen.getByTestId("counter-values")).toBeTruthy();
    expect(screen.getByTestId("counter-side-0")).toBeTruthy();
    expect(screen.getByTestId("counter-side-1")).toBeTruthy();
  });
});
