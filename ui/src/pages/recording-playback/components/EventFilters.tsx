import { createSignal, For, Show } from "solid-js";
import type { JSX, Accessor } from "solid-js";
import type { Side } from "../../../data/types";
import { SIDES, SIDE_LABELS } from "../../../config/sideColors";
import { FilterIcon } from "../../../components/Icons";
import { useI18n } from "../../../hooks/useLocale";
import { useClickOutside } from "../../../hooks/useClickOutside";
import styles from "./EventFilters.module.css";

export type SideFilter = "all" | "friendlyFireOnly" | "hideFriendlyFire";

export type FactionFilter = Record<Side, boolean>;

export const DEFAULT_FACTION_FILTER: FactionFilter = {
  WEST: true,
  EAST: true,
  GUER: true,
  CIV: true,
  VIRTUAL: true,
};

/** Filter-panel names: Independent in full, the rest match the Units tab. */
export const FACTION_FILTER_LABELS: Record<Side, string> = {
  ...SIDE_LABELS,
  GUER: "Independent",
  CIV: "Civilian",
  VIRTUAL: "Virtual",
};

export interface EventFilterState {
  showKills: boolean;
  showHits: boolean;
  showConnections: boolean;
  showCaptures: boolean;
  showTerminalHacks: boolean;
  showMissionEvents: boolean;
  showZeusPings: boolean;
  showZeusModules: boolean;
  showExplosions: boolean;
  showServicing: boolean;
  showConstructions: boolean;
  showTransmissions: boolean;
  sideFilter: SideFilter;
  factions: FactionFilter;
}

export const DEFAULT_EVENT_FILTERS: EventFilterState = {
  showKills: true,
  showHits: false,
  showConnections: false,
  showCaptures: true,
  showTerminalHacks: true,
  showMissionEvents: true,
  showZeusPings: true,
  showZeusModules: true,
  // Off by default like hits: a mortar mission writes one per round, and the
  // blast circles are on the map either way.
  showExplosions: false,
  showServicing: true,
  showConstructions: true,
  // Off by default like hits and explosions: a talkative op keys up hundreds of
  // times, and the Comms tab is where transmissions are actually readable.
  showTransmissions: false,
  sideFilter: "all",
  factions: { ...DEFAULT_FACTION_FILTER },
};

type EventTypeKey = Exclude<keyof EventFilterState, "sideFilter" | "factions">;

interface EventTypeItem {
  key: EventTypeKey;
  labelKey: string;
}

const EVENT_TYPE_ITEMS: EventTypeItem[] = [
  { key: "showKills", labelKey: "kills" },
  { key: "showHits", labelKey: "hits" },
  { key: "showConnections", labelKey: "connections" },
  { key: "showCaptures", labelKey: "captures" },
  { key: "showTerminalHacks", labelKey: "terminal_hacks" },
  { key: "showMissionEvents", labelKey: "mission_events" },
  { key: "showZeusPings", labelKey: "zeus_pings" },
  { key: "showZeusModules", labelKey: "zeus_modules" },
  { key: "showExplosions", labelKey: "explosions" },
  { key: "showServicing", labelKey: "servicing" },
  { key: "showConstructions", labelKey: "constructions" },
  { key: "showTransmissions", labelKey: "transmissions" },
];

const SIDE_FILTER_OPTIONS: { key: SideFilter; labelKey: string }[] = [
  { key: "all", labelKey: "side_filter_all" },
  { key: "friendlyFireOnly", labelKey: "side_filter_ff_only" },
  { key: "hideFriendlyFire", labelKey: "side_filter_hide_ff" },
];

function isNonDefault(state: EventFilterState): boolean {
  return (
    state.showKills !== DEFAULT_EVENT_FILTERS.showKills ||
    state.showHits !== DEFAULT_EVENT_FILTERS.showHits ||
    state.showConnections !== DEFAULT_EVENT_FILTERS.showConnections ||
    state.showCaptures !== DEFAULT_EVENT_FILTERS.showCaptures ||
    state.showTerminalHacks !== DEFAULT_EVENT_FILTERS.showTerminalHacks ||
    state.showMissionEvents !== DEFAULT_EVENT_FILTERS.showMissionEvents ||
    state.showZeusPings !== DEFAULT_EVENT_FILTERS.showZeusPings ||
    state.showZeusModules !== DEFAULT_EVENT_FILTERS.showZeusModules ||
    state.showExplosions !== DEFAULT_EVENT_FILTERS.showExplosions ||
    state.showServicing !== DEFAULT_EVENT_FILTERS.showServicing ||
    state.showConstructions !== DEFAULT_EVENT_FILTERS.showConstructions ||
    state.showTransmissions !== DEFAULT_EVENT_FILTERS.showTransmissions ||
    state.sideFilter !== DEFAULT_EVENT_FILTERS.sideFilter ||
    SIDES.some((side) => state.factions[side] !== DEFAULT_FACTION_FILTER[side])
  );
}

