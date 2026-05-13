import { createSignal, For, Show } from "solid-js";
import type { JSX, Accessor } from "solid-js";
import { FilterIcon } from "../../../components/Icons";
import { useI18n } from "../../../hooks/useLocale";
import { useClickOutside } from "../../../hooks/useClickOutside";
import styles from "./EventFilters.module.css";

export type SideFilter = "all" | "friendlyFireOnly" | "hideFriendlyFire";

export interface EventFilterState {
  showKills: boolean;
  showHits: boolean;
  showConnections: boolean;
  showCaptures: boolean;
  showTerminalHacks: boolean;
  showMissionEvents: boolean;
  sideFilter: SideFilter;
}

export const DEFAULT_EVENT_FILTERS: EventFilterState = {
  showKills: true,
  showHits: false,
  showConnections: false,
  showCaptures: true,
  showTerminalHacks: true,
  showMissionEvents: true,
  sideFilter: "all",
};

type EventTypeKey = Exclude<keyof EventFilterState, "sideFilter">;

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
    state.sideFilter !== DEFAULT_EVENT_FILTERS.sideFilter
  );
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
        </div>
      </Show>
    </div>
  );
}
