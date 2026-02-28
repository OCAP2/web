import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PlaybackEngine } from "../../../playback/engine";
import { MockRenderer } from "../../../renderers/mockRenderer";
import {
  registerShortcuts,
  unregisterShortcuts,
  leftPanelVisible,
  setLeftPanelVisible,
  setActivePanelTab,
} from "../shortcuts";

function createEngine(): PlaybackEngine {
  return new PlaybackEngine(new MockRenderer());
}

function fireKey(key: string, target?: EventTarget): void {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  // Override target if specified by dispatching on that element
  if (target) {
    (target as HTMLElement).dispatchEvent(event);
  } else {
    document.dispatchEvent(event);
  }
}

describe("shortcuts", () => {
  let engine: PlaybackEngine;

  beforeEach(() => {
    engine = createEngine();
    // Reset panel visibility signals to defaults
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

    // After unregister, keys should not trigger
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
});
