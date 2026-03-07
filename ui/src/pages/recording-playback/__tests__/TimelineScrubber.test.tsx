import { createSignal } from "solid-js";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { TimelineScrubber } from "../components/TimelineScrubber";
import type { FocusRange } from "../components/FocusToolbar";
import {
  createTestEngine,
  TestProviders,
  unitDef,
  vehicleDef,
  makeManifest,
  killedEvent,
  hitEvent,
  connectEvent,
  endMissionEvent,
  generalEvent,
  capturedEvent,
  terminalHackEvent,
} from "./testHelpers";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderScrubber(
  entities = [unitDef()],
  events: Parameters<typeof makeManifest>[1] = [],
  endFrame = 99,
) {
  const { engine, renderer } = createTestEngine();
  engine.loadRecording(makeManifest(entities, events, endFrame));

  const [focusRange] = createSignal<FocusRange | null>(null);
  const [editingFocus] = createSignal(false);
  const [focusDraft] = createSignal<FocusRange | null>(null);
  const onDraftChange = vi.fn();

  const result = render(() => (
    <TestProviders engine={engine} renderer={renderer}>
      <TimelineScrubber
        focusRange={focusRange}
        editingFocus={editingFocus}
        focusDraft={focusDraft}
        onDraftChange={onDraftChange}
        constrainToFocus={() => false}
      />
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
    // endFrame=99, so 50/99*100 ~= 50.505%
    const { engine } = renderScrubber(
      [unitDef({ endFrame: 99 })],
      [],
      99,
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

  it("pointer move during drag calls engine.seekTo", () => {
    const { engine } = renderScrubber([unitDef({ endFrame: 99 })], [], 100);
    const spy = vi.spyOn(engine, "seekTo");

    const track = screen.getByTestId("scrubber-track");
    track.setPointerCapture = vi.fn();
    vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
      left: 0, right: 200, width: 200,
      top: 0, bottom: 20, height: 20,
      x: 0, y: 0, toJSON: () => {},
    });

    // Start drag
    fireEvent.pointerDown(track, { clientX: 50, pointerId: 1 });
    spy.mockClear();

    // Move while dragging
    fireEvent.pointerMove(track, { clientX: 150 });

    expect(spy).toHaveBeenCalled();
  });

  it("pointer move without drag does not call seekTo", () => {
    const { engine } = renderScrubber([unitDef({ endFrame: 99 })], [], 100);
    const spy = vi.spyOn(engine, "seekTo");

    const track = screen.getByTestId("scrubber-track");
    vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
      left: 0, right: 200, width: 200,
      top: 0, bottom: 20, height: 20,
      x: 0, y: 0, toJSON: () => {},
    });

    fireEvent.pointerMove(track, { clientX: 100 });

    expect(spy).not.toHaveBeenCalled();
  });

  it("hover tooltip appears on pointer move and disappears on leave", () => {
    renderScrubber([unitDef({ endFrame: 99 })], [], 100);

    const track = screen.getByTestId("scrubber-track");
    vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
      left: 0, right: 200, width: 200,
      top: 0, bottom: 20, height: 20,
      x: 0, y: 0, toJSON: () => {},
    });

    // No tooltip initially
    expect(track.querySelector('[class*="hoverTooltip"]')).toBeNull();

    // Move triggers tooltip
    fireEvent.pointerMove(track, { clientX: 100 });
    expect(track.querySelector('[class*="hoverTooltip"]')).not.toBeNull();

    // Leave clears tooltip
    fireEvent.pointerLeave(track);
    expect(track.querySelector('[class*="hoverTooltip"]')).toBeNull();
  });

  it("renders heatmap buckets when events exist", () => {
    const entities = [
      unitDef({ id: 1, name: "Victim", side: "WEST" }),
      unitDef({ id: 2, name: "Killer", side: "EAST" }),
    ];
    const events = [
      killedEvent(10, 1, 2, "AK-47", 100),
      hitEvent(20, 1, 2, "AK-47", 50),
    ];

    renderScrubber(entities, events, 100);

    const buckets = screen.getAllByTestId("heatmap-bucket");
    expect(buckets.length).toBeGreaterThan(0);
  });

  it("renders heatmap with other event segments", () => {
    const entities = [
      unitDef({ id: 1, name: "Player1", side: "WEST" }),
    ];
    const events = [
      connectEvent(10, "connected", "Player1"),
      connectEvent(20, "connected", "Player1"),
    ];

    renderScrubber(entities, events, 100);

    const buckets = screen.getAllByTestId("heatmap-bucket");
    expect(buckets.length).toBeGreaterThan(0);
    // "other" segments should be rendered (connect events are not HitKilledEvent)
    const otherSegment = buckets[0].querySelector('[class*="heatmapOther"]');
    expect(otherSegment).not.toBeNull();
  });

  it("applies past class to buckets before current frame", () => {
    const entities = [
      unitDef({ id: 1, name: "Victim", side: "WEST", endFrame: 99 }),
      unitDef({ id: 2, name: "Killer", side: "EAST", endFrame: 99 }),
    ];
    // Events spread across the timeline
    const events = [
      killedEvent(10, 1, 2, "AK-47", 100),
      killedEvent(80, 2, 1, "M4A1", 200),
    ];

    const { engine } = renderScrubber(entities, events, 100);
    engine.seekTo(50);

    const buckets = screen.getAllByTestId("heatmap-bucket");
    const pastBuckets = buckets.filter(b => b.className.includes("heatmapBucketPast"));
    const futureBuckets = buckets.filter(b => !b.className.includes("heatmapBucketPast"));
    expect(pastBuckets.length).toBeGreaterThan(0);
    expect(futureBuckets.length).toBeGreaterThan(0);
  });

  it("renders no heatmap buckets when no events exist", () => {
    renderScrubber([unitDef()], [], 100);

    expect(screen.queryAllByTestId("heatmap-bucket").length).toBe(0);
  });

  it("renders playhead line", () => {
    renderScrubber();

    const track = screen.getByTestId("scrubber-track");
    const playheadLine = track.querySelector('[class*="playheadLine"]');
    expect(playheadLine).not.toBeNull();
  });

  it("renders hover line on pointer move and hides on leave", () => {
    renderScrubber([unitDef({ endFrame: 99 })], [], 100);

    const track = screen.getByTestId("scrubber-track");
    vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
      left: 0, right: 200, width: 200,
      top: 0, bottom: 20, height: 20,
      x: 0, y: 0, toJSON: () => {},
    });

    // No hover line initially
    expect(track.querySelector('[class*="hoverLine"]')).toBeNull();

    // Pointer move shows hover line
    fireEvent.pointerMove(track, { clientX: 100 });
    expect(track.querySelector('[class*="hoverLine"]')).not.toBeNull();

    // Pointer leave hides hover line
    fireEvent.pointerLeave(track);
    expect(track.querySelector('[class*="hoverLine"]')).toBeNull();
  });
});

