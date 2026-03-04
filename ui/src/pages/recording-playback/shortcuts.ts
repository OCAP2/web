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
    killFrames = engine.eventManager
      .getAll()
      .filter((e) => e instanceof HitKilledEvent && e.type === "killed")
      .map((e) => e.frameNum)
      .sort((a, b) => a - b);
  }
  return killFrames;
}

/** Invalidate kill-frame cache so it rebuilds from current events. */
export function invalidateKillFrames(): void {
  killFrames = null;
}

/** Seek to the previous kill event before the current frame. */
export function seekToPrevKill(engine: PlaybackEngine): void {
  const frames = getKillFrames(engine);
  const cur = engine.currentFrame();
  for (let i = frames.length - 1; i >= 0; i--) {
    if (frames[i] < cur) {
      engine.seekTo(frames[i]);
      return;
    }
  }
}

/** Seek to the next kill event after the current frame. */
export function seekToNextKill(engine: PlaybackEngine): void {
  const frames = getKillFrames(engine);
  const cur = engine.currentFrame();
  for (const f of frames) {
    if (f > cur) {
      engine.seekTo(f);
      return;
    }
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
