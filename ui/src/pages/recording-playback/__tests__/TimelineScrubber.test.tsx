import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { TimelineScrubber } from "../components/TimelineScrubber";
import {
  createTestEngine,
  TestProviders,
  unitDef,
  makeManifest,
  killedEvent,
} from "./testHelpers";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderScrubber(
  entities = [unitDef()],
  events: Parameters<typeof makeManifest>[1] = [],
  frameCount = 100,
) {
  const { engine, renderer } = createTestEngine();
  engine.loadRecording(makeManifest(entities, events, frameCount));

  const result = render(() => (
    <TestProviders engine={engine} renderer={renderer}>
      <TimelineScrubber />
    </TestProviders>
  ));

  return { engine, renderer, ...result };
}

describe("TimelineScrubber", () => {
  it("renders scrubber track", () => {
    renderScrubber();

    expect(screen.getByTestId("scrubber-track")).toBeTruthy();
  });

  it("progress bar width is 0% at frame 0", () => {
    renderScrubber();

    const progress = screen.getByTestId("scrubber-progress");
    expect(progress.style.width).toBe("0%");
  });

  it("progress bar width updates when engine seeks", () => {
    // frameCount=100 -> endFrame=99, so 50/99*100 ~= 50.505%
    const { engine } = renderScrubber(
      [unitDef({ endFrame: 99 })],
      [],
      100,
    );

    engine.seekTo(50);

    const progress = screen.getByTestId("scrubber-progress");
    const width = parseFloat(progress.style.width);
    expect(width).toBeCloseTo((50 / 99) * 100, 1);
  });

  it("shows kill event markers on the timeline", () => {
    const entities = [
      unitDef({ id: 1, name: "Victim", side: "WEST" }),
      unitDef({ id: 2, name: "Killer", side: "EAST" }),
    ];
    const events = [
      killedEvent(10, 1, 2, "AK-47", 100),
      killedEvent(30, 2, 1, "M4A1", 200),
    ];

    renderScrubber(entities, events, 100);

    expect(screen.getAllByTestId("event-marker").length).toBe(2);
  });

  it("no event markers when no kill events exist", () => {
    renderScrubber([unitDef()], [], 100);

    expect(screen.queryAllByTestId("event-marker").length).toBe(0);
  });

  it("pointer down on track calls engine.seekTo", () => {
    const { engine } = renderScrubber([unitDef()], [], 100);
    const spy = vi.spyOn(engine, "seekTo");

    const track = screen.getByTestId("scrubber-track");

    // jsdom does not implement setPointerCapture — stub it on the element
    track.setPointerCapture = vi.fn();

    // Mock getBoundingClientRect so frameFromEvent can compute the frame
    vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
      left: 0,
      right: 200,
      width: 200,
      top: 0,
      bottom: 20,
      height: 20,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    fireEvent.pointerDown(track, { clientX: 100, pointerId: 1 });

    expect(spy).toHaveBeenCalled();
  });

  it("pauses playback during drag and resumes on pointer up", () => {
    const { engine } = renderScrubber(
      [unitDef({ endFrame: 99 })],
      [],
      100,
    );

    const track = screen.getByTestId("scrubber-track");
    track.setPointerCapture = vi.fn();
    vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
      left: 0, right: 200, width: 200,
      top: 0, bottom: 20, height: 20,
      x: 0, y: 0, toJSON: () => {},
    });

    // Start playing
    engine.play();
    expect(engine.isPlaying()).toBe(true);

    // Pointer down should pause
    fireEvent.pointerDown(track, { clientX: 50, pointerId: 1 });
    expect(engine.isPlaying()).toBe(false);

    // Pointer up should resume
    fireEvent.pointerUp(track, { pointerId: 1 });
    expect(engine.isPlaying()).toBe(true);
  });

  it("does not resume playback on pointer up if was not playing", () => {
    const { engine } = renderScrubber(
      [unitDef({ endFrame: 99 })],
      [],
      100,
    );

    const track = screen.getByTestId("scrubber-track");
    track.setPointerCapture = vi.fn();
    vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
      left: 0, right: 200, width: 200,
      top: 0, bottom: 20, height: 20,
      x: 0, y: 0, toJSON: () => {},
    });

    // Not playing
    expect(engine.isPlaying()).toBe(false);

    // Pointer down + up
    fireEvent.pointerDown(track, { clientX: 50, pointerId: 1 });
    fireEvent.pointerUp(track, { pointerId: 1 });

    // Should still not be playing
    expect(engine.isPlaying()).toBe(false);
  });
});
