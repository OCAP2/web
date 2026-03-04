import { createSignal } from "solid-js";
import type { Side } from "../../data/types";
import type { PlaybackEngine } from "../../playback/engine";
import { HitKilledEvent } from "../../playback/events/hitKilledEvent";

// ─── UI panel visibility signals ───

export const [leftPanelVisible, setLeftPanelVisible] = createSignal(true);

/** Active tab in the side panel: "units" | "events" | "stats" | "chat" */
export const [activePanelTab, setActivePanelTab] = createSignal("units");

/** Currently selected side in the units tab — drives briefing marker filtering. */
export const [activeSide, setActiveSide] = createSignal<Side>("WEST");

// ─── Focus editing state (synced from RecordingPlayback, read by shortcut handler) ───

export const [editingFocusForShortcuts, setEditingFocusForShortcuts] = createSignal(false);
let focusCallbacks: {
  onSetIn?: () => void;
  onSetOut?: () => void;
  onCancel?: () => void;
} = {};

export function setFocusShortcutCallbacks(cbs: typeof focusCallbacks): void {
  focusCallbacks = cbs;
}

// ─── Shortcut handler ───

let handler: ((e: KeyboardEvent) => void) | null = null;

/** Cached sorted kill-event frame numbers, built lazily on first use. */
let killFrames: number[] | null = null;
let killFramesEngine: PlaybackEngine | null = null;

/**
 * Return sorted kill-frame list, building it on first call or when the
 * engine instance changes (i.e. a new recording was loaded).
 */
function getKillFrames(engine: PlaybackEngine): number[] {
  if (killFrames === null || killFramesEngine !== engine) {
    killFramesEngine = engine;
    const frames: number[] = [];
    for (const e of engine.eventManager.getAll()) {
      if (e instanceof HitKilledEvent && e.type === "killed") {
        frames.push(e.frameNum);
      }
    }
    frames.sort((a, b) => a - b);
    killFrames = frames;
  }
  return killFrames;
}

/** Invalidate kill-frame cache so it rebuilds from current events. */
export function invalidateKillFrames(): void {
  killFrames = null;
}

/**
 * Binary search for the first index where `predicate` returns true.
 * Returns `arr.length` if no element satisfies the predicate.
 */
function findFirst(arr: number[], predicate: (el: number) => boolean): number {
  let low = 0;
  let high = arr.length;
  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    if (predicate(arr[mid])) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }
  return low;
}

/** Seek to the previous kill event before the current frame (binary search). */
export function seekToPrevKill(engine: PlaybackEngine): void {
  const frames = getKillFrames(engine);
  const cur = engine.currentFrame();

  const index = findFirst(frames, (f) => f >= cur);
  const prevIndex = index - 1;
  if (prevIndex >= 0) {
    engine.seekTo(frames[prevIndex]);
  }
}

/** Seek to the next kill event after the current frame (binary search). */
export function seekToNextKill(engine: PlaybackEngine): void {
  const frames = getKillFrames(engine);
  const cur = engine.currentFrame();

  const index = findFirst(frames, (f) => f > cur);
  if (index < frames.length) {
    engine.seekTo(frames[index]);
  }
}

/** Step back by `n` frames, pausing playback first. */
export function stepBack(engine: PlaybackEngine, n = 1): void {
  engine.pause();
  engine.seekTo(engine.currentFrame() - n);
}

/** Step forward by `n` frames, pausing playback first. */
export function stepForward(engine: PlaybackEngine, n = 1): void {
  engine.pause();
  engine.seekTo(engine.currentFrame() + n);
}

/**
 * Register keyboard shortcuts on the document.
 * Only a single handler is registered; calling this again replaces the previous one.
 *
 * Shortcuts:
 * - Space: toggle play/pause
 * - 'e': toggle side panel visibility
 * - ArrowLeft / ArrowRight: step back/forward 1 frame
 * - Shift+ArrowLeft / Shift+ArrowRight: step back/forward 10 frames
 * - ',': jump to previous kill event
 * - '.': jump to next kill event
 *
 * Shortcuts are ignored when the active element is an input or textarea.
 */
export function registerShortcuts(engine: PlaybackEngine): void {
  // Remove previous handler if any
  unregisterShortcuts();

  // Invalidate cached kill frames so they rebuild from the new recording's events
  invalidateKillFrames();

  handler = (e: KeyboardEvent) => {
    // Ignore when typing in form elements
    const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") {
      return;
    }

    switch (e.key) {
      case "i":
        if (editingFocusForShortcuts()) {
          focusCallbacks.onSetIn?.();
        }
        break;
      case "o":
        if (editingFocusForShortcuts()) {
          focusCallbacks.onSetOut?.();
        }
        break;
      case "Escape":
        if (editingFocusForShortcuts()) {
          focusCallbacks.onCancel?.();
        }
        break;
      case " ":
        e.preventDefault();
        engine.togglePlayPause();
        break;
      case "e":
        setLeftPanelVisible((v) => !v);
        break;
      case "ArrowLeft":
        e.preventDefault();
        stepBack(engine, e.shiftKey ? 10 : 1);
        break;
      case "ArrowRight":
        e.preventDefault();
        stepForward(engine, e.shiftKey ? 10 : 1);
        break;
      case ",":
        seekToPrevKill(engine);
        break;
      case ".":
        seekToNextKill(engine);
        break;
    }
  };

  document.addEventListener("keydown", handler);
}

/**
 * Unregister the keyboard shortcut handler.
 */
export function unregisterShortcuts(): void {
  if (handler) {
    document.removeEventListener("keydown", handler);
    handler = null;
  }
}
