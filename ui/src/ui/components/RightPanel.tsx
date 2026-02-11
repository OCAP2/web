import { createSignal } from "solid-js";
import type { JSX } from "solid-js";
import { useI18n } from "../hooks/useLocale";
import { rightPanelVisible } from "../shortcuts";
import { EventList } from "./EventList";
import styles from "./RightPanel.module.css";

/**
 * Collapsible right panel containing the event log.
 *
 * Visibility is controlled by the rightPanelVisible signal from shortcuts.ts
 * (toggled with the 'r' key). Contains event filter controls and a scrollable
 * EventList.
 */
export function RightPanel(): JSX.Element {
  const { t } = useI18n();
  const [showHitEvents, setShowHitEvents] = createSignal(false);
  const [showConnectEvents, setShowConnectEvents] = createSignal(true);
  const [filterText, setFilterText] = createSignal("");

  return (
    <div
      class={styles.rightPanel}
      data-testid={rightPanelVisible() ? "right-panel" : undefined}
      style={{ transform: rightPanelVisible() ? "translateX(0)" : "translateX(100%)" }}
    >
      <div class={styles.panelTitle} data-testid="right-panel-header">
        {t("events")}
      </div>
      <div class={styles.filterBox} data-testid="right-panel-filters">
        <div
          class={`${styles.filterHit} ${showHitEvents() ? "" : styles.filterDisabled}`}
          data-testid="filter-hit-button"
          title="Toggle kill/hit events"
          onClick={() => setShowHitEvents(!showHitEvents())}
        />
        <div
          class={`${styles.filterConnect} ${showConnectEvents() ? "" : styles.filterDisabled}`}
          data-testid="filter-connect-button"
          title="Toggle connect/disconnect events"
          onClick={() => setShowConnectEvents(!showConnectEvents())}
        />
        <input
          type="text"
          class={styles.filterInput}
          data-testid="filter-events-input"
          placeholder={`${t("filter")}...`}
          value={filterText()}
          onInput={(e) => setFilterText(e.currentTarget.value)}
        />
      </div>
      <div class={styles.panelContent} data-testid="right-panel-content">
        <EventList
          showHitEvents={showHitEvents()}
          showConnectEvents={showConnectEvents()}
          filterText={filterText()}
        />
      </div>
    </div>
  );
}
