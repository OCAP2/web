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
import { PlayerSnapshotEvent } from "../../../playback/events/playerSnapshotEvent";
import { ZeusModuleEvent, ZeusPingEvent } from "../../../playback/events/zeusEvents";
import {
  ExplosionEvent,
  RadioTransmissionEvent,
  ServiceEvent,
  StaticWeaponEvent,
} from "../../../playback/events/supportEvents";
import { formatNet } from "../../../playback/comms";
import type { GameEvent } from "../../../playback/events/gameEvent";
import { SIDE_COLORS_UI } from "../../../config/sideColors";
import { formatElapsedTime } from "../../../playback/time";
import { SkullIcon, BulletIcon, LinkIcon, ClockIcon, DoorExitIcon, ActivityIcon, FlagIcon, AlertTriangleIcon, TerminalIcon, TargetIcon, ExplosionIcon, WrenchIcon, StaticWeaponIcon, RadioIcon, ZapIcon } from "../../../components/Icons";
import { EventFilters, DEFAULT_EVENT_FILTERS, DEFAULT_FACTION_FILTER, allFactionsEnabled } from "./EventFilters";
import type { EventFilterState } from "./EventFilters";
import type { Side } from "../../../data/types";
import type { PlaybackEngine } from "../../../playback/engine";
import styles from "./SidePanel.module.css";

