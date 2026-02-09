import type { JSX } from "solid-js";
import { Timeline } from "./Timeline";
import { PlaybackControls } from "./PlaybackControls";
import { ToggleBar } from "./ToggleBar";

/**
 * Bottom panel containing all playback controls.
 *
 * Positioned at the bottom of the viewport, renders the
 * Timeline, PlaybackControls, and ToggleBar components.
 */
export function BottomPanel(): JSX.Element {
  return (
    <div data-testid="bottom-panel" class="bottom-panel">
      <PlaybackControls />
      <Timeline />
      <ToggleBar />
    </div>
  );
}
