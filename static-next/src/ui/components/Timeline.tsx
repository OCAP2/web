import type { JSX } from "solid-js";
import { useEngine } from "../hooks/useEngine";
import { formatElapsedTime } from "../../playback/time";

/**
 * Timeline slider showing current playback position.
 *
 * Displays a range input from 0 to endFrame with the current
 * frame position, plus formatted elapsed time at both ends.
 */
export function Timeline(): JSX.Element {
  const engine = useEngine();

  const handleInput: JSX.EventHandler<HTMLInputElement, InputEvent> = (e) => {
    engine.seekTo(parseInt(e.currentTarget.value, 10));
  };

  return (
    <div data-testid="timeline" class="timeline">
      <span data-testid="timeline-current-time" class="timeline-time">
        {formatElapsedTime(engine.currentFrame(), engine.captureDelayMs())}
      </span>
      <input
        type="range"
        class="timeline-slider"
        data-testid="timeline-slider"
        min={0}
        max={engine.endFrame()}
        value={engine.currentFrame()}
        onInput={handleInput}
      />
      <span data-testid="timeline-end-time" class="timeline-time">
        {formatElapsedTime(engine.endFrame(), engine.captureDelayMs())}
      </span>
    </div>
  );
}