function sideColor(side?: string): string {
  switch (side) {
    case "WEST": return SIDE_COLORS_UI.WEST;
    case "EAST": return SIDE_COLORS_UI.EAST;
    case "GUER": return SIDE_COLORS_UI.GUER;
    case "CIV": return SIDE_COLORS_UI.CIV;
    case "VIRTUAL": return SIDE_COLORS_UI.VIRTUAL;
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
  if (event instanceof ZeusPingEvent) {
    return { icon: <TargetIcon size={16} />, color: SIDE_COLORS_UI.VIRTUAL };
  }
  if (event instanceof ZeusModuleEvent) {
    return { icon: <ZapIcon size={16} />, color: SIDE_COLORS_UI.VIRTUAL };
  }
  if (event instanceof ExplosionEvent) {
    return { icon: <ExplosionIcon size={16} />, color: "var(--accent-warning)" };
  }
  if (event instanceof ServiceEvent) {
    return { icon: <WrenchIcon size={16} />, color: "var(--accent-success)" };
  }
  if (event instanceof StaticWeaponEvent) {
    return { icon: <StaticWeaponIcon size={16} />, color: "var(--accent-primary)" };
  }
  if (event instanceof RadioTransmissionEvent) {
    return { icon: <RadioIcon size={16} />, color: "var(--accent-purple)" };
  }
  return { icon: <ActivityIcon size={16} />, color: "#888" };
}

/** Sides an event belongs to. Empty means the event has no faction and always passes. */
export function eventInvolvedSides(event: GameEvent, engine: PlaybackEngine): string[] {
  if (event instanceof HitKilledEvent) {
    return [event.victimSide, event.causerSide].filter((s): s is string => !!s);
  }
  if (event instanceof EndMissionEvent) return event.side ? [event.side] : [];
  if (event instanceof CapturedEvent) return event.side ? [event.side] : [];
  if (event instanceof ZeusPingEvent) return event.payload.side ? [event.payload.side] : [];
  if (event instanceof ZeusModuleEvent) return ["VIRTUAL"];
  if (event instanceof ExplosionEvent) return event.payload.side ? [event.payload.side] : [];
  if (event instanceof ServiceEvent) return event.payload.side ? [event.payload.side] : [];
  if (event instanceof StaticWeaponEvent) return event.payload.side ? [event.payload.side] : [];
  if (event instanceof RadioTransmissionEvent) {
    const side = engine.getEventSideAt(event.unitId, event.frameNum);
    return side ? [side] : [];
  }
  return [];
}

export function EventsTab(): JSX.Element {
  const engine = useEngine();
  const { t } = useI18n();
  const [filterText, setFilterText] = createSignal("");
  const [filters, setFilters] = createSignal<EventFilterState>({
    ...DEFAULT_EVENT_FILTERS,
    factions: { ...DEFAULT_FACTION_FILTER },
  });

  const passesEventType = (event: GameEvent, f: EventFilterState): boolean => {
    // Detail snapshots drive the player profile and are intentionally hidden
    // from the human-readable mission event log.
    if (event instanceof PlayerSnapshotEvent) return false;
    if (event instanceof HitKilledEvent) {
      return event.type === "killed" ? f.showKills : f.showHits;
    }
    if (event instanceof ConnectEvent) return f.showConnections;
    if (event instanceof CapturedEvent) return f.showCaptures;
    if (event instanceof TerminalHackEvent) return f.showTerminalHacks;
    if (event instanceof ZeusPingEvent) return f.showZeusPings;
    if (event instanceof ZeusModuleEvent) return f.showZeusModules;
    if (event instanceof ExplosionEvent) return f.showExplosions;
    if (event instanceof ServiceEvent) return f.showServicing;
    if (event instanceof StaticWeaponEvent) return f.showConstructions;
    // Only the key-down is listed: a Stop says nothing on its own, and pairing
    // the two into a duration is the comms tab's job.
    if (event instanceof RadioTransmissionEvent) return f.showTransmissions && event.isStart;
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

  const passesFactionFilter = (event: GameEvent, f: EventFilterState): boolean => {
    if (allFactionsEnabled(f.factions)) return true;
    const sides = eventInvolvedSides(event, engine);
    if (sides.length === 0) return true;
    return sides.some((s) => f.factions[s as Side]);
  };

  const filteredEvents = createMemo(() => {
    engine.eventReferencesVersion();
    const all = engine.activeEvents();
    const text = filterText().toLowerCase();
    const f = filters();

    const filtered = all.filter((event) => {
      if (!passesEventType(event, f)) return false;
      if (!passesSideFilter(event, f)) return false;
      if (!passesFactionFilter(event, f)) return false;

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
        } else if (event instanceof ZeusPingEvent) {
          if (!event.payload.name.toLowerCase().includes(text)) return false;
        } else if (event instanceof ZeusModuleEvent) {
          const haystack = [
            event.payload.curatorName ?? "",
            event.payload.displayName ?? "",
            event.payload.attachedName ?? "",
            event.payload.className ?? "",
          ].join(" ").toLowerCase();
          if (!haystack.includes(text)) return false;
        } else if (event instanceof ExplosionEvent) {
          if (!event.payload.name.toLowerCase().includes(text)) return false;
        } else if (event instanceof ServiceEvent) {
          const haystack = [event.payload.vehicleName, event.payload.unitName]
            .join(" ").toLowerCase();
          if (!haystack.includes(text)) return false;
        } else if (event instanceof StaticWeaponEvent) {
          const haystack = [event.payload.name, event.payload.unitName]
            .join(" ").toLowerCase();
          if (!haystack.includes(text)) return false;
        } else if (event instanceof RadioTransmissionEvent) {
          const haystack = [
            event.payload.radio,
            formatNet(event.payload.frequency, event.payload.code),
            engine.entityManager.getEntity(event.unitId)?.name ?? "",
          ].join(" ").toLowerCase();
          if (!haystack.includes(text)) return false;
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
    } else if (event instanceof ZeusPingEvent) {
      engine.panToPosition(event.position);
    } else if (event instanceof ZeusModuleEvent) {
      engine.panToPosition(event.position);
    } else if (event instanceof ExplosionEvent) {
      engine.panToPosition(event.position);
    } else if (event instanceof ServiceEvent) {
      // The vehicle is the subject and it may well have driven off since.
      if (event.payload.vehicleId >= 0) engine.panToEntity(event.payload.vehicleId);
      else engine.panToPosition(event.position);
    } else if (event instanceof StaticWeaponEvent) {
      engine.panToPosition(event.position);
    } else if (event instanceof RadioTransmissionEvent) {
      engine.panToEntity(event.unitId);
    }
  };

  const timeStr = (frameNum: number): string => {
    return formatElapsedTime(frameNum, engine.captureDelayMs());
  };

  const combatSide = (event: HitKilledEvent, who: "victim" | "causer"): string | undefined => {
    engine.eventReferencesVersion();
    return who === "victim" ? event.victimSide : event.causerSide;
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
                          <span style={{ color: sideColor(combatSide(event, "victim")) }}>
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
                              <span style={{ color: sideColor(combatSide(event, "causer")) }}>
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
                          <Show when={event.message}>
                            {" "}
                            <span style={{ color: "var(--text-secondary)" }}>{event.message}</span>
                          </Show>
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
                    ) : event instanceof ZeusPingEvent ? (
                      <>
                        <span class={styles.eventMessage}>
                          <span style={{ color: sideColor(event.payload.side) }}>
                            {event.payload.name}
                          </span>
                          {" "}{t("pinged_zeus")}
                        </span>
                        <span class={styles.eventMeta}>
                          <span class={styles.eventTime}>
                            <ClockIcon size={14} />
                            {timeStr(event.frameNum)}
                          </span>
                        </span>
                      </>
                    ) : event instanceof ZeusModuleEvent ? (
                      <>
                        <span class={styles.eventMessage}>
                          <span style={{ color: SIDE_COLORS_UI.VIRTUAL }}>
                            {event.payload.curatorName || `Zeus ${event.payload.curatorId}`}
                          </span>
                          {" "}{t("used_zeus_module")}{" "}
                          {event.payload.displayName}
                          <Show when={event.payload.attachedName}>
                            {" "}{t("on_target")} {event.payload.attachedName}
                          </Show>
                        </span>
                        <span class={styles.eventMeta}>
                          <span class={styles.eventTime}>
                            <ClockIcon size={14} />
                            {timeStr(event.frameNum)}
                          </span>
                        </span>
                      </>
                    ) : event instanceof ExplosionEvent ? (
                      <>
                        <span class={styles.eventMessage}>
                          {event.payload.name} {t("detonated")}
                        </span>
                        <span class={styles.eventMeta}>
                          <span class={styles.eventTime}>
                            <ClockIcon size={14} />
                            {timeStr(event.frameNum)}
                          </span>
                          <span class={styles.eventDistance}>
                            {Math.round(event.radius)}m
                          </span>
                        </span>
                      </>
                    ) : event instanceof ServiceEvent ? (
                      <>
                        <span class={styles.eventMessage}>
                          <Show when={event.payload.unitName} fallback={<>{t(event.payload.kind)}</>}>
                            <span style={{ color: sideColor(event.payload.side) }}>
                              {event.payload.unitName}
                            </span>
                            {" "}{t(event.payload.kind)}
                          </Show>
                          {" "}{event.payload.vehicleName}
                        </span>
                        <span class={styles.eventMeta}>
                          <span class={styles.eventTime}>
                            <ClockIcon size={14} />
                            {timeStr(event.frameNum)}
                          </span>
                          <Show when={event.payload.kind === "rearm"} fallback={
                            <span class={styles.eventDistance}>
                              {Math.round((event.progress ?? 0) * 100)}%
                            </span>
                          }>
                            <span class={styles.eventWeapon}>
                              {event.payload.count}x {event.payload.magazineName ?? event.payload.magazine}
                            </span>
                          </Show>
                        </span>
                      </>
                    ) : event instanceof StaticWeaponEvent ? (
                      <>
                        <span class={styles.eventMessage}>
                          <Show when={event.payload.unitName} fallback={<>{t(event.payload.action)}</>}>
                            <span style={{ color: sideColor(event.payload.side) }}>
                              {event.payload.unitName}
                            </span>
                            {" "}{t(event.payload.action)}
                          </Show>
                          {" "}{event.payload.name}
                        </span>
                        <span class={styles.eventMeta}>
                          <span class={styles.eventTime}>
                            <ClockIcon size={14} />
                            {timeStr(event.frameNum)}
                          </span>
                        </span>
                      </>
                    ) : event instanceof RadioTransmissionEvent ? (
                      <>
                        <span class={styles.eventMessage}>
                          <span style={{ color: sideColor(engine.entitySnapshots().get(event.unitId)?.side ?? undefined) }}>
                            {engine.entityManager.getEntity(event.unitId)?.name ?? `Unit ${event.unitId}`}
                          </span>
                          {" "}{t("transmitted_on")} {formatNet(event.payload.frequency, event.payload.code)}
                        </span>
                        <span class={styles.eventMeta}>
                          <span class={styles.eventTime}>
                            <ClockIcon size={14} />
                            {timeStr(event.frameNum)}
                          </span>
                          <span class={styles.eventWeapon}>{event.payload.radio}</span>
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
