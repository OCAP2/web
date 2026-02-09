import type { JSX } from "solid-js";
import type { PlaybackEngine } from "../../playback/engine";
import { GameEvent } from "../../playback/events/game-event";
import { HitKilledEvent } from "../../playback/events/hit-killed-event";
import { ConnectEvent } from "../../playback/events/connect-event";
import { EndMissionEvent } from "../../playback/events/end-mission-event";
import { GeneralMissionEvent } from "../../playback/events/general-event";
import { CapturedEvent } from "../../playback/events/captured-event";
import { TerminalHackEvent } from "../../playback/events/terminal-hack-event";
import { formatElapsedTime } from "../../playback/time";
import styles from "./RightPanel.module.css";

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
    const actionText = event.type === "killed"
      ? (event.victimIsVehicle ? " destroyed by " : " killed by ")
      : " hit by ";

    return (
      <li
        class={`${styles.eventItem} reveal action`}
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
        {event.causerKillScore != null && !event.victimIsVehicle && (
          <span data-testid="event-kill-score"> ({event.causerKillScore} kills)</span>
        )}
        <div class={styles.eventDetails} data-testid="event-details">
          {`${time} - ${Math.round(event.distance)}m - ${event.weapon}`}
        </div>
      </li>
    );
  }

  if (event instanceof ConnectEvent) {
    return (
      <li
        class={`${styles.eventItem} reveal`}
        data-testid="event-item"
        data-event-type={event.type}
      >
        <span class="medium" data-testid="event-unit-name">
          {event.type === "connected" ? "connected " : "disconnected "}
          {event.unitName}
        </span>
        <div class={styles.eventDetails} data-testid="event-details">
          {time}
        </div>
      </li>
    );
  }

  if (event instanceof EndMissionEvent) {
    const sc = sideClass(event.side);
    return (
      <li
        class={`${styles.eventItem} reveal`}
        data-testid="event-item"
        data-event-type={event.type}
      >
        <span class={`${sc} bold`} data-testid="event-side">
          {event.side}.
        </span>{" "}
        <span class="medium" data-testid="event-message">{event.message}</span>
        <div class={styles.eventDetails} data-testid="event-details">
          {time}
        </div>
      </li>
    );
  }

  if (event instanceof GeneralMissionEvent) {
    return (
      <li
        class={`${styles.eventItem} reveal`}
        data-testid="event-item"
        data-event-type={event.type}
      >
        <span class="medium" data-testid="event-message">{event.message}</span>
        <div class={styles.eventDetails} data-testid="event-details">
          {time}
        </div>
      </li>
    );
  }

  if (event instanceof CapturedEvent) {
    return (
      <li
        class={`${styles.eventItem} reveal`}
        data-testid="event-item"
        data-event-type={event.type}
      >
        <span class="bold" data-testid="event-unit-name">{event.unitName}</span>{" "}
        <span class="medium">
          {event.objectType === "flag" ? "captured the flag" : `captured ${event.objectType}`}
        </span>
        <div class={styles.eventDetails} data-testid="event-details">
          {time}
        </div>
      </li>
    );
  }

  if (event instanceof TerminalHackEvent) {
    return (
      <li
        class={`${styles.eventItem} reveal`}
        data-testid="event-item"
        data-event-type={event.type}
      >
        <span class="bold" data-testid="event-unit-name">{event.unitName}</span>{" "}
        <span class="medium">
          {event.type === "terminalHackStarted" ? "is hacking terminal" : "interrupted hack"}
        </span>
        <div class={styles.eventDetails} data-testid="event-details">
          {time}
        </div>
      </li>
    );
  }

  // Fallback for unknown event types
  return (
    <li class={`${styles.eventItem} reveal`} data-testid="event-item" data-event-type={event.type}>
      <span>{event.type}</span>
      <div class={styles.eventDetails}>{time}</div>
    </li>
  );
}
