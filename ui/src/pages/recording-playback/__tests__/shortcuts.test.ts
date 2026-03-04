import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PlaybackEngine } from "../../../playback/engine";
import { MockRenderer } from "../../../renderers/mockRenderer";
import {
  registerShortcuts,
  unregisterShortcuts,
  leftPanelVisible,
  setLeftPanelVisible,
  setActivePanelTab,
  setEditingFocusForShortcuts,
  setFocusShortcutCallbacks,
  stepBack,
  stepForward,
  seekToPrevKill,
  seekToNextKill,
  invalidateKillFrames,
} from "../shortcuts";
import { makeManifest, unitDef, killedEvent, hitEvent } from "./testHelpers";

function createEngine(): PlaybackEngine {
  return new PlaybackEngine(new MockRenderer());
}

function fireKey(
  key: string,
  target?: EventTarget,
  opts?: { shiftKey?: boolean },
): void {
  const event = new KeyboardEvent("keydown", {
    key,
    shiftKey: opts?.shiftKey ?? false,
    bubbles: true,
    cancelable: true,
  });
  if (target) {
    (target as HTMLElement).dispatchEvent(event);
  } else {
    document.dispatchEvent(event);
  }
}

/** Load a recording with kill events at given frames. */
function loadWithKills(engine: PlaybackEngine, killFrames: number[]): void {
  const entities = [
    unitDef({ id: 1, name: "A", endFrame: 499 }),
    unitDef({ id: 2, name: "B", endFrame: 499 }),
  ];
  const events = killFrames.map((f) => killedEvent(f, 2, 1));
  engine.loadRecording(makeManifest(entities, events, 500));
}

