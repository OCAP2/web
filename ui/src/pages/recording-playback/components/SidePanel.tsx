import { Switch, Match, For } from "solid-js";
import type { Accessor, JSX } from "solid-js";
import { UsersIcon, ActivityIcon, BarChartIcon } from "../../../components/Icons";
import { useI18n } from "../../../hooks/useLocale";
import { UnitsTab } from "./UnitsTab";
import { EventsTab } from "./EventsTab";
import { StatsTab } from "./StatsTab";
import styles from "./SidePanel.module.css";

export interface SidePanelProps {
  activeTab: Accessor<string>;
  onTabChange: (tab: string) => void;
  blacklist?: Accessor<Set<number>>;
  markerCounts?: Accessor<Map<number, number>>;
  isAdmin?: Accessor<boolean>;
  onToggleBlacklist?: (playerEntityId: number) => void;
}

export function SidePanel(props: SidePanelProps): JSX.Element {
  const { t } = useI18n();

  const tabs = [
    { id: "units" as const, labelKey: "units", Icon: UsersIcon },
    { id: "events" as const, labelKey: "events", Icon: ActivityIcon },
    { id: "stats" as const, labelKey: "stats", Icon: BarChartIcon },
  ];

  return (
    <div class={styles.panel}>
      <div class={styles.tabs}>
        <For each={tabs}>
          {(tab) => (
            <button
              class={styles.tab}
              classList={{ [styles.tabActive]: props.activeTab() === tab.id }}
              onClick={() => props.onTabChange(tab.id)}
            >
              <tab.Icon size={14} />
              <span class={styles.tabLabel}>{t(tab.labelKey)}</span>
            </button>
          )}
        </For>
      </div>

      <Switch>
        <Match when={props.activeTab() === "units"}>
          <UnitsTab
            blacklist={props.blacklist}
            markerCounts={props.markerCounts}
            isAdmin={props.isAdmin}
            onToggleBlacklist={props.onToggleBlacklist}
          />
        </Match>
        <Match when={props.activeTab() === "events"}>
          <EventsTab />
        </Match>
        <Match when={props.activeTab() === "stats"}>
          <StatsTab />
        </Match>
      </Switch>

    </div>
  );
}
