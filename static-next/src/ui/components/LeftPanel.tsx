import { createSignal, Show, For } from "solid-js";
import type { JSX } from "solid-js";
import type { Side } from "../../data/types";
import { useEngine } from "../hooks/useEngine";
import { leftPanelVisible } from "../shortcuts";
import { SideGroup } from "./SideGroup";

const SIDES: Side[] = ["WEST", "EAST", "GUER", "CIV"];

/**
 * Collapsible left panel showing units grouped by side.
 *
 * - Visibility controlled by `leftPanelVisible` signal (toggled via 'e' key).
 * - Side tabs let the user switch between WEST/EAST/GUER/CIV.
 * - Each tab header shows the unit count for that side.
 */
export function LeftPanel(): JSX.Element {
  const engine = useEngine();
  const [activeTab, setActiveTab] = createSignal<Side>("WEST");

  const unitsForSide = (side: Side) => engine.entityManager.getBySide(side);

  return (
    <Show when={leftPanelVisible()}>
      <div class="left-panel" data-testid="left-panel">
        <div class="side-tabs" data-testid="left-panel-tabs">
          <For each={SIDES}>
            {(side) => (
              <div
                class={`side-tab${activeTab() === side ? " active" : ""}`}
                data-testid={`tab-${side}`}
                onClick={() => setActiveTab(side)}
                style={{ background: activeTab() === side ? "rgba(205, 134, 20, 0.6)" : "transparent" }}
              >
                {side} ({unitsForSide(side).length})
              </div>
            )}
          </For>
        </div>
        <div class="panel-content" data-testid="left-panel-content">
          <SideGroup side={activeTab()} units={unitsForSide(activeTab())} />
        </div>
      </div>
    </Show>
  );
}