export function allFactionsEnabled(factions: FactionFilter): boolean {
  return SIDES.every((side) => factions[side]);
}

export interface EventFiltersProps {
  state: Accessor<EventFilterState>;
  setState: (updater: (prev: EventFilterState) => EventFilterState) => void;
}

export function EventFilters(props: EventFiltersProps): JSX.Element {
  const { t } = useI18n();
  const [open, setOpen] = createSignal(false);
  let panelRef: HTMLDivElement | undefined;
  useClickOutside(() => panelRef, setOpen);

  const toggleType = (key: EventTypeKey) => {
    props.setState((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const setSide = (side: SideFilter) => {
    props.setState((prev) => ({ ...prev, sideFilter: side }));
  };

  const toggleFaction = (side: Side) => {
    props.setState((prev) => ({
      ...prev,
      factions: { ...prev.factions, [side]: !prev.factions[side] },
    }));
  };

  return (
    <div ref={panelRef} class={styles.wrapper}>
      <button
        class={styles.filterBtn}
        classList={{ [styles.filterBtnActive]: open() || isNonDefault(props.state()) }}
        title={t("event_filters")}
        aria-label={t("event_filters")}
        onClick={() => setOpen((v) => !v)}
      >
        <FilterIcon size={16} />
        <Show when={!open() && isNonDefault(props.state())}>
          <span class={styles.activeDot} aria-hidden="true" />
        </Show>
      </button>

      <Show when={open()}>
        <div class={styles.panel}>
          <div class={styles.sectionLabel}>{t("section_event_types")}</div>
          <For each={EVENT_TYPE_ITEMS}>
            {(item) => {
              const active = () => props.state()[item.key];
              return (
                <button class={styles.checkItem} onClick={() => toggleType(item.key)}>
                  <div
                    class={styles.checkbox}
                    classList={{
                      [styles.checkboxActive]: active(),
                      [styles.checkboxInactive]: !active(),
                    }}
                  >
                    <Show when={active()}>
                      <div class={styles.checkboxDot} />
                    </Show>
                  </div>
                  <span
                    class={styles.itemText}
                    classList={{
                      [styles.itemTextActive]: active(),
                      [styles.itemTextInactive]: !active(),
                    }}
                  >
                    {t(item.labelKey)}
                  </span>
                </button>
              );
            }}
          </For>

          <div class={`${styles.sectionLabel} ${styles.sectionBorder}`}>
            {t("section_side_filter")}
          </div>
          <For each={SIDE_FILTER_OPTIONS}>
            {(opt) => {
              const active = () => props.state().sideFilter === opt.key;
              return (
                <button
                  class={styles.radioItem}
                  classList={{ [styles.radioItemActive]: active() }}
                  onClick={() => setSide(opt.key)}
                >
                  <div
                    class={styles.radio}
                    classList={{
                      [styles.radioActive]: active(),
                      [styles.radioInactive]: !active(),
                    }}
                  >
                    <Show when={active()}>
                      <div class={styles.radioDot} />
                    </Show>
                  </div>
                  <span
                    class={styles.itemText}
                    classList={{
                      [styles.itemTextActive]: active(),
                      [styles.itemTextInactive]: !active(),
                    }}
                  >
                    {t(opt.labelKey)}
                  </span>
                </button>
              );
            }}
          </For>

          <div class={`${styles.sectionLabel} ${styles.sectionBorder}`}>
            {t("section_faction_filter")}
          </div>
          <For each={SIDES}>
            {(side) => {
              const active = () => props.state().factions[side];
              return (
                <button class={styles.checkItem} onClick={() => toggleFaction(side)}>
                  <div
                    class={styles.checkbox}
                    classList={{
                      [styles.checkboxActive]: active(),
                      [styles.checkboxInactive]: !active(),
                    }}
                  >
                    <Show when={active()}>
                      <div class={styles.checkboxDot} />
                    </Show>
                  </div>
                  <span
                    class={styles.itemText}
                    classList={{
                      [styles.itemTextActive]: active(),
                      [styles.itemTextInactive]: !active(),
                    }}
                  >
                    {FACTION_FILTER_LABELS[side]}
                  </span>
                </button>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}
