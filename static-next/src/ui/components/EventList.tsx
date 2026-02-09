import { For } from "solid-js";
import type { JSX } from "solid-js";
import { useEngine } from "../hooks/useEngine";
import { EventItem } from "./EventItem";

/**
 * Scrollable event list component.
 *
 * Subscribes to the engine's activeEvents() signal and renders events
 * in reverse chronological order (newest at top).
 */
export function EventList(): JSX.Element {
  const engine = useEngine();

  const reversedEvents = () => [...engine.activeEvents()].reverse();

  return (
    <div class="event-list" data-testid="event-list">
      <For each={reversedEvents()}>
        {(event) => <EventItem event={event} engine={engine} />}
      </For>
    </div>
  );
}
