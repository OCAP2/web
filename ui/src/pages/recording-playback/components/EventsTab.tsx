import { createSignal, createMemo, For, Show } from "solid-js";
import type { JSX } from "solid-js";
import { useEngine } from "../../../hooks/useEngine";
import { useI18n } from "../../../hooks/useLocale";
import { HitKilledEvent } from "../../../playback/events/hitKilledEvent";
import { ConnectEvent } from "../../../playback/events/connectEvent";
import { EndMissionEvent } from "../../../playback/events/endMissionEvent";
import { GeneralMissionEvent } from "../../../playback/events/generalEvent";
import { CapturedEvent } from "../../../playback/events/capturedEvent";
import { TerminalHackEvent } from "../../../playback/events/terminalHackEvent";
import type { GameEvent } from "../../../playback/events/gameEvent";
import { SIDE_COLORS_UI } from "../../../config/sideColors";
import { formatElapsedTime } from "../../../playback/time";
import { SkullIcon, BulletIcon, LinkIcon, ClockIcon, DoorExitIcon, ActivityIcon, FlagIcon, AlertTriangleIcon, TerminalIcon } from "../../../components/Icons";
import { EventFilters, DEFAULT_EVENT_FILTERS } from "./EventFilters";
import type { EventFilterState } from "./EventFilters";
import styles from "./SidePanel.module.css";

function sideColor(side?: string): string {
  switch (side) {
    case "WEST": return SIDE_COLORS_UI.WEST;
    case "EAST": return SIDE_COLORS_UI.EAST;
    case "GUER": return SIDE_COLORS_UI.GUER;
    case "CIV": return SIDE_COLORS_UI.CIV;
    default: return "#888";
  }
}

function eventStyle(event: GameEvent): { icon: JSX.Element; color: string } {
  if (event instanceof HitKilledEvent) {
    return event.type === "killed"
      ? { icon: <SkullIcon size={16} />, color: "var(--accent-danger)" }
      : { icon: <BulletIcon size={16} />, color: "var(--accent-warning)" };
  }
  if (event instanceof ConnectEvent) {
    return { icon: <LinkIcon size={16} />, color: event.type === "connected" ? "var(--accent-success)" : "#888" };
  }
  if (event instanceof EndMissionEvent) {
    return { icon: <DoorExitIcon size={16} />, color: "var(--accent-purple)" };
  }
  if (event instanceof CapturedEvent) {
    return event.type === "contested"
      ? { icon: <AlertTriangleIcon size={16} />, color: "var(--accent-warning)" }
      : { icon: <FlagIcon size={16} />, color: "var(--accent-primary)" };
  }
  if (event instanceof TerminalHackEvent) {
    return { icon: <TerminalIcon size={16} />, color: "var(--accent-warning)" };
  }
  return { icon: <ActivityIcon size={16} />, color: "#888" };
}

