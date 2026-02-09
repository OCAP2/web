import { createSignal } from "solid-js";
import type { JSX } from "solid-js";
import { useRenderer } from "../hooks/useRenderer";

/**
 * Layer visibility toggles for fire lines, map markers, and grid.
 *
 * Each toggle maintains its own local signal and delegates
 * visibility changes to the renderer.
 */
export function ToggleBar(): JSX.Element {
  const renderer = useRenderer();

  const [fireLines, setFireLines] = createSignal(true);
  const [mapMarkers, setMapMarkers] = createSignal(true);
  const [grid, setGrid] = createSignal(true);

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

  return (
    <div data-testid="toggle-bar" style={{ display: "flex", "align-items": "center", gap: "12px", "font-size": "12px", color: "#ccc" }}>
      <label style={{ display: "flex", "align-items": "center", gap: "4px", cursor: "pointer" }}>
        <input
          type="checkbox"
          data-testid="toggle-fire-lines"
          checked={fireLines()}
          onChange={toggleFireLines}
        />
        Fire Lines
      </label>
      <label style={{ display: "flex", "align-items": "center", gap: "4px", cursor: "pointer" }}>
        <input
          type="checkbox"
          data-testid="toggle-map-markers"
          checked={mapMarkers()}
          onChange={toggleMapMarkers}
        />
        Markers
      </label>
      <label style={{ display: "flex", "align-items": "center", gap: "4px", cursor: "pointer" }}>
        <input
          type="checkbox"
          data-testid="toggle-grid"
          checked={grid()}
          onChange={toggleGrid}
        />
        Grid
      </label>
    </div>
  );
}