function renderScrubberWithFocus(
  focusRange: FocusRange | null,
  editing = false,
  focusDraftVal: FocusRange | null = null,
) {
  const { engine, renderer } = createTestEngine();
  engine.loadRecording(makeManifest(
    [unitDef({ id: 1, name: "V", side: "WEST", endFrame: 99 }), unitDef({ id: 2, name: "K", side: "EAST", endFrame: 99 })],
    [killedEvent(30, 1, 2, "AK", 100), killedEvent(70, 2, 1, "M4", 200)],
    100,
  ));

  const [focusSignal] = createSignal<FocusRange | null>(focusRange);
  const [editingFocus] = createSignal(editing);
  const [focusDraft] = createSignal<FocusRange | null>(focusDraftVal ?? (editing ? focusRange : null));
  const onDraftChange = vi.fn();

  const result = render(() => (
    <TestProviders engine={engine} renderer={renderer}>
      <TimelineScrubber
        focusRange={focusSignal}
        editingFocus={editingFocus}
        focusDraft={focusDraft}
        onDraftChange={onDraftChange}
        constrainToFocus={() => false}
      />
    </TestProviders>
  ));

  return { engine, renderer, onDraftChange, ...result };
}

describe("TimelineScrubber (focus overlays)", () => {
  it("renders dim overlays when focusRange is set", () => {
    renderScrubberWithFocus({ inFrame: 20, outFrame: 80 });
    const track = screen.getByTestId("scrubber-track");
    const overlays = track.querySelectorAll('[class*="focusDimOverlay"]');
    expect(overlays.length).toBe(2);
  });

  it("renders accent line in view mode", () => {
    renderScrubberWithFocus({ inFrame: 20, outFrame: 80 });
    const track = screen.getByTestId("scrubber-track");
    expect(track.querySelector('[class*="focusAccentLine"]')).not.toBeNull();
  });

  it("renders dashed border in edit mode", () => {
    renderScrubberWithFocus({ inFrame: 20, outFrame: 80 }, true);
    const track = screen.getByTestId("scrubber-track");
    expect(track.querySelector('[class*="focusBorderEditing"]')).not.toBeNull();
    expect(track.querySelector('[class*="focusAccentLine"]')).toBeNull();
  });

  it("renders focus ticks in view mode", () => {
    renderScrubberWithFocus({ inFrame: 20, outFrame: 80 });
    const track = screen.getByTestId("scrubber-track");
    const ticks = track.querySelectorAll('[class*="focusTick"]');
    expect(ticks.length).toBe(2);
  });

  it("hides focus ticks in edit mode", () => {
    renderScrubberWithFocus({ inFrame: 20, outFrame: 80 }, true);
    const track = screen.getByTestId("scrubber-track");
    expect(track.querySelectorAll('[class*="focusTick"]').length).toBe(0);
  });

  it("renders focus handles in edit mode", () => {
    renderScrubberWithFocus({ inFrame: 20, outFrame: 80 }, true);
    const track = screen.getByTestId("scrubber-track");
    const handleIn = track.querySelectorAll('[class*="focusHandleIn"]');
    const handleOut = track.querySelectorAll('[class*="focusHandleOut"]');
    expect(handleIn.length).toBe(1);
    expect(handleOut.length).toBe(1);
  });

  it("renders handle labels in edit mode", () => {
    renderScrubberWithFocus({ inFrame: 20, outFrame: 80 }, true);
    const track = screen.getByTestId("scrubber-track");
    const labels = track.querySelectorAll('[class*="focusHandleLabel"]');
    expect(labels.length).toBe(2);
  });

  it("no overlays or handles when focusRange is null", () => {
    renderScrubberWithFocus(null);
    const track = screen.getByTestId("scrubber-track");
    expect(track.querySelector('[class*="focusDimOverlay"]')).toBeNull();
    expect(track.querySelector('[class*="focusHandle"]')).toBeNull();
  });

  it("dims heatmap buckets outside focus range in view mode", () => {
    renderScrubberWithFocus({ inFrame: 40, outFrame: 60 });
    const buckets = screen.getAllByTestId("heatmap-bucket");
    const dimmed = buckets.filter(b => b.className.includes("heatmapBucketDimmed"));
    expect(dimmed.length).toBeGreaterThan(0);
  });
});

