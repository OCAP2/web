import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LeafletRenderer } from "../leafletRenderer";

describe("marker label zoom visibility", () => {
  let container: HTMLDivElement;
  let renderer: LeafletRenderer;

  beforeEach(() => {
    container = document.createElement("div");
    container.style.cssText = "width:400px;height:400px";
    document.body.appendChild(container);
    renderer = new LeafletRenderer();
    renderer.init(container, {
      worldName: "test", worldSize: 10000, imageSize: 10000,
      maxZoom: 6, minZoom: 0, multiplier: 1, tileBaseUrl: "",
    });
  });

  afterEach(() => {
    renderer.dispose();
    container.remove();
  });

  function zoom(level: number): void {
    renderer.setView([5000, 5000], level, false);
    expect(renderer.getZoom()).toBe(level);
  }

  function createLabels(): HTMLElement[] {
    for (const [textClass, text, layer] of [
      ["zeus-ping-label", "[Zeus ping] - Alice - 00:01", "systemMarkers"],
      ["zeus-module-label", "[Zeus module] - Bob - 00:02", "systemMarkers"],
      ["sector-label", "Sector Alpha", "briefingMarkers"],
    ] as const) {
      renderer.createBriefingMarker({
        shape: "ICON", type: "Empty", color: "FFFFFF", side: "GLOBAL",
        text, textClass, layer,
      });
    }
    const labels = Array.from(container.querySelectorAll<HTMLElement>(".marker-text-label"));
    expect(labels).toHaveLength(3);
    return labels;
  }

  it.each([4, 5])("refreshes existing labels in both zoom directions after creation at zoom %s", (initialZoom) => {
    zoom(initialZoom);
    const labels = createLabels();
    for (const label of labels) expect(label.style.display).toBe(initialZoom <= 4 ? "none" : "");

    // Only the camera changes, as when playback is paused: no marker updates
    // or recreation can repair visibility for the renderer.
    for (const level of initialZoom === 4 ? [5, 4] : [4, 5]) {
      zoom(level);
      for (const label of labels) {
        expect(label.isConnected).toBe(true);
        expect(label.style.display).toBe(level <= 4 ? "none" : "");
      }
    }
  });

  it.each([true, false])("preserves projectile labels across zoom and marker-label changes (enabled: %s)", (enabled) => {
    zoom(4);
    renderer.setProjectileLabelsVisible(enabled);
    renderer.createBriefingMarker({
      shape: "ICON", type: "mil_dot", color: "FFFFFF", side: "GLOBAL",
      text: "Projectile label", layer: "projectileMarkers",
    });
    const labels = createLabels();
    const hasProjectileLabel = () => Array.from(container.querySelectorAll(".leaflet-popup-content"))
      .some((element) => element.textContent === "Projectile label");
    expect(hasProjectileLabel()).toBe(enabled);
    for (const level of [5, 4, 5]) {
      zoom(level);
      expect(hasProjectileLabel()).toBe(enabled);
    }
    renderer.setMarkerDisplayMode("noLabels");
    for (const label of labels) expect(label.style.display).toBe("none");
    expect(hasProjectileLabel()).toBe(enabled);
    renderer.setMarkerDisplayMode("all");
    for (const label of labels) expect(label.style.display).toBe("");
    expect(hasProjectileLabel()).toBe(enabled);
  });
});
