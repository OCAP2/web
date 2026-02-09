import type { JSX } from "solid-js";
import { useEngine } from "../hooks/useEngine";
import { formatElapsedTime } from "../../playback/time";

/**
 * Play/pause button and timecode display.
 *
 * Left side of the controls row: play button + current/total time.
 */
export function PlaybackControls(): JSX.Element {
  const engine = useEngine();

  return (
    <div data-testid="playback-controls" class="playback-controls">
      <div
        data-testid="play-pause-button"
        class={`play-pause-btn ${engine.isPlaying() ? "playing" : ""}`}
        onClick={() => engine.togglePlayPause()}
      />
      <div data-testid="timecode-container" class="timecode-container">
        <span data-testid="timeline-current-time" class="timecode">
          {formatElapsedTime(engine.currentFrame(), engine.captureDelayMs())}
        </span>
        <span class="timecode-separator">/</span>
        <span data-testid="timeline-end-time" class="timecode">
          {formatElapsedTime(engine.endFrame(), engine.captureDelayMs())}
        </span>
      </div>
    </div>
  );
}
