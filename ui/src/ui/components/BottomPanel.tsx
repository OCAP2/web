import type { JSX } from "solid-js";
import { Timeline } from "./Timeline";
import { PlaybackControls } from "./PlaybackControls";
import { ToggleBar } from "./ToggleBar";
import styles from "./BottomPanel.module.css";

/**
 * Bottom panel containing all playback controls.
 *
 * Two-row layout matching the old frontend:
 *   Row 1: Full-width timeline slider (with event tick overlay)
 *   Row 2: Play/pause + timecode (left) | toggles + speed (right)
 */
export function BottomPanel(): JSX.Element {
  return (
    <div data-testid="bottom-panel" class={styles.bottomPanel}>
      <Timeline />
      <div class={styles.bottomPanelControls}>
        <PlaybackControls />
        <ToggleBar />
      </div>
    </div>
  );
}
