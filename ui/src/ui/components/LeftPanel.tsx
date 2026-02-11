import { createSignal, Show, For } from "solid-js";
import type { JSX } from "solid-js";
import type { Side } from "../../data/types";
import { SIDE_CLASS } from "../../config/side-colors";
import { useEngine } from "../hooks/useEngine";
import { useI18n } from "../hooks/useLocale";
import { leftPanelVisible } from "../shortcuts";
import { SideGroup } from "./SideGroup";
import styles from "./LeftPanel.module.css";

const SIDES: Side[] = ["WEST", "EAST", "GUER", "CIV"];

const SIDE_LABEL: Record<Side, string> = {
  WEST: "BLUFOR",
  EAST: "OPFOR",
  GUER: "IND",
  CIV: "CIV",
};

/**
 * Collapsible left panel showing units grouped by side and squad.
 *
 * - Visibility controlled by `leftPanelVisible` signal (toggled via 'e' key).
 * - Side tabs at the bottom let the user switch between WEST/EAST/GUER/CIV.
 * - Units are grouped by group/squad name within each side.
 */
export function LeftPanel(): JSX.Element {
  const engine = useEngine();
  const { t } = useI18n();
  const [activeTab, setActiveTab] = createSignal<Side>("WEST");

  // Read endFrame to create reactive dependency — when loadOperation finishes
  // populating entities it sets endFrame as the last signal, triggering re-eval.
  const unitsForSide = (side: Side) => {
    engine.endFrame();
    return engine.entityManager.getBySide(side);
  };

  return (
    <Show when={leftPanelVisible()}>
      <div class={styles.leftPanel} data-testid="left-panel">
        <div class={styles.panelTitle} data-testid="left-panel-header">{t("players")}</div>
        <div class={styles.panelContent} data-testid="left-panel-content">
          <SideGroup side={activeTab()} units={unitsForSide(activeTab())} />
        </div>
        <div class={styles.sideTabs} data-testid="left-panel-tabs">
          <For each={SIDES}>
            {(side) => (
              <div
                class={`${styles.sideTab} ${SIDE_CLASS[side]} ${styles.sideTitle}`}
                data-testid={`tab-${side}`}
                onClick={() => setActiveTab(side)}
                style={{ "background-color": activeTab() === side ? "rgba(255, 183, 38, 0.3)" : "rgba(255, 183, 38, 0.1)" }}
              >
                {SIDE_LABEL[side]}{"\n"}({unitsForSide(side).length})
              </div>
            )}
          </For>
        </div>
      </div>
    </Show>
  );
}
