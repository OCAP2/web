import { Show, For } from "solid-js";
import type { JSX } from "solid-js";
import { useEngine } from "../hooks/useEngine";
import { getCounterStateAtFrame } from "../../playback/events/counter-event";
import styles from "./CounterDisplay.module.css";

/**
 * Counter display component showing side-colored ticket counts.
 *
 * Hidden when `engine.counterState()` is null.
 * When active, shows the counter label and per-side values at the current frame.
 */
export function CounterDisplay(): JSX.Element {
  const engine = useEngine();

  const currentValues = () => {
    const state = engine.counterState();
    if (!state) return null;
    return getCounterStateAtFrame(state, engine.currentFrame());
  };

  return (
    <Show when={engine.counterState()}>
      {(state) => (
        <div data-testid="counter-display" class={styles.counterDisplay}>
          <span data-testid="counter-label" class="counter-label">
            {state().type}
          </span>
          <div data-testid="counter-values" class="counter-values">
            <Show when={currentValues()}>
              {(values) => (
                <For each={state().sides}>
                  {(side) => (
                    <span
                      data-testid={`counter-side-${side}`}
                      class={`counter-side counter-side-${side}`}
                    >
                      {side}: {values()[side] ?? 0}
                    </span>
                  )}
                </For>
              )}
            </Show>
          </div>
        </div>
      )}
    </Show>
  );
}
