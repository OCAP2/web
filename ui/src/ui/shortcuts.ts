import { createSignal } from "solid-js";
import type { PlaybackEngine } from "../playback/engine";

// ─── UI panel visibility signals ───

export const [leftPanelVisible, setLeftPanelVisible] = createSignal(true);

/** Active tab in the side panel: "units" | "events" | "stats" | "chat" */
export const [activePanelTab, setActivePanelTab] = createSignal("units");

// ─── Shortcut handler ───

let handler: ((e: KeyboardEvent) => void) | null = null;

/**
 * Register keyboard shortcuts on the document.
 * Only a single handler is registered; calling this again replaces the previous one.
 *
 * Shortcuts:
 * - Space: toggle play/pause
 * - 'e': toggle side panel visibility
 * - 'r': toggle events tab (open panel → events if closed or on another tab; close if already on events)
 *
 * Shortcuts are ignored when the active element is an input or textarea.
 */
export function registerShortcuts(engine: PlaybackEngine): void {
  // Remove previous handler if any
  unregisterShortcuts();

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
      case "r":
        if (!leftPanelVisible()) {
          // Panel closed → open it and switch to events
          setLeftPanelVisible(true);
          setActivePanelTab("events");
        } else if (activePanelTab() === "events") {
          // Panel open on events → close it
          setLeftPanelVisible(false);
        } else {
          // Panel open on another tab → switch to events
          setActivePanelTab("events");
        }
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
