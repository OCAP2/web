import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent } from "@solidjs/testing-library";
import { TimelineScrubber } from "../components/TimelineScrubber";
import {
  createTestEngine,
  TestProviders,
  unitDef,
  makeManifest,
  killedEvent,
} from "./test-helpers";

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
  engine.loadOperation(makeManifest(entities, events, frameCount));

  const result = render(() => (
    <TestProviders engine={engine} renderer={renderer}>
      <TimelineScrubber />
    </TestProviders>
  ));

  return { engine, renderer, ...result };
}

describe("TimelineScrubber", () => {
  it("renders scrubber track", () => {
    const { container } = renderScrubber();

    const track = container.querySelector('[class*="scrubberTrack"]');
    expect(track).toBeTruthy();
  });

  it("progress bar width is 0% at frame 0", () => {
    const { container } = renderScrubber();

    const progress = container.querySelector('[class*="scrubberProgress"]');
    expect(progress).toBeTruthy();
    expect((progress as HTMLElement).style.width).toBe("0%");
  });

  it("progress bar width updates when engine seeks", () => {
    // frameCount=100 -> endFrame=99, so 50/99*100 ~= 50.505%
    const { engine, container } = renderScrubber(
      [unitDef({ endFrame: 99 })],
      [],
      100,
    );

    engine.seekTo(50);

    const progress = container.querySelector('[class*="scrubberProgress"]');
    expect(progress).toBeTruthy();
    const width = parseFloat((progress as HTMLElement).style.width);
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

    const { container } = renderScrubber(entities, events, 100);

    const markers = container.querySelectorAll('[class*="eventMarker"]');
    expect(markers.length).toBe(2);
  });

  it("no event markers when no kill events exist", () => {
    const { container } = renderScrubber([unitDef()], [], 100);

    const markers = container.querySelectorAll('[class*="eventMarker"]');
    expect(markers.length).toBe(0);
  });

  it("pointer down on track calls engine.seekTo", () => {
    const { engine, container } = renderScrubber([unitDef()], [], 100);
    const spy = vi.spyOn(engine, "seekTo");

    const track = container.querySelector('[class*="scrubberTrack"]') as HTMLElement;
    expect(track).toBeTruthy();

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
});
