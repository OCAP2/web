import { createSignal } from "solid-js";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { BottomBar } from "../components/BottomBar";
import type { FocusRange } from "../components/FocusToolbar";
import type { TimeMode } from "../../../playback/time";
import {
  createTestEngine,
  TestProviders,
  makeManifest,
  unitDef,
  killedEvent,
} from "./testHelpers";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderBottomBar(endFrame = 199, opts?: {
  focusRange?: FocusRange | null;
  editingFocus?: boolean;
  isAdmin?: boolean;
  showFullTimeline?: boolean;
}) {
  const { engine, renderer } = createTestEngine();
  engine.loadRecording(makeManifest([], [], endFrame));

  const [panelOpen, setPanelOpen] = createSignal(true);
  const onTogglePanel = vi.fn(() => setPanelOpen((v) => !v));
  const [timeMode] = createSignal<TimeMode>("elapsed");
  const [focusRange] = createSignal<FocusRange | null>(opts?.focusRange ?? null);
  const [editingFocus] = createSignal(opts?.editingFocus ?? false);
  const [focusDraft] = createSignal<FocusRange | null>(opts?.editingFocus ? (opts?.focusRange ?? { inFrame: 0, outFrame: 199 }) : null);
  const [showFullTimeline] = createSignal(opts?.showFullTimeline ?? false);
  const [isAdmin] = createSignal(opts?.isAdmin ?? false);

  const onStartFocusEdit = vi.fn();
  const onSetIn = vi.fn();
  const onSetOut = vi.fn();
  const onClearFocus = vi.fn();
  const onCancelFocus = vi.fn();
  const onSaveFocus = vi.fn();
  const onToggleFullTimeline = vi.fn();

  const result = render(() => (
    <TestProviders engine={engine} renderer={renderer}>
      <BottomBar
        panelOpen={panelOpen}
        onTogglePanel={onTogglePanel}
        timeMode={timeMode}
        focusRange={focusRange}
        editingFocus={editingFocus}
        focusDraft={focusDraft}
        onDraftChange={vi.fn()}
        showFullTimeline={showFullTimeline}
        onToggleFullTimeline={onToggleFullTimeline}
        constrainToFocus={() => !showFullTimeline() && !editingFocus() && !!focusRange()}
        isAdmin={isAdmin}
        onStartFocusEdit={onStartFocusEdit}
        onSetIn={onSetIn}
        onSetOut={onSetOut}
        onClearFocus={onClearFocus}
        onCancelFocus={onCancelFocus}
        onSaveFocus={onSaveFocus}
      />
    </TestProviders>
  ));

  return { engine, renderer, onTogglePanel, onStartFocusEdit, onToggleFullTimeline, ...result };
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

  it("shows speed strip with default 10x active", () => {
    renderBottomBar();

    // All speed buttons are visible inline
    for (const speed of [1, 2, 5, 10, 20, 60]) {
      expect(screen.getByText(`${speed}×`)).toBeTruthy();
    }

    // Default speed (10x) has active class, others don't
    const activeBtn = screen.getByText("10×").closest("button")!;
    expect(activeBtn.className).toMatch(/speedBtnActive/);

    const inactiveBtn = screen.getByText("5×").closest("button")!;
    expect(inactiveBtn.className).not.toMatch(/speedBtnActive/);
  });

  it("speed strip button changes engine speed", () => {
    const { engine } = renderBottomBar();

    // Click a speed button directly (no popup needed)
    fireEvent.click(screen.getByText("5×"));

    expect(engine.playbackSpeed()).toBe(5);
  });

  it("displays total time from endFrame", () => {
    // endFrame=199, captureDelayMs=1000: 199*1000=199000ms = 0:03:19
    renderBottomBar(199);

    // The time display shows "current / total" — total is based on endFrame
    expect(screen.getByText("0:03:19")).toBeTruthy();
  });

  it("shows FocusToolbar when editingFocus is true", () => {
    renderBottomBar(199, { editingFocus: true, isAdmin: true });
    expect(screen.getByText("Focus Range")).toBeTruthy();
    expect(screen.getByText("Save")).toBeTruthy();
  });

  it("hides FocusToolbar when editingFocus is false", () => {
    renderBottomBar(200, { editingFocus: false });
    expect(screen.queryByText("Focus Range")).toBeNull();
  });

  it("shows Focus button when admin and not editing", () => {
    renderBottomBar(200, { isAdmin: true });
    expect(screen.getByText("Focus")).toBeTruthy();
  });

  it("hides Focus button when not admin", () => {
    renderBottomBar(200, { isAdmin: false });
    expect(screen.queryByText("Focus")).toBeNull();
  });

  it("Focus button calls onStartFocusEdit", () => {
    const { onStartFocusEdit } = renderBottomBar(200, { isAdmin: true });
    fireEvent.click(screen.getByText("Focus").closest("button")!);
    expect(onStartFocusEdit).toHaveBeenCalledOnce();
  });

  it("shows FOCUS toggle when focusRange is set and not editing", () => {
    renderBottomBar(200, { focusRange: { inFrame: 10, outFrame: 100 } });
    expect(screen.getByText("FOCUS")).toBeTruthy();
  });

  it("FOCUS toggle calls onToggleFullTimeline", () => {
    const { onToggleFullTimeline } = renderBottomBar(200, { focusRange: { inFrame: 10, outFrame: 100 } });
    fireEvent.click(screen.getByText("FOCUS"));
    expect(onToggleFullTimeline).toHaveBeenCalledOnce();
  });

  it("Focus button has active styling when focusRange exists", () => {
    renderBottomBar(200, { isAdmin: true, focusRange: { inFrame: 10, outFrame: 100 } });
    const btn = screen.getByText("Focus").closest("button")!;
    expect(btn.className).toMatch(/focusBtnActive/);
  });

  it("shows FULL text when showFullTimeline is true and focusRange exists", () => {
    renderBottomBar(200, { focusRange: { inFrame: 10, outFrame: 100 }, showFullTimeline: true });
    expect(screen.getByText("FULL")).toBeTruthy();
    expect(screen.queryByText("FOCUS")).toBeNull();
  });

  it("passes null focusRange to scrubber when showFullTimeline is true", () => {
    // When showFullTimeline is true, the scrubber should NOT show focus overlays
    renderBottomBar(200, { focusRange: { inFrame: 10, outFrame: 100 }, showFullTimeline: true });
    const track = screen.getByTestId("scrubber-track");
    // No dim overlays since focusRange is null for the scrubber
    expect(track.querySelector('[class*="focusDimOverlay"]')).toBeNull();
  });

  it("prev-kill button seeks to previous kill event", () => {
    const { engine, renderer } = createTestEngine();
    const entities = [
      unitDef({ id: 1, name: "V", side: "WEST", endFrame: 199 }),
      unitDef({ id: 2, name: "K", side: "EAST", endFrame: 199 }),
    ];
    const events = [
      killedEvent(30, 1, 2, "AK", 100),
      killedEvent(80, 2, 1, "M4", 200),
    ];
    engine.loadRecording(makeManifest(entities, events, 200));
    engine.seekTo(90); // after both kills

    const [panelOpen] = createSignal(true);
    const [timeMode] = createSignal<TimeMode>("elapsed");
    const [focusRange] = createSignal<FocusRange | null>(null);
    const [editingFocus] = createSignal(false);
    const [focusDraft] = createSignal<FocusRange | null>(null);
    const [showFullTimeline] = createSignal(false);
    const [isAdmin] = createSignal(false);

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <BottomBar
          panelOpen={panelOpen}
          onTogglePanel={vi.fn()}
          timeMode={timeMode}
          focusRange={focusRange}
          editingFocus={editingFocus}
          focusDraft={focusDraft}
          onDraftChange={vi.fn()}
          showFullTimeline={showFullTimeline}
          onToggleFullTimeline={vi.fn()}
          constrainToFocus={() => !showFullTimeline() && !editingFocus() && !!focusRange()}
          isAdmin={isAdmin}
          onStartFocusEdit={vi.fn()}
          onSetIn={vi.fn()}
          onSetOut={vi.fn()}
          onClearFocus={vi.fn()}
          onCancelFocus={vi.fn()}
          onSaveFocus={vi.fn()}
        />
      </TestProviders>
    ));

    const prevKillBtn = screen.getByTitle(/Previous kill event/i).closest("button")!;
    fireEvent.click(prevKillBtn);

    // Should seek to frame 80 (the kill just before frame 90)
    expect(engine.currentFrame()).toBe(80);
  });

  it("next-kill button seeks to next kill event", () => {
    const { engine, renderer } = createTestEngine();
    const entities = [
      unitDef({ id: 1, name: "V", side: "WEST", endFrame: 199 }),
      unitDef({ id: 2, name: "K", side: "EAST", endFrame: 199 }),
    ];
    const events = [
      killedEvent(30, 1, 2, "AK", 100),
      killedEvent(80, 2, 1, "M4", 200),
    ];
    engine.loadRecording(makeManifest(entities, events, 200));
    engine.seekTo(10); // before both kills

    const [panelOpen] = createSignal(true);
    const [timeMode] = createSignal<TimeMode>("elapsed");
    const [focusRange] = createSignal<FocusRange | null>(null);
    const [editingFocus] = createSignal(false);
    const [focusDraft] = createSignal<FocusRange | null>(null);
    const [showFullTimeline] = createSignal(false);
    const [isAdmin] = createSignal(false);

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <BottomBar
          panelOpen={panelOpen}
          onTogglePanel={vi.fn()}
          timeMode={timeMode}
          focusRange={focusRange}
          editingFocus={editingFocus}
          focusDraft={focusDraft}
          onDraftChange={vi.fn()}
          showFullTimeline={showFullTimeline}
          onToggleFullTimeline={vi.fn()}
          constrainToFocus={() => !showFullTimeline() && !editingFocus() && !!focusRange()}
          isAdmin={isAdmin}
          onStartFocusEdit={vi.fn()}
          onSetIn={vi.fn()}
          onSetOut={vi.fn()}
          onClearFocus={vi.fn()}
          onCancelFocus={vi.fn()}
          onSaveFocus={vi.fn()}
        />
      </TestProviders>
    ));

    const nextKillBtn = screen.getByTitle(/Next kill event/i).closest("button")!;
    fireEvent.click(nextKillBtn);

    // Should seek to frame 30 (the first kill after frame 10)
    expect(engine.currentFrame()).toBe(30);
  });
});
