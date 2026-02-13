import { createMemo, Switch, Match } from "solid-js";
import type { Accessor, JSX } from "solid-js";
import { UsersIcon, ActivityIcon, BarChartIcon, MessageSquareIcon } from "./Icons";
import { useEngine } from "../../hooks/useEngine";
import { HitKilledEvent } from "../../../playback/events/hit-killed-event";
import { UnitsTab } from "./UnitsTab";
import { EventsTab } from "./EventsTab";
import { StatsTab } from "./StatsTab";
import { ChatTab } from "./ChatTab";
import styles from "./SidePanel.module.css";

export interface SidePanelProps {
  activeTab: Accessor<string>;
  onTabChange: (tab: string) => void;
}

export function SidePanel(props: SidePanelProps): JSX.Element {
  const engine = useEngine();

  const killCount = createMemo(() => {
    const events = engine.eventManager.getAll();
    let count = 0;
    for (const e of events) {
      if (e instanceof HitKilledEvent && e.type === "killed") count++;
    }
    return count;
  });

  const tabs = [
    { id: "units", label: "Units", Icon: UsersIcon },
    { id: "events", label: "Events", Icon: ActivityIcon },
    { id: "stats", label: "Stats", Icon: BarChartIcon },
    { id: "chat", label: "Chat", Icon: MessageSquareIcon },
  ] as const;

  return (
    <div class={styles.panel}>
      <div class={styles.tabs}>
        {tabs.map((tab) => (
          <button
            class={styles.tab}
            classList={{ [styles.tabActive]: props.activeTab() === tab.id }}
            onClick={() => props.onTabChange(tab.id)}
          >
            <tab.Icon size={14} />
            <span class={styles.tabLabel}>{tab.label}</span>
            {tab.id === "events" && killCount() > 0 && (
              <span class={styles.tabBadge}>
                {killCount() > 99 ? "99" : killCount()}
              </span>
            )}
          </button>
        ))}
      </div>

      <Switch>
        <Match when={props.activeTab() === "units"}>
          <UnitsTab />
        </Match>
        <Match when={props.activeTab() === "events"}>
          <EventsTab />
        </Match>
        <Match when={props.activeTab() === "stats"}>
          <StatsTab />
        </Match>
        <Match when={props.activeTab() === "chat"}>
          <ChatTab />
        </Match>
      </Switch>
    </div>
  );
}