function renderConstrainedScrubber(
  focusRange: FocusRange,
  entities = [unitDef({ id: 1, name: "V", side: "WEST", endFrame: 99 }), unitDef({ id: 2, name: "K", side: "EAST", endFrame: 99 })],
  events: Parameters<typeof makeManifest>[1] = [],
  endFrame = 99,
) {
  const { engine, renderer } = createTestEngine();
  engine.loadRecording(makeManifest(entities, events, endFrame));

  const [focusSignal] = createSignal<FocusRange | null>(focusRange);
  const [editingFocus] = createSignal(false);
  const [focusDraft] = createSignal<FocusRange | null>(null);
  const onDraftChange = vi.fn();

  const result = render(() => (
    <TestProviders engine={engine} renderer={renderer}>
      <TimelineScrubber
        focusRange={focusSignal}
        editingFocus={editingFocus}
        focusDraft={focusDraft}
        onDraftChange={onDraftChange}
        constrainToFocus={() => true}
      />
    </TestProviders>
  ));

  return { engine, renderer, ...result };
}

describe("TimelineScrubber (constrained mode)", () => {
  it("progress maps to focus range when constrained", () => {
    // Focus range 20-80 on 100-frame recording, seek to frame 50 = midpoint = 50%
    const { engine } = renderConstrainedScrubber({ inFrame: 20, outFrame: 80 });
    engine.seekTo(50);

    const progress = screen.getByTestId("scrubber-progress");
    const width = parseFloat(progress.style.width);
    // (50-20)/(80-20)*100 = 50%
    expect(width).toBeCloseTo(50, 0);
  });

  it("progress at focus inFrame is 0%", () => {
    const { engine } = renderConstrainedScrubber({ inFrame: 20, outFrame: 80 });
    engine.seekTo(20);

    const progress = screen.getByTestId("scrubber-progress");
    const width = parseFloat(progress.style.width);
    expect(width).toBeCloseTo(0, 0);
  });

  it("progress at focus outFrame is 100%", () => {
    const { engine } = renderConstrainedScrubber({ inFrame: 20, outFrame: 80 });
    engine.seekTo(80);

    const progress = screen.getByTestId("scrubber-progress");
    const width = parseFloat(progress.style.width);
    expect(width).toBeCloseTo(100, 0);
  });

  it("does not render focus dim overlays when constrained", () => {
    renderConstrainedScrubber({ inFrame: 20, outFrame: 80 });
    const track = screen.getByTestId("scrubber-track");
    expect(track.querySelector('[class*="focusDimOverlay"]')).toBeNull();
  });

  it("filters kill markers outside focus range", () => {
    const entities = [
      unitDef({ id: 1, name: "V", side: "WEST", endFrame: 99 }),
      unitDef({ id: 2, name: "K", side: "EAST", endFrame: 99 }),
    ];
    const events = [
      killedEvent(10, 1, 2, "AK", 100),  // outside range (before 20)
      killedEvent(50, 2, 1, "M4", 200),   // inside range
    ];

    renderConstrainedScrubber({ inFrame: 20, outFrame: 80 }, entities, events, 100);

    // Only the event at frame 50 should render (frame 10 is outside 20-80)
    const markers = screen.queryAllByTestId("event-marker");
    expect(markers.length).toBe(1);
  });
});

