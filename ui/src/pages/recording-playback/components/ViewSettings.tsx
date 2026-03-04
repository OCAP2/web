import { createSignal, createMemo, Show, For } from "solid-js";
import type { JSX, Accessor } from "solid-js";
import { SettingsIcon } from "../../../components/Icons";
import { useEngine } from "../../../hooks/useEngine";
import { useRenderer } from "../../../hooks/useRenderer";
import { useI18n } from "../../../hooks/useLocale";
import { useClickOutside } from "../../../hooks/useClickOutside";
import type { TimeMode } from "../../../playback/time";
import type { RenderLayer } from "../../../renderers/renderer.types";
import type { WorldConfig } from "../../../data/types";
import styles from "./ViewSettings.module.css";

type NameMode = "all" | "players" | "none";
type MarkerMode = "all" | "noLabels" | "none";

const TIME_MODES: TimeMode[] = ["elapsed", "mission", "system"];
const TIME_MODE_KEYS: Record<TimeMode, string> = {
  elapsed: "time_elapsed",
  mission: "time_mission",
  system: "time_system",
};

const NAME_MODES: NameMode[] = ["all", "players", "none"];
const NAME_MODE_KEYS: Record<NameMode, string> = {
  all: "names_all",
  players: "names_players",
  none: "names_none",
};

const MARKER_MODES: MarkerMode[] = ["all", "noLabels", "none"];
const MARKER_MODE_KEYS: Record<MarkerMode, string> = {
  all: "markers_all",
  noLabels: "markers_no_labels",
  none: "markers_none",
};

export interface ViewSettingsProps {
  timeMode: Accessor<TimeMode>;
  onTimeMode: (mode: TimeMode) => void;
  worldConfig: Accessor<WorldConfig | undefined>;
}

export function ViewSettings(props: ViewSettingsProps): JSX.Element {
  const engine = useEngine();
  const renderer = useRenderer();
  const { t } = useI18n();

  const [open, setOpen] = createSignal(false);
  let panelRef: HTMLDivElement | undefined;
  useClickOutside(() => panelRef, setOpen);

  const isMapLibre = () => !!props.worldConfig()?.maplibre;

  const layerItems = createMemo(() => {
    const items: Array<{ key: string; label: string }> = [
      { key: "entities", label: t("layer_entities") },
      { key: "systemMarkers", label: t("layer_side_markers") },
      { key: "projectileMarkers", label: t("layer_projectiles") },
      { key: "grid", label: t("grid") },
    ];
    if (isMapLibre()) {
      items.push({ key: "mapIcons", label: t("layer_map_icons") });
      items.push({ key: "buildings3D", label: t("layer_buildings_3d") });
    }
    return items;
  });

  const toggleLayer = (key: string) => {
    renderer.setLayerVisible(key as RenderLayer, !renderer.layerVisibility()[key]);
  };

  const isTimeModeAvailable = (mode: TimeMode): boolean => {
    if (mode === "elapsed") return true;
    if (mode === "system") {
      const times = engine.timeConfig.times;
      return !!times && times.length > 0;
    }
    if (mode === "mission") {
      return !!engine.timeConfig.missionDate;
    }
    return false;
  };

  return (
    <div ref={panelRef} style={{ position: "relative" }}>
      <button
        class={styles.settingsBtn}
        classList={{ [styles.settingsBtnActive]: open() }}
        title={t("view_settings")}
        onClick={() => setOpen((v) => !v)}
      >
        <SettingsIcon size={16} />
      </button>

      <Show when={open()}>
        <div class={styles.panel}>
          {/* ── Map Layers ── */}
          <div class={styles.sectionLabel}>{t("section_map_layers")}</div>
          <For each={layerItems()}>
            {(item) => {
              const active = () => !!renderer.layerVisibility()[item.key];
              return (
                <button class={styles.checkItem} onClick={() => toggleLayer(item.key)}>
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
                    {item.label}
                  </span>
                </button>
              );
            }}
          </For>

          {/* ── Time Format ── */}
          <div class={`${styles.sectionLabel} ${styles.sectionBorder}`}>
            {t("section_time_format")}
          </div>
          <For each={TIME_MODES}>
            {(mode) => {
              const active = () => props.timeMode() === mode;
              const disabled = () => !isTimeModeAvailable(mode);
              return (
                <button
                  class={styles.radioItem}
                  classList={{
                    [styles.radioItemActive]: active(),
                    [styles.radioItemDisabled]: disabled(),
                  }}
                  disabled={disabled()}
                  onClick={() => props.onTimeMode(mode)}
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
                    {t(TIME_MODE_KEYS[mode])}
                  </span>
                </button>
              );
            }}
          </For>

          {/* ── Unit Labels ── */}
          <div class={`${styles.sectionLabel} ${styles.sectionBorder}`}>
            {t("section_unit_labels")}
          </div>
          <For each={NAME_MODES}>
            {(mode) => {
              const active = () => renderer.nameDisplayMode() === mode;
              return (
                <button
                  class={styles.radioItem}
                  classList={{ [styles.radioItemActive]: active() }}
                  onClick={() => renderer.setNameDisplayMode(mode)}
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
                    {t(NAME_MODE_KEYS[mode])}
                  </span>
                </button>
              );
            }}
          </For>

          {/* ── Markers ── */}
          <div class={`${styles.sectionLabel} ${styles.sectionBorder}`}>
            {t("section_markers")}
          </div>
          <For each={MARKER_MODES}>
            {(mode) => {
              const active = () => renderer.markerDisplayMode() === mode;
              return (
                <button
                  class={styles.radioItem}
                  classList={{ [styles.radioItemActive]: active() }}
                  onClick={() => renderer.setMarkerDisplayMode(mode)}
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
                    {t(MARKER_MODE_KEYS[mode])}
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
