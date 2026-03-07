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
import { SkullIcon, BulletIcon, LinkIcon, ClockIcon, TargetIcon, ActivityIcon } from "../../../components/Icons";
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

function eventIcon(event: GameEvent): JSX.Element {
  if (event instanceof HitKilledEvent) {
    return event.type === "killed"
      ? <SkullIcon size={16} />
      : <BulletIcon size={16} />;
  }
  if (event instanceof ConnectEvent) return <LinkIcon size={16} />;
  if (event instanceof EndMissionEvent) return <TargetIcon size={16} />;
  return <ActivityIcon size={16} />;
}

function eventColor(event: GameEvent): string {
  if (event instanceof HitKilledEvent) {
    return event.type === "killed" ? "var(--accent-danger)" : "var(--accent-warning)";
  }
  if (event instanceof ConnectEvent) {
    return event.type === "connected" ? "var(--accent-success)" : "#888";
  }
  if (event instanceof EndMissionEvent) return "var(--accent-purple)";
  return "#888";
}

export function EventsTab(): JSX.Element {
  const engine = useEngine();
  const { t } = useI18n();
  const [filterText, setFilterText] = createSignal("");
  const [showHits, setShowHits] = createSignal(false);
  const [showConnects, setShowConnects] = createSignal(false);

  const filteredEvents = createMemo(() => {
    const all = engine.activeEvents();
    const text = filterText().toLowerCase();

    const filtered = all.filter((event) => {
      // Type-based filtering
      if (event instanceof HitKilledEvent && event.type === "hit" && !showHits()) {
        return false;
      }
      if (event instanceof ConnectEvent && !showConnects()) {
        return false;
      }

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
        <button
          class={styles.filterToggle}
          classList={{
            [styles.filterToggleInactive]: !showHits(),
          }}
          style={showHits() ? {
            background: "rgba(255,74,74,0.15)",
            color: "var(--accent-danger)",
          } : undefined}
          onClick={() => setShowHits(!showHits())}
        >
          {t("hits")}
        </button>
        <button
          class={styles.filterToggle}
          classList={{
            [styles.filterToggleInactive]: !showConnects(),
          }}
          style={showConnects() ? {
            background: "rgba(45,212,160,0.15)",
            color: "var(--accent-success)",
          } : undefined}
          onClick={() => setShowConnects(!showConnects())}
        >
          {t("connections")}
        </button>
      </div>

      {/* Event list */}
      <div class={styles.tabContent}>
        <Show when={filteredEvents().length > 0} fallback={
          <div class={styles.placeholder}>{t("no_events")}</div>
        }>
          <For each={filteredEvents()}>
            {(event) => {
              const color = eventColor(event);
              return (
                <button
                  data-testid={`event-row-${event.frameNum}`}
                  class={`${styles.eventRow} ${styles.eventBorder}`}
                  style={{ "border-left-color": color }}
                  onClick={() => handleEventClick(event)}
                >
                  <span class={styles.eventIcon} style={{ color }}>
                    {eventIcon(event)}
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
                          {" \u2014 "}
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
