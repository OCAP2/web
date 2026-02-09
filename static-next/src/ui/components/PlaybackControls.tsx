import type { JSX } from "solid-js";
import { useEngine } from "../hooks/useEngine";

/**
 * Play/pause button and speed control.
 *
 * Subscribes to engine signals for reactive updates and delegates
 * all mutations back to the engine.
 */
export function PlaybackControls(): JSX.Element {
  const engine = useEngine();

  const handleSpeedInput: JSX.EventHandler<HTMLInputElement, InputEvent> = (
    e,
  ) => {
    engine.setSpeed(parseInt(e.currentTarget.value, 10));
  };

  return (
    <div data-testid="playback-controls" class="playback-controls">
      <button
        data-testid="play-pause-button"
        class="play-pause-button"
        onClick={() => engine.togglePlayPause()}
      >
        {engine.isPlaying() ? "Pause" : "Play"}
      </button>
      <div class="speed-control">
        <input
          type="range"
          data-testid="speed-slider"
          class="speed-slider"
          min={1}
          max={60}
          value={engine.playbackSpeed()}
          onInput={handleSpeedInput}
        />
        <span data-testid="speed-label" class="speed-label">
          {engine.playbackSpeed()}x
        </span>
      </div>
    </div>
  );
}
