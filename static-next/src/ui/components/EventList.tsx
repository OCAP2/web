import { For } from "solid-js";
import type { JSX } from "solid-js";
import { useEngine } from "../hooks/useEngine";
import { HitKilledEvent } from "../../playback/events/hit-killed-event";
import { ConnectEvent } from "../../playback/events/connect-event";
import { EventItem } from "./EventItem";

export interface EventListProps {
  showHitEvents: boolean;
  showConnectEvents: boolean;
  filterText: string;
}

/**
 * Scrollable event list component.
 *
 * Subscribes to the engine's activeEvents() signal and renders events
 * in reverse chronological order (newest at top).
 * Filters by event type toggles and text search.
 */
export function EventList(props: EventListProps): JSX.Element {
  const engine = useEngine();

  const filteredEvents = () => {
    const all = engine.activeEvents();
    const text = props.filterText.toLowerCase();

    return all.filter((event) => {
      // Type filter
      if (!props.showHitEvents && (event instanceof HitKilledEvent)) return false;
      if (!props.showConnectEvents && (event instanceof ConnectEvent)) return false;

      // Text filter
      if (text) {
        if (event instanceof HitKilledEvent) {
          const haystack = `${event.victimName ?? ""} ${event.causerName ?? ""} ${event.weapon}`.toLowerCase();
          if (!haystack.includes(text)) return false;
        } else if (event instanceof ConnectEvent) {
          if (!event.unitName.toLowerCase().includes(text)) return false;
        }
      }

      return true;
    }).reverse();
  };

  return (
    <ul class="event-list" data-testid="event-list">
      <For each={filteredEvents()}>
        {(event) => <EventItem event={event} engine={engine} />}
      </For>
    </ul>
  );
}
