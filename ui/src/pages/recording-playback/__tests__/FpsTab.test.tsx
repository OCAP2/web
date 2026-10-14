import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { FpsTab } from "../components/FpsTab";
import type { EntityState, EventDef } from "../../../data/types";
import { createTestEngine, TestProviders, unitDef, makeManifest } from "./testHelpers";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const SAMPLES: EventDef[] = [
  { frameNum: 0, type: "serverFps", fps: 40 },
  { frameNum: 60, type: "serverFps", fps: 20 },
  { frameNum: 120, type: "serverFps", fps: 30 },
  { frameNum: 180, type: "serverFps", fps: 50 },
];

function alive(startFrame: number, endFrame: number): EntityState[] {
  return Array.from({ length: endFrame - startFrame + 1 }, () => ({
    position: [0, 0],
    direction: 0,
    alive: 1,
  }));
}

function renderTab(events: EventDef[] = SAMPLES, units = [unitDef({ id: 1, endFrame: 180, positions: alive(0, 180) })]) {
  const { engine, renderer } = createTestEngine();
  engine.loadRecording(makeManifest(units, events, 180));
  render(() => (
    <TestProviders engine={engine} renderer={renderer}>
      <FpsTab />
    </TestProviders>
  ));
  return engine;
}

describe("FpsTab", () => {
  // Current, average and median keep the Stats contract: everything up to the
  // playhead. The minimum is the worst moment of the whole recording, because
  // its job is to take the viewer there.
  it("shows playhead-scoped stats beside the recording's minimum", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(makeManifest([unitDef({ id: 1 })], SAMPLES, 180));
    engine.seekTo(120);

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <FpsTab />
      </TestProviders>
    ));

    for (const label of ["Current", "Average", "Median"]) {
      expect(screen.getByText(label).previousElementSibling?.textContent).toBe("30.0");
    }
    const minimum = screen.getByTitle("Jump to the lowest server FPS");
    expect(minimum.textContent).toContain("20.0");
    expect(minimum.textContent).toContain("at 0:01:00");
  });

  it("keeps the threshold colours on the stat tiles", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(makeManifest(
      [unitDef({ id: 1 })],
      [
        { frameNum: 0, type: "serverFps", fps: 10 },
        { frameNum: 10, type: "serverFps", fps: 25 },
        { frameNum: 20, type: "serverFps", fps: 80 },
      ],
      20,
    ));
    engine.seekTo(20);

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <FpsTab />
      </TestProviders>
    ));

    expect(screen.getByText("Current").previousElementSibling?.getAttribute("style"))
      .toContain("var(--accent-success)");
    expect(screen.getByText("Average").previousElementSibling?.getAttribute("style"))
      .toContain("var(--accent-warning)");
    expect(screen.getByText("Median").previousElementSibling?.getAttribute("style"))
      .toContain("rgb(255, 138, 61)");
    expect(screen.getByText("Minimum").previousElementSibling?.getAttribute("style"))
      .toContain("var(--accent-danger)");
  });

  it("moves the timeline to the minimum when it is clicked", () => {
    const engine = renderTab();
    expect(engine.currentFrame()).toBe(0);

    fireEvent.click(screen.getByTitle("Jump to the lowest server FPS"));

    expect(engine.currentFrame()).toBe(60);
  });

  it("lists the lowest moments and jumps to one when it is clicked", () => {
    const engine = renderTab();

    const rows = screen.getByText("Lowest moments").parentElement!.querySelectorAll("button");
    expect([...rows].map((row) => row.textContent)).toEqual([
      expect.stringContaining("20.0"),
      expect.stringContaining("30.0"),
      expect.stringContaining("40.0"),
      expect.stringContaining("50.0"),
    ]);

    fireEvent.click(rows[1]);
    expect(engine.currentFrame()).toBe(120);
  });

  // The graph is the timeline's twin: a click lands on the sample under the
  // pointer, which is the moment the crosshair and tooltip were describing.
  it("moves the timeline to the sample clicked on the graph", () => {
    const engine = renderTab();
    const graph = screen.getByRole("img", { name: "Server FPS over the mission" });
    // The plot runs between a 40px left and a 14px right gutter of the pane.
    const width = Number(graph.getAttribute("width"));
    const xFor = (frame: number) => 40 + ((width - 54) * frame) / 180;

    // Just past frame 120 still lands on the 120 sample.
    fireEvent.pointerDown(graph, { clientX: xFor(125), pointerId: 1 });
    expect(engine.currentFrame()).toBe(120);

    // Dragging keeps scrubbing.
    fireEvent.pointerMove(graph, { clientX: xFor(10), pointerId: 1 });
    expect(engine.currentFrame()).toBe(0);
    fireEvent.pointerUp(graph, { clientX: xFor(10), pointerId: 1 });

    // A plain hover afterwards only moves the crosshair.
    fireEvent.pointerMove(graph, { clientX: xFor(170), pointerId: 1 });
    expect(engine.currentFrame()).toBe(0);
    // The axis carries the same time label, so find the readout by its FPS row.
    const readout = screen.getAllByText("0:03:00")
      .map((time) => time.parentElement!)
      .find((parent) => parent.textContent?.includes("FPS"));
    expect(readout?.textContent).toContain("50.0");
  });

  it("explains a recording without samples instead of showing tiles", () => {
    renderTab([]);

    expect(screen.getByText(/no server FPS samples/)).toBeTruthy();
    expect(screen.queryByText("Current")).toBeNull();
    expect(screen.queryByTitle("Jump to the lowest server FPS")).toBeNull();
    // The population graph still works without FPS.
    expect(screen.getByRole("img", { name: "Alive units and vehicles over the mission" })).toBeTruthy();
  });

  it("correlates FPS with the population once the units are counted", async () => {
    // Four units drop out one by one while FPS climbs: a perfectly inverse
    // relationship.
    renderTab([
      { frameNum: 0, type: "serverFps", fps: 20 },
      { frameNum: 60, type: "serverFps", fps: 30 },
      { frameNum: 120, type: "serverFps", fps: 40 },
      { frameNum: 180, type: "serverFps", fps: 50 },
    ], [
      unitDef({ id: 1, endFrame: 180, positions: alive(0, 180) }),
      unitDef({ id: 2, endFrame: 30, positions: alive(0, 30) }),
      unitDef({ id: 3, endFrame: 90, positions: alive(0, 90) }),
      unitDef({ id: 4, endFrame: 150, positions: alive(0, 150) }),
    ]);

    // Every unit here is AI, so the AI row matches the Units row.
    const [units] = await screen.findAllByText("−1.00");
    expect(units.parentElement?.textContent).toContain("Units");
    expect(units.parentElement?.textContent).toContain("strong");
  });

  it("toggles a population series from its legend chip", () => {
    renderTab();

    const ai = screen.getAllByRole("button").find((button) => button.textContent?.startsWith("AI"))!;
    expect(ai.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(ai);
    expect(ai.getAttribute("aria-pressed")).toBe("true");
  });
});