describe("shortcuts", () => {
  let engine: PlaybackEngine;

  beforeEach(() => {
    engine = createEngine();
    setLeftPanelVisible(true);
    setActivePanelTab("units");
  });

  afterEach(() => {
    unregisterShortcuts();
  });

  it("registerShortcuts registers a keydown handler", () => {
    const addSpy = vi.spyOn(document, "addEventListener");
    registerShortcuts(engine);
    expect(addSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
    addSpy.mockRestore();
  });

  it("Space key calls togglePlayPause", () => {
    const toggleSpy = vi.spyOn(engine, "togglePlayPause");
    registerShortcuts(engine);
    fireKey(" ");
    expect(toggleSpy).toHaveBeenCalledOnce();
  });

  it("'e' key toggles left panel signal", () => {
    registerShortcuts(engine);
    expect(leftPanelVisible()).toBe(true);
    fireKey("e");
    expect(leftPanelVisible()).toBe(false);
    fireKey("e");
    expect(leftPanelVisible()).toBe(true);
  });

  it("unregisterShortcuts removes handler", () => {
    const removeSpy = vi.spyOn(document, "removeEventListener");
    registerShortcuts(engine);
    unregisterShortcuts();
    expect(removeSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
    removeSpy.mockRestore();

    const toggleSpy = vi.spyOn(engine, "togglePlayPause");
    fireKey(" ");
    expect(toggleSpy).not.toHaveBeenCalled();
  });

  it("keys are ignored when target is an input element", () => {
    registerShortcuts(engine);
    const toggleSpy = vi.spyOn(engine, "togglePlayPause");

    const input = document.createElement("input");
    document.body.appendChild(input);
    fireKey(" ", input);
    expect(toggleSpy).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it("keys are ignored when target is a textarea element", () => {
    registerShortcuts(engine);
    const toggleSpy = vi.spyOn(engine, "togglePlayPause");

    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    fireKey(" ", textarea);
    expect(toggleSpy).not.toHaveBeenCalled();
    document.body.removeChild(textarea);
  });

  // ── Arrow key frame stepping ──

  it("ArrowLeft steps back 1 frame", () => {
    loadWithKills(engine, []);
    engine.seekTo(50);
    registerShortcuts(engine);

    fireKey("ArrowLeft");

    expect(engine.currentFrame()).toBe(49);
  });

  it("ArrowRight steps forward 1 frame", () => {
    loadWithKills(engine, []);
    engine.seekTo(50);
    registerShortcuts(engine);

    fireKey("ArrowRight");

    expect(engine.currentFrame()).toBe(51);
  });

  it("Shift+ArrowLeft steps back 10 frames", () => {
    loadWithKills(engine, []);
    engine.seekTo(50);
    registerShortcuts(engine);

    fireKey("ArrowLeft", undefined, { shiftKey: true });

    expect(engine.currentFrame()).toBe(40);
  });

  it("Shift+ArrowRight steps forward 10 frames", () => {
    loadWithKills(engine, []);
    engine.seekTo(50);
    registerShortcuts(engine);

    fireKey("ArrowRight", undefined, { shiftKey: true });

    expect(engine.currentFrame()).toBe(60);
  });

  it("ArrowLeft clamps at frame 0", () => {
    loadWithKills(engine, []);
    engine.seekTo(0);
    registerShortcuts(engine);

    fireKey("ArrowLeft");

    expect(engine.currentFrame()).toBe(0);
  });

  it("ArrowRight clamps at endFrame", () => {
    loadWithKills(engine, []);
    engine.seekTo(engine.endFrame());
    registerShortcuts(engine);

    fireKey("ArrowRight");

    expect(engine.currentFrame()).toBe(engine.endFrame());
  });

  it("arrow keys pause playback", () => {
    loadWithKills(engine, []);
    engine.seekTo(50);
    engine.play();
    registerShortcuts(engine);

    fireKey("ArrowLeft");

    expect(engine.isPlaying()).toBe(false);
  });

  // ── Kill event jumping via keyboard ──

  it("'.' jumps to next kill event", () => {
    loadWithKills(engine, [100, 200, 300]);
    engine.seekTo(50);
    registerShortcuts(engine);

    fireKey(".");

    expect(engine.currentFrame()).toBe(100);
  });

  it("',' jumps to previous kill event", () => {
    loadWithKills(engine, [100, 200, 300]);
    engine.seekTo(250);
    registerShortcuts(engine);

    fireKey(",");

    expect(engine.currentFrame()).toBe(200);
  });

  it("'.' does nothing when no next kill exists", () => {
    loadWithKills(engine, [100]);
    engine.seekTo(150);
    registerShortcuts(engine);

    fireKey(".");

    expect(engine.currentFrame()).toBe(150);
  });

  it("',' does nothing when no previous kill exists", () => {
    loadWithKills(engine, [100]);
    engine.seekTo(50);
    registerShortcuts(engine);

    fireKey(",");

    expect(engine.currentFrame()).toBe(50);
  });
});

// ── Direct function tests ──

describe("stepBack / stepForward", () => {
  it("stepBack pauses and seeks back n frames", () => {
    const engine = createEngine();
    loadWithKills(engine, []);
    engine.seekTo(50);

    stepBack(engine, 5);

    expect(engine.isPlaying()).toBe(false);
    expect(engine.currentFrame()).toBe(45);
  });

  it("stepForward pauses and seeks forward n frames", () => {
    const engine = createEngine();
    loadWithKills(engine, []);
    engine.seekTo(50);

    stepForward(engine, 5);

    expect(engine.isPlaying()).toBe(false);
    expect(engine.currentFrame()).toBe(55);
  });

  it("stepBack defaults to 1 frame", () => {
    const engine = createEngine();
    loadWithKills(engine, []);
    engine.seekTo(50);

    stepBack(engine);

    expect(engine.currentFrame()).toBe(49);
  });

  it("stepForward defaults to 1 frame", () => {
    const engine = createEngine();
    loadWithKills(engine, []);
    engine.seekTo(50);

    stepForward(engine);

    expect(engine.currentFrame()).toBe(51);
  });
});

describe("seekToPrevKill / seekToNextKill", () => {
  it("seekToNextKill seeks to next kill frame", () => {
    const engine = createEngine();
    loadWithKills(engine, [100, 200, 300]);
    engine.seekTo(150);
    invalidateKillFrames();

    seekToNextKill(engine);

    expect(engine.currentFrame()).toBe(200);
  });

  it("seekToPrevKill seeks to previous kill frame", () => {
    const engine = createEngine();
    loadWithKills(engine, [100, 200, 300]);
    engine.seekTo(250);
    invalidateKillFrames();

    seekToPrevKill(engine);

    expect(engine.currentFrame()).toBe(200);
  });

  it("seekToNextKill skips the current frame", () => {
    const engine = createEngine();
    loadWithKills(engine, [100, 200]);
    engine.seekTo(100);
    invalidateKillFrames();

    seekToNextKill(engine);

    expect(engine.currentFrame()).toBe(200);
  });

  it("seekToPrevKill skips the current frame", () => {
    const engine = createEngine();
    loadWithKills(engine, [100, 200]);
    engine.seekTo(200);
    invalidateKillFrames();

    seekToPrevKill(engine);

    expect(engine.currentFrame()).toBe(100);
  });

  it("seekToNextKill does nothing past last kill", () => {
    const engine = createEngine();
    loadWithKills(engine, [100]);
    engine.seekTo(150);
    invalidateKillFrames();

    seekToNextKill(engine);

    expect(engine.currentFrame()).toBe(150);
  });

  it("seekToPrevKill does nothing before first kill", () => {
    const engine = createEngine();
    loadWithKills(engine, [100]);
    engine.seekTo(50);
    invalidateKillFrames();

    seekToPrevKill(engine);

    expect(engine.currentFrame()).toBe(50);
  });

  it("getKillFrames uses cache on repeated calls with same engine", () => {
    const engine = createEngine();
    loadWithKills(engine, [100, 200]);
    engine.seekTo(50);
    invalidateKillFrames();

    seekToNextKill(engine);
    expect(engine.currentFrame()).toBe(100);

    // Second call without invalidating — should use cached frames
    engine.seekTo(50);
    seekToNextKill(engine);
    expect(engine.currentFrame()).toBe(100);
  });

  it("getKillFrames filters out non-killed events", () => {
    const engine = createEngine();
    const entities = [
      unitDef({ id: 1, name: "A", endFrame: 499 }),
      unitDef({ id: 2, name: "B", endFrame: 499 }),
    ];
    const events = [
      hitEvent(50, 2, 1),
      killedEvent(100, 2, 1),
      hitEvent(150, 2, 1),
      killedEvent(200, 2, 1),
    ];
    engine.loadRecording(makeManifest(entities, events, 500));
    engine.seekTo(0);
    invalidateKillFrames();

    // Should skip hit events at 50 and 150, jump to killed at 100
    seekToNextKill(engine);
    expect(engine.currentFrame()).toBe(100);

    seekToNextKill(engine);
    expect(engine.currentFrame()).toBe(200);
  });

  it("invalidateKillFrames forces rebuild from current events", () => {
    const engine = createEngine();
    // First load with no kills
    loadWithKills(engine, []);
    engine.seekTo(50);
    invalidateKillFrames();
    seekToNextKill(engine);
    expect(engine.currentFrame()).toBe(50); // no kills, stays put

    // Now reload with kills
    loadWithKills(engine, [100, 200]);
    engine.seekTo(50);
    invalidateKillFrames();
    seekToNextKill(engine);
    expect(engine.currentFrame()).toBe(100);
  });
});

// ── Focus editing shortcuts ──

describe("focus editing shortcuts", () => {
  let engine: PlaybackEngine;

  beforeEach(() => {
    engine = createEngine();
    loadWithKills(engine, []);
  });

  afterEach(() => {
    unregisterShortcuts();
    setEditingFocusForShortcuts(false);
    setFocusShortcutCallbacks({});
  });

  it("'i' calls onSetIn when editing focus", () => {
    const onSetIn = vi.fn();
    setEditingFocusForShortcuts(true);
    setFocusShortcutCallbacks({ onSetIn });
    registerShortcuts(engine);

    fireKey("i");

    expect(onSetIn).toHaveBeenCalledOnce();
  });

  it("'o' calls onSetOut when editing focus", () => {
    const onSetOut = vi.fn();
    setEditingFocusForShortcuts(true);
    setFocusShortcutCallbacks({ onSetOut });
    registerShortcuts(engine);

    fireKey("o");

    expect(onSetOut).toHaveBeenCalledOnce();
  });

  it("Escape calls onCancel when editing focus", () => {
    const onCancel = vi.fn();
    setEditingFocusForShortcuts(true);
    setFocusShortcutCallbacks({ onCancel });
    registerShortcuts(engine);

    fireKey("Escape");

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("'i' does nothing when not editing focus", () => {
    const onSetIn = vi.fn();
    setEditingFocusForShortcuts(false);
    setFocusShortcutCallbacks({ onSetIn });
    registerShortcuts(engine);

    fireKey("i");

    expect(onSetIn).not.toHaveBeenCalled();
  });

  it("'o' does nothing when not editing focus", () => {
    const onSetOut = vi.fn();
    setEditingFocusForShortcuts(false);
    setFocusShortcutCallbacks({ onSetOut });
    registerShortcuts(engine);

    fireKey("o");

    expect(onSetOut).not.toHaveBeenCalled();
  });
});
