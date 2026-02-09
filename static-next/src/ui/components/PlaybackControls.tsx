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
    <div data-testid="playback-controls" style={{ display: "flex", "align-items": "center", gap: "10px" }}>
      <button
        data-testid="play-pause-button"
        class="play-pause-btn"
        onClick={() => engine.togglePlayPause()}
        style={{ background: "none", border: "1px solid #888", color: "#f2f2f2", padding: "4px 12px", cursor: "pointer" }}
      >
        {engine.isPlaying() ? "Pause" : "Play"}
      </button>
      <div class="speed-slider-container">
        <span data-testid="speed-label" class="speed-value">
          {engine.playbackSpeed()}x
        </span>
        <input
          type="range"
          data-testid="speed-slider"
          class="speed-slider"
          min={1}
          max={60}
          value={engine.playbackSpeed()}
          onInput={handleSpeedInput}
        />
      </div>
    </div>
  );
}
