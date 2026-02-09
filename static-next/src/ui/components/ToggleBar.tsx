import { createSignal } from "solid-js";
import type { JSX } from "solid-js";
import { useEngine } from "../hooks/useEngine";
import { useRenderer } from "../hooks/useRenderer";

/**
 * Right side of the controls row.
 *
 * Contains (left to right, matching old frontend float-right order):
 *   Time dropdown | Grid | Map markers | Names dropdown | Fire lines | Speed | Fullscreen
 */
export function ToggleBar(): JSX.Element {
  const engine = useEngine();
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
    <div data-testid="toggle-bar" class="toggle-bar">
      {/* Time display mode */}
      <span class="a3-select toggle-time-select">
        <select data-testid="toggle-time">
          <option value="elapsed">Elapsed</option>
          <option value="mission" disabled>Mission</option>
          <option value="system" disabled>System</option>
        </select>
      </span>

      {/* Grid */}
      <span
        data-testid="toggle-grid"
        class={`toggle-btn toggle-grid-icon ${grid() ? "active" : "inactive"}`}
        onClick={toggleGrid}
        title="Toggle grid"
      />

      {/* Map markers */}
      <span
        data-testid="toggle-map-markers"
        class={`toggle-btn toggle-map-icon ${mapMarkers() ? "active" : "inactive"}`}
        onClick={toggleMapMarkers}
        title="Toggle map markers"
      />

      {/* Unit names display mode */}
      <span class="a3-select toggle-names-select">
        <select data-testid="toggle-names">
          <option value="players">Players</option>
          <option value="all">All</option>
          <option value="none">None</option>
        </select>
      </span>

      {/* Fire lines */}
      <span
        data-testid="toggle-fire-lines"
        class={`toggle-btn toggle-firelines-icon ${fireLines() ? "active" : "inactive"}`}
        onClick={toggleFireLines}
        title="Toggle fire lines"
      />

      {/* Speed */}
      <div class="speed-slider-container">
        <div class="speed-slider-popup">
          <input
            type="range"
            data-testid="speed-slider"
            class="speed-slider"
            min={1}
            max={60}
            value={engine.playbackSpeed()}
            onInput={handleSpeedInput}
          />
        </div>
        <span data-testid="speed-label" class="speed-value">
          {engine.playbackSpeed()}x
        </span>
      </div>

      {/* Fullscreen */}
      <span
        data-testid="fullscreen-button"
        class="toggle-btn fullscreen-icon"
        onClick={goFullscreen}
        title="Toggle fullscreen"
      />
    </div>
  );
}
