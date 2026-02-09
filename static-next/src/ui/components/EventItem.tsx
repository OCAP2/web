import type { JSX } from "solid-js";
import type { PlaybackEngine } from "../../playback/engine";
import { GameEvent } from "../../playback/events/game-event";
import { HitKilledEvent } from "../../playback/events/hit-killed-event";
import { ConnectEvent } from "../../playback/events/connect-event";
import { formatElapsedTime } from "../../playback/time";

export interface EventItemProps {
  event: GameEvent;
  engine: PlaybackEngine;
}

/**
 * Map a side string to the old frontend's CSS class.
 */
function sideClass(side?: string): string {
  if (!side) return "";
  switch (side.toLowerCase()) {
    case "west":
    case "blufor":
      return "blufor";
    case "east":
    case "opfor":
      return "opfor";
    case "guer":
    case "ind":
    case "independent":
      return "ind";
    case "civ":
    case "civilian":
      return "civ";
    default:
      return "";
  }
}

/**
 * Renders a single event item in the event log.
 *
 * Layout matches old frontend:
 *   Line 1: VictimName  killed by  AttackerName
 *   Line 2: time - distance - weapon  (gray, smaller)
 */
export function EventItem(props: EventItemProps): JSX.Element {
  const event = props.event;
  const engine = props.engine;
  const time = formatElapsedTime(event.frameNum, engine.captureDelayMs());

  if (event instanceof HitKilledEvent) {
    const victimClass = sideClass(event.victimSide);
    const causerClass = sideClass(event.causerSide);
    const actionText = event.type === "killed" ? " killed by " : " hit by ";

    return (
      <li
        class="event-item reveal action"
        data-testid="event-item"
        data-event-type={event.type}
        onClick={() => {
          engine.seekTo(event.frameNum);
          engine.followEntity(event.victimId);
        }}
      >
        <span class={`${victimClass} bold`} data-testid="event-victim">
          {event.victimName ?? `Unit #${event.victimId}`}
        </span>
        <span data-testid="event-action">{actionText}</span>
        <span class={`${causerClass} medium`} data-testid="event-causer">
          {event.causerName ?? `Unit #${event.causedById}`}
        </span>
        <div class="event-details" data-testid="event-details">
          {`${time} - ${Math.round(event.distance)}m - ${event.weapon}`}
        </div>
      </li>
    );
  }

  if (event instanceof ConnectEvent) {
    return (
      <li
        class="event-item reveal"
        data-testid="event-item"
        data-event-type={event.type}
      >
        <span class="medium" data-testid="event-unit-name">
          {event.type === "connected" ? "connected " : "disconnected "}
          {event.unitName}
        </span>
        <div class="event-details" data-testid="event-details">
          {time}
        </div>
      </li>
    );
  }

  // Fallback for unknown event types
  return (
    <li class="event-item reveal" data-testid="event-item" data-event-type={event.type}>
      <span>{event.type}</span>
      <div class="event-details">{time}</div>
    </li>
  );
}