describe("TimelineScrubber (hover tooltip deduplication)", () => {
  it("deduplicates vehicle hit events at the same frame", () => {
    const entities = [
      unitDef({ id: 1, name: "Gunner", side: "EAST", endFrame: 99 }),
      vehicleDef({ id: 50, name: "HMMWV", endFrame: 99 }),
    ];
    // Three hit events on the same vehicle at the same frame (one per crew member affected)
    const events = [
      hitEvent(50, 50, 1, "RPG-7", 200),
      hitEvent(50, 50, 1, "RPG-7", 200),
      hitEvent(50, 50, 1, "RPG-7", 200),
    ];

    renderScrubber(entities, events, 100);

    const track = screen.getByTestId("scrubber-track");
    vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
      left: 0, right: 200, width: 200,
      top: 0, bottom: 20, height: 20,
      x: 0, y: 0, toJSON: () => {},
    });

    // Hover near frame 50 (clientX=100 on a 200px-wide track with 100 frames ≈ frame 50)
    fireEvent.pointerMove(track, { clientX: 100 });

    const tooltipEvents = track.querySelectorAll('[data-testid="hover-tooltip-event"]');
    expect(tooltipEvents.length).toBe(1);
  });

  it("deduplicates same-victim hits at nearby frames", () => {
    const entities = [
      unitDef({ id: 1, name: "Gunner", side: "EAST", endFrame: 99 }),
      vehicleDef({ id: 50, name: "HMMWV", endFrame: 99 }),
    ];
    // Multiple hits on same vehicle at nearby (but not identical) frames
    const events = [
      hitEvent(49, 50, 1, "RPG-7", 200),
      hitEvent(50, 50, 1, "RPG-7", 200),
      hitEvent(51, 50, 1, "RPG-7", 200),
    ];

    renderScrubber(entities, events, 100);

    const track = screen.getByTestId("scrubber-track");
    vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
      left: 0, right: 200, width: 200,
      top: 0, bottom: 20, height: 20,
      x: 0, y: 0, toJSON: () => {},
    });

    fireEvent.pointerMove(track, { clientX: 100 });

    const tooltipEvents = track.querySelectorAll('[data-testid="hover-tooltip-event"]');
    expect(tooltipEvents.length).toBe(1);
  });

  it("caps each event type at 3 so other types remain visible", () => {
    const entities = [
      unitDef({ id: 1, name: "Attacker", side: "EAST", endFrame: 99 }),
      ...Array.from({ length: 8 }, (_, i) =>
        unitDef({ id: 10 + i, name: `Victim${i}`, side: "WEST", endFrame: 99 }),
      ),
    ];
    // 8 unique kills + 1 connect, all at frame 50
    const events = [
      ...Array.from({ length: 8 }, (_, i) =>
        killedEvent(50, 10 + i, 1, "AK-47", 100),
      ),
      connectEvent(50, "connected", "NewPlayer"),
    ];

    renderScrubber(entities, events, 100);

    const track = screen.getByTestId("scrubber-track");
    vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
      left: 0, right: 200, width: 200,
      top: 0, bottom: 20, height: 20,
      x: 0, y: 0, toJSON: () => {},
    });

    fireEvent.pointerMove(track, { clientX: 100 });

    const tooltipEvents = track.querySelectorAll('[data-testid="hover-tooltip-event"]');
    // 3 kills (capped) + 1 connect = 4, not 8+1=9
    expect(tooltipEvents.length).toBe(4);
  });

  it("enforces hard cap of 8 total entries across all types", () => {
    const entities = [
      unitDef({ id: 1, name: "Attacker", side: "EAST", endFrame: 99 }),
      ...Array.from({ length: 3 }, (_, i) =>
        unitDef({ id: 10 + i, name: `KillVictim${i}`, side: "WEST", endFrame: 99 }),
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        unitDef({ id: 20 + i, name: `HitVictim${i}`, side: "WEST", endFrame: 99 }),
      ),
    ];
    // 3 kills (at cap) + 3 hits (at cap) + 3 connects = 9, should be capped at 8
    const events = [
      ...Array.from({ length: 3 }, (_, i) =>
        killedEvent(50, 10 + i, 1, "AK-47", 100),
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        hitEvent(50, 20 + i, 1, "AK-47", 50),
      ),
      connectEvent(50, "connected", "Player1"),
      connectEvent(50, "connected", "Player2"),
      connectEvent(50, "connected", "Player3"),
    ];

    renderScrubber(entities, events, 100);

    const track = screen.getByTestId("scrubber-track");
    vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
      left: 0, right: 200, width: 200,
      top: 0, bottom: 20, height: 20,
      x: 0, y: 0, toJSON: () => {},
    });

    fireEvent.pointerMove(track, { clientX: 100 });

    const tooltipEvents = track.querySelectorAll('[data-testid="hover-tooltip-event"]');
    expect(tooltipEvents.length).toBe(8);
  });

  it("shows different victims as separate entries", () => {
    const entities = [
      unitDef({ id: 1, name: "Gunner", side: "EAST", endFrame: 99 }),
      unitDef({ id: 2, name: "Driver", side: "WEST", endFrame: 99 }),
      vehicleDef({ id: 50, name: "HMMWV", endFrame: 99 }),
    ];
    // Hit on vehicle AND hit on a different unit at the same frame
    const events = [
      hitEvent(50, 50, 1, "RPG-7", 200),
      hitEvent(50, 50, 1, "RPG-7", 200),
      hitEvent(50, 2, 1, "RPG-7", 200),
    ];

    renderScrubber(entities, events, 100);

    const track = screen.getByTestId("scrubber-track");
    vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
      left: 0, right: 200, width: 200,
      top: 0, bottom: 20, height: 20,
      x: 0, y: 0, toJSON: () => {},
    });

    fireEvent.pointerMove(track, { clientX: 100 });

    const tooltipEvents = track.querySelectorAll('[data-testid="hover-tooltip-event"]');
    // Should show HMMWV (deduped) + Driver = 2 entries, not 3
    expect(tooltipEvents.length).toBe(2);
  });

  it("renders all event types in tooltip", () => {
    const entities = [
      unitDef({ id: 1, name: "Attacker", side: "EAST", endFrame: 99 }),
      unitDef({ id: 2, name: "Victim", side: "WEST", endFrame: 99 }),
    ];
    const events = [
      killedEvent(50, 2, 1, "AK-47", 100),
      hitEvent(50, 2, 1, "AK-47", 50),
      connectEvent(50, "connected", "NewPlayer"),
      endMissionEvent(50, "WEST", "BLUFOR wins"),
      generalEvent(50, "Custom event"),
      capturedEvent(50, "Hacker", "Flag"),
      terminalHackEvent(50, "terminalHackStarted", "Hacker"),
    ];

    renderScrubber(entities, events, 100);

    const track = screen.getByTestId("scrubber-track");
    vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
      left: 0, right: 200, width: 200,
      top: 0, bottom: 20, height: 20,
      x: 0, y: 0, toJSON: () => {},
    });

    fireEvent.pointerMove(track, { clientX: 100 });

    const tooltipEvents = track.querySelectorAll('[data-testid="hover-tooltip-event"]');
    expect(tooltipEvents.length).toBe(7);
  });
});

