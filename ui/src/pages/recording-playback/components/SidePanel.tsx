import { Switch, Match, For, createEffect, onCleanup } from "solid-js";
import type { Accessor, JSX } from "solid-js";
import { UsersIcon, ActivityIcon, BarChartIcon, RadioIcon, SitemapIcon, GaugeIcon } from "../../../components/Icons";
import { useI18n } from "../../../hooks/useLocale";
import { UnitsTab } from "./UnitsTab";
import { EventsTab } from "./EventsTab";
import { StatsTab } from "./StatsTab";
import { FpsTab } from "./FpsTab";
import { CommsTab } from "./CommsTab";
import { OrbatTab } from "./OrbatTab";
import styles from "./SidePanel.module.css";

/**
 * Panel width while the FPS tab is open. The graph is the point of that tab,
 * so it takes most of the screen, while leaving a strip of map beside it.
 * Set on the root so everything laid out against the panel (map controls, the
 * profile card) moves with it.
 */
const FPS_PANEL_WIDTH = "clamp(420px, 62vw, 1120px)";

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
    { id: "orbat" as const, labelKey: "orbat", Icon: SitemapIcon },
    { id: "comms" as const, labelKey: "comms", Icon: RadioIcon },
    { id: "stats" as const, labelKey: "stats", Icon: BarChartIcon },
    { id: "fps" as const, labelKey: "fps", Icon: GaugeIcon },
  ];

  createEffect(() => {
    const root = document.documentElement.style;
    if (props.activeTab() === "fps") root.setProperty("--pb-panel-width", FPS_PANEL_WIDTH);
    else root.removeProperty("--pb-panel-width");
  });
  onCleanup(() => document.documentElement.style.removeProperty("--pb-panel-width"));

  return (
    <div class={styles.panel}>
      <div class={styles.tabs}>
        <For each={tabs}>
          {(tab) => (
            <button
              class={styles.tab}
              classList={{ [styles.tabActive]: props.activeTab() === tab.id }}
              onClick={() => props.onTabChange(tab.id)}
              // Six tabs share a fixed-width panel, so an inactive label can be
              // truncated. The tooltip is where the full name stays reachable.
              title={t(tab.labelKey)}
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
        <Match when={props.activeTab() === "orbat"}>
          <OrbatTab />
        </Match>
        <Match when={props.activeTab() === "comms"}>
          <CommsTab />
        </Match>
        <Match when={props.activeTab() === "stats"}>
          <StatsTab />
        </Match>
        <Match when={props.activeTab() === "fps"}>
          <FpsTab />
        </Match>
      </Switch>

    </div>
  );
}