export function EventsTab(): JSX.Element {
  const engine = useEngine();
  const { t } = useI18n();
  const [filterText, setFilterText] = createSignal("");
  const [filters, setFilters] = createSignal<EventFilterState>(DEFAULT_EVENT_FILTERS);

  const passesEventType = (event: GameEvent, f: EventFilterState): boolean => {
    if (event instanceof HitKilledEvent) {
      return event.type === "killed" ? f.showKills : f.showHits;
    }
    if (event instanceof ConnectEvent) return f.showConnections;
    if (event instanceof CapturedEvent) return f.showCaptures;
    if (event instanceof TerminalHackEvent) return f.showTerminalHacks;
    if (event instanceof EndMissionEvent || event instanceof GeneralMissionEvent) {
      return f.showMissionEvents;
    }
    return true;
  };

  const passesSideFilter = (event: GameEvent, f: EventFilterState): boolean => {
    if (f.sideFilter === "all") return true;
    // Side filter only applies to HitKilled events; everything else passes through.
    if (!(event instanceof HitKilledEvent)) return true;
    const ff = event.isFriendlyFire();
    if (f.sideFilter === "friendlyFireOnly") return ff;
    if (f.sideFilter === "hideFriendlyFire") return !ff;
    return true;
  };

  const filteredEvents = createMemo(() => {
    const all = engine.activeEvents();
    const text = filterText().toLowerCase();
    const f = filters();

    const filtered = all.filter((event) => {
      if (!passesEventType(event, f)) return false;
      if (!passesSideFilter(event, f)) return false;

      // Text search
      if (text) {
        if (event instanceof HitKilledEvent) {
          const haystack = [
            event.victimName ?? "",
            event.causerName ?? "",
            event.weapon ?? "",
          ].join(" ").toLowerCase();
          if (!haystack.includes(text)) return false;
        } else if (event instanceof ConnectEvent) {
          if (!event.unitName.toLowerCase().includes(text)) return false;
        } else if (event instanceof EndMissionEvent) {
          if (!event.message.toLowerCase().includes(text)) return false;
        } else if (event instanceof GeneralMissionEvent) {
          if (!event.message.toLowerCase().includes(text)) return false;
        } else if (event instanceof CapturedEvent) {
          if (!event.unitName.toLowerCase().includes(text)) return false;
        } else if (event instanceof TerminalHackEvent) {
          if (!event.unitName.toLowerCase().includes(text)) return false;
        }
      }

      return true;
    });

    // Newest first
    return filtered.slice().reverse();
  });

  const handleEventClick = (event: GameEvent) => {
    engine.seekTo(event.frameNum);
    if (event instanceof HitKilledEvent) {
      engine.panToEntity(event.victimId);
    } else if (event instanceof CapturedEvent && event.position) {
      engine.panToPosition(event.position);
    }
  };

  const timeStr = (frameNum: number): string => {
    return formatElapsedTime(frameNum, engine.captureDelayMs());
  };

  return (
    <>
      {/* Filter bar */}
      <div class={styles.filterBar}>
        <input
          class={styles.filterInput}
          type="text"
          placeholder={t("search_events")}
          value={filterText()}
          onInput={(e) => setFilterText(e.currentTarget.value)}
        />
        <EventFilters state={filters} setState={setFilters} />
      </div>

      {/* Event list */}
      <div class={styles.tabContent}>
        <Show when={filteredEvents().length > 0} fallback={
          <div class={styles.placeholder}>{t("no_events")}</div>
        }>
          <For each={filteredEvents()}>
            {(event) => {
              const { icon, color } = eventStyle(event);
              return (
                <button
                  data-testid={`event-row-${event.frameNum}`}
                  class={`${styles.eventRow} ${styles.eventBorder}`}
                  style={{ "border-left-color": color }}
                  onClick={() => handleEventClick(event)}
                >
                  <span class={styles.eventIcon} style={{ color }}>
                    {icon}
                  </span>
                  <span class={styles.eventContent}>
                    {event instanceof HitKilledEvent ? (
                      <>
                        <span class={styles.eventNames}>
                          <span style={{ color: sideColor(event.victimSide) }}>
                            {event.victimName ?? "Unknown"}
                          </span>
                          {event.victimId === event.causedById ? (
                            <>
                              {" "}
                              <span class={styles.eventArrow}>({t("suicide")})</span>
                            </>
                          ) : (
                            <>
                              {" "}
                              <span class={styles.eventArrow}>
                                {"\u2190"}
                              </span>
                              {" "}
                              <span style={{ color: sideColor(event.causerSide) }}>
                                {event.causerName ?? "Unknown"}
                              </span>
                            </>
                          )}
                        </span>
                        <span class={styles.eventMeta}>
                          <span class={styles.eventTime}>
                            <ClockIcon size={14} />
                            {timeStr(event.frameNum)}
                          </span>
                          <Show when={event.distance > 0}>
                            <span class={styles.eventDistance}>
                              {Math.round(event.distance)}m
                            </span>
                          </Show>
                          <Show when={event.weapon}>
                            <span class={styles.eventWeapon}>{event.weapon}</span>
                          </Show>
                        </span>
                      </>
                    ) : event instanceof ConnectEvent ? (
                      <>
                        <span class={styles.eventMessage}>
                          {event.unitName} {event.type === "connected" ? t("connected") : t("disconnected")}
                        </span>
                        <span class={styles.eventMeta}>
                          <span class={styles.eventTime}>
                            <ClockIcon size={14} />
                            {timeStr(event.frameNum)}
                          </span>
                        </span>
                      </>
                    ) : event instanceof EndMissionEvent ? (
                      <>
                        <span class={styles.eventNames}>
                          <span style={{ color: sideColor(event.side) }}>
                            {event.side}
                          </span>
                          <span style={{ color: "var(--text-secondary)" }}>{event.message}</span>
                        </span>
                        <span class={styles.eventMeta}>
                          <span class={styles.eventTime}>
                            <ClockIcon size={14} />
                            {timeStr(event.frameNum)}
                          </span>
                        </span>
                      </>
                    ) : event instanceof GeneralMissionEvent ? (
                      <>
                        <span class={styles.eventMessage}>{event.message}</span>
                        <span class={styles.eventMeta}>
                          <span class={styles.eventTime}>
                            <ClockIcon size={14} />
                            {timeStr(event.frameNum)}
                          </span>
                        </span>
                      </>
                    ) : event instanceof CapturedEvent ? (
                      <>
                        <span class={styles.eventMessage}>
                          {event.type === "capturedFlag"
                            ? <>{event.unitName} {t("captured")} {event.objectType}</>
                            : <>
                                {t("sector")} {event.unitName} {t(event.type)}
                                {event.side ? <> <span style={{ color: sideColor(event.side) }}>({event.side})</span></> : null}
                              </>
                          }
                        </span>
                        <span class={styles.eventMeta}>
                          <span class={styles.eventTime}>
                            <ClockIcon size={14} />
                            {timeStr(event.frameNum)}
                          </span>
                        </span>
                      </>
                    ) : event instanceof TerminalHackEvent ? (
                      <>
                        <span class={styles.eventMessage}>
                          {event.unitName} {event.type === "terminalHackStarted" ? "started hacking" : "canceled hack"}
                        </span>
                        <span class={styles.eventMeta}>
                          <span class={styles.eventTime}>
                            <ClockIcon size={14} />
                            {timeStr(event.frameNum)}
                          </span>
                        </span>
                      </>
                    ) : (
                      <>
                        <span class={styles.eventMessage}>Event</span>
                        <span class={styles.eventMeta}>
                          <span class={styles.eventTime}>
                            <ClockIcon size={14} />
                            {timeStr(event.frameNum)}
                          </span>
                        </span>
                      </>
                    )}
                  </span>
                </button>
              );
            }}
          </For>
        </Show>
      </div>
    </>
  );
}
