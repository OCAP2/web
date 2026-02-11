import { createSignal } from "solid-js";
import type { JSX } from "solid-js";
import { useEngine } from "../hooks/useEngine";
import { useI18n } from "../hooks/useLocale";
import { useRenderer } from "../hooks/useRenderer";
import styles from "./BottomPanel.module.css";

/**
 * Right side of the controls row.
 *
 * Contains (left to right, matching old frontend float-right order):
 *   Time dropdown | Grid | Map markers | Names dropdown | Fire lines | Speed | Fullscreen
 */
export function ToggleBar(): JSX.Element {
  const engine = useEngine();
  const { t } = useI18n();
  const renderer = useRenderer();

  // Toggle state (fire lines & markers default on, grid defaults off — matching old frontend)
  const [fireLines, setFireLines] = createSignal(true);
  const [mapMarkers, setMapMarkers] = createSignal(true);
  const [grid, setGrid] = createSignal(false);

  const toggleFireLines = () => {
    const next = !fireLines();
    setFireLines(next);
    renderer.setLayerVisible("projectileMarkers", next);
  };

  const toggleMapMarkers = () => {
    const next = !mapMarkers();
    setMapMarkers(next);
    renderer.setLayerVisible("briefingMarkers", next);
  };

  const toggleGrid = () => {
    const next = !grid();
    setGrid(next);
    renderer.setLayerVisible("grid", next);
  };

  const handleSpeedInput: JSX.EventHandler<HTMLInputElement, InputEvent> = (
    e,
  ) => {
    engine.setSpeed(parseInt(e.currentTarget.value, 10));
  };

  const goFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  };

  return (
    <div data-testid="toggle-bar" class={styles.toggleBar}>
      {/* Time display mode */}
      <span class={`${styles.a3Select} ${styles.toggleTimeSelect}`}>
        <select data-testid="toggle-time">
          <option value="elapsed">{t("time_elapsed")}</option>
          <option value="mission" disabled>{t("time_mission")}</option>
          <option value="system" disabled>{t("time_system")}</option>
        </select>
      </span>

      {/* Grid */}
      <span
        data-testid="toggle-grid"
        class={`${styles.toggleBtn} ${styles.toggleGridIcon} ${grid() ? "active" : "inactive"}`}
        onClick={toggleGrid}
        title={t("grid")}
      />

      {/* Map markers */}
      <span
        data-testid="toggle-map-markers"
        class={`${styles.toggleBtn} ${styles.toggleMapIcon} ${mapMarkers() ? "active" : "inactive"}`}
        onClick={toggleMapMarkers}
        title={t("markers")}
      />

      {/* Unit names display mode */}
      <span class={`${styles.a3Select} ${styles.toggleNamesSelect}`}>
        <select
          data-testid="toggle-names"
          onChange={(e) => renderer.setNameDisplayMode(e.currentTarget.value as "players" | "all" | "none")}
        >
          <option value="players">{t("names_players")}</option>
          <option value="all">{t("names_all")}</option>
          <option value="none">{t("names_none")}</option>
        </select>
      </span>

      {/* Fire lines */}
      <span
        data-testid="toggle-fire-lines"
        class={`${styles.toggleBtn} ${styles.toggleFirelinesIcon} ${fireLines() ? "active" : "inactive"}`}
        onClick={toggleFireLines}
        title={t("line_fire")}
      />

      {/* Speed */}
      <div class={styles.speedSliderContainer} data-testid="speed-slider-container">
        <div class={styles.speedSliderPopup} data-testid="speed-slider-popup">
          <input
            type="range"
            data-testid="speed-slider"
            class={styles.speedSlider}
            min={1}
            max={60}
            value={engine.playbackSpeed()}
            onInput={handleSpeedInput}
          />
        </div>
        <span data-testid="speed-label" class={styles.speedValue}>
          {engine.playbackSpeed()}x
        </span>
      </div>

      {/* Fullscreen */}
      <span
        data-testid="fullscreen-button"
        class={`${styles.toggleBtn} ${styles.fullscreenIcon}`}
        onClick={goFullscreen}
        title="Toggle fullscreen"
      >⛶</span>
    </div>
  );
}
