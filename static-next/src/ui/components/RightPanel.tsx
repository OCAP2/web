import { Show } from "solid-js";
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
  return (
    <Show when={rightPanelVisible()}>
      <div class="right-panel" data-testid="right-panel">
        <div class="panel-title" data-testid="right-panel-header">
          Event Log
        </div>
        <div class="filter-box" data-testid="right-panel-filters">
          {/* Filter controls placeholder — expanded in later tasks */}
        </div>
        <div class="panel-content" data-testid="right-panel-content">
          <EventList />
        </div>
      </div>
    </Show>
  );
}
