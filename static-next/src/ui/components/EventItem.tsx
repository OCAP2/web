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
 * Map a side string to a CSS class for coloring.
 */
function sideClass(side?: string): string {
  if (!side) return "";
  switch (side.toLowerCase()) {
    case "west":
    case "blufor":
      return "side-blufor";
    case "east":
    case "opfor":
      return "side-opfor";
    case "guer":
    case "ind":
    case "independent":
      return "side-ind";
    case "civ":
    case "civilian":
      return "side-civ";
    default:
      return "";
  }
}

/**
 * Renders a single event item in the event log.
 *
 * Uses instanceof to determine event type:
 * - HitKilledEvent: shows victim, attacker, distance, weapon, time
 * - ConnectEvent: shows unit name + connected/disconnected
 *
 * Clicking an event seeks playback to that frame.
 */
export function EventItem(props: EventItemProps): JSX.Element {
  const event = props.event;
  const engine = props.engine;
  const time = formatElapsedTime(event.frameNum, engine.captureDelayMs());

  if (event instanceof HitKilledEvent) {
    const victimClass = sideClass(event.victimSide);
    const causerClass = sideClass(event.causerSide);

    return (
      <div
        class="event-item event-hit-killed"
        data-testid="event-item"
        data-event-type={event.type}
        onClick={() => {
          engine.seekTo(event.frameNum);
          engine.followEntity(event.victimId);
        }}
      >
        <span class="event-time" data-testid="event-time">
          {time}
        </span>
        <span class={`event-victim ${victimClass}`} data-testid="event-victim">
          {event.victimName ?? `Unit #${event.victimId}`}
        </span>
        <span class="event-action" data-testid="event-action">
          {event.type === "killed" ? " killed by " : " hit by "}
        </span>
        <span class={`event-causer ${causerClass}`} data-testid="event-causer">
          {event.causerName ?? `Unit #${event.causedById}`}
        </span>
        <span class="event-details" data-testid="event-details">
          {` (${event.weapon}, ${Math.round(event.distance)}m)`}
        </span>
      </div>
    );
  }

  if (event instanceof ConnectEvent) {
    return (
      <div
        class="event-item event-connect"
        data-testid="event-item"
        data-event-type={event.type}
        onClick={() => {
          engine.seekTo(event.frameNum);
        }}
      >
        <span class="event-time" data-testid="event-time">
          {time}
        </span>
        <span class="event-unit-name" data-testid="event-unit-name">
          {event.unitName}
        </span>
        <span class="event-connect-type" data-testid="event-connect-type">
          {event.type === "connected" ? " connected" : " disconnected"}
        </span>
      </div>
    );
  }

  // Fallback for unknown event types
  return (
    <div class="event-item" data-testid="event-item" data-event-type={event.type}>
      <span class="event-time" data-testid="event-time">
        {time}
      </span>
      <span>{event.type}</span>
    </div>
  );
}
