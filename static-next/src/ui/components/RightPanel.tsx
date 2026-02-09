import { Show, createSignal } from "solid-js";
import type { JSX } from "solid-js";
import { rightPanelVisible } from "../shortcuts";
import { EventList } from "./EventList";

/**
 * Collapsible right panel containing the event log.
 *
 * Visibility is controlled by the rightPanelVisible signal from shortcuts.ts
 * (toggled with the 'r' key). Contains event filter controls and a scrollable
 * EventList.
 */
export function RightPanel(): JSX.Element {
  const [showHitEvents, setShowHitEvents] = createSignal(true);
  const [showConnectEvents, setShowConnectEvents] = createSignal(true);
  const [filterText, setFilterText] = createSignal("");

  return (
    <Show when={rightPanelVisible()}>
      <div class="right-panel" data-testid="right-panel">
        <div class="panel-title" data-testid="right-panel-header">
          Events
        </div>
        <div class="filter-box" data-testid="right-panel-filters">
          <div
            class={`filter-hit ${showHitEvents() ? "" : "filter-disabled"}`}
            data-testid="filter-hit-button"
            title="Toggle kill/hit events"
            onClick={() => setShowHitEvents(!showHitEvents())}
          />
          <div
            class={`filter-connect ${showConnectEvents() ? "" : "filter-disabled"}`}
            data-testid="filter-connect-button"
            title="Toggle connect/disconnect events"
            onClick={() => setShowConnectEvents(!showConnectEvents())}
          />
          <input
            type="text"
            class="filter-input"
            data-testid="filter-events-input"
            placeholder="Filter..."
            value={filterText()}
            onInput={(e) => setFilterText(e.currentTarget.value)}
          />
        </div>
        <div class="panel-content" data-testid="right-panel-content">
          <EventList
            showHitEvents={showHitEvents()}
            showConnectEvents={showConnectEvents()}
            filterText={filterText()}
          />
        </div>
      </div>
    </Show>
  );
}
