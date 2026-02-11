import { For } from "solid-js";
import type { JSX } from "solid-js";
import { useEngine } from "../hooks/useEngine";
import styles from "./BottomPanel.module.css";

/**
 * Full-width timeline slider row.
 *
 * Renders a range input spanning the entire bottom panel width,
 * with an event timeline bar behind it. Kill/hit events are shown
 * as red tick marks on the bar.
 */
export function Timeline(): JSX.Element {
  const engine = useEngine();

  const handleInput: JSX.EventHandler<HTMLInputElement, InputEvent> = (e) => {
    engine.seekTo(parseInt(e.currentTarget.value, 10));
  };

  const eventFrames = () => {
    const end = engine.endFrame();
    if (end === 0) return [];
    const events = engine.eventManager.getAll();
    return events.map((ev) => ev.frameNum);
  };

  return (
    <div data-testid="timeline" class={styles.frameSliderContainer}>
      <div class={styles.eventTimeline} data-testid="event-timeline">
        <For each={eventFrames()}>
          {(frameNum) => {
            const end = engine.endFrame();
            const pct = end > 0 ? (frameNum / end) * 100 : 0;
            const width = end > 0 ? (1 / end) * 100 : 0;
            return (
              <div
                class={styles.eventTimelineTick}
                data-testid="event-tick"
                style={{ left: `${pct}%`, width: `${Math.max(width, 0.2)}%` }}
              />
            );
          }}
        </For>
      </div>
      <input
        type="range"
        class={styles.frameSlider}
        data-testid="timeline-slider"
        min={0}
        max={engine.endFrame()}
        value={engine.currentFrame()}
        onInput={handleInput}
      />
    </div>
  );
}