describe("TimelineScrubber (handle dragging)", () => {
  function mockPointerCapture(container: HTMLElement) {
    // jsdom doesn't implement setPointerCapture — mock it on the track (parent of handles)
    const track = container.querySelector('[data-testid="scrubber-track"]') as HTMLElement;
    if (track && !track.setPointerCapture) {
      track.setPointerCapture = vi.fn();
      track.releasePointerCapture = vi.fn();
    }
  }

  it("pointerDown on in-handle sets draggingHandle state", () => {
    const { container } = renderScrubberWithFocus({ inFrame: 20, outFrame: 80 }, true);
    mockPointerCapture(container);
    const handle = container.querySelector('[class*="focusHandleIn"]')!;
    expect(handle).not.toBeNull();

    fireEvent.pointerDown(handle, { pointerId: 1 });
    expect(container.querySelector('[class*="focusHandleIn"]')).not.toBeNull();
  });

  it("pointerDown on out-handle sets draggingHandle state", () => {
    const { container } = renderScrubberWithFocus({ inFrame: 20, outFrame: 80 }, true);
    mockPointerCapture(container);
    const handle = container.querySelector('[class*="focusHandleOut"]')!;
    expect(handle).not.toBeNull();

    fireEvent.pointerDown(handle, { pointerId: 1 });
    expect(container.querySelector('[class*="focusHandleOut"]')).not.toBeNull();
  });

  it("dragging in-handle calls onDraftChange with updated inFrame", () => {
    const { container, onDraftChange } = renderScrubberWithFocus(
      { inFrame: 20, outFrame: 80 }, true,
    );
    mockPointerCapture(container);
    const track = screen.getByTestId("scrubber-track");
    const handle = container.querySelector('[class*="focusHandleIn"]')!;

    fireEvent.pointerDown(handle, { pointerId: 1 });

    vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
      left: 0, right: 100, width: 100, top: 0, bottom: 10, height: 10, x: 0, y: 0, toJSON: () => {},
    });

    fireEvent.pointerMove(track, { clientX: 30 });

    expect(onDraftChange).toHaveBeenCalled();
    const call = onDraftChange.mock.calls[0][0];
    expect(call.outFrame).toBe(80);
    expect(call.inFrame).toBeLessThan(80);
  });

  it("dragging out-handle calls onDraftChange with updated outFrame", () => {
    const { container, onDraftChange } = renderScrubberWithFocus(
      { inFrame: 20, outFrame: 80 }, true,
    );
    mockPointerCapture(container);
    const track = screen.getByTestId("scrubber-track");
    const handle = container.querySelector('[class*="focusHandleOut"]')!;

    fireEvent.pointerDown(handle, { pointerId: 1 });

    vi.spyOn(track, "getBoundingClientRect").mockReturnValue({
      left: 0, right: 100, width: 100, top: 0, bottom: 10, height: 10, x: 0, y: 0, toJSON: () => {},
    });

    fireEvent.pointerMove(track, { clientX: 60 });

    expect(onDraftChange).toHaveBeenCalled();
    const call = onDraftChange.mock.calls[0][0];
    expect(call.inFrame).toBe(20);
    expect(call.outFrame).toBeGreaterThan(20);
  });

  it("pointerUp after handle drag resets dragging state", () => {
    const { container, onDraftChange } = renderScrubberWithFocus(
      { inFrame: 20, outFrame: 80 }, true,
    );
    mockPointerCapture(container);
    const track = screen.getByTestId("scrubber-track");
    const handle = container.querySelector('[class*="focusHandleIn"]')!;

    fireEvent.pointerDown(handle, { pointerId: 1 });
    fireEvent.pointerUp(track);

    onDraftChange.mockClear();
    fireEvent.pointerMove(track, { clientX: 50 });
    expect(onDraftChange).not.toHaveBeenCalled();
  });
});
