/**
 * Minimal HTML scale bar for standalone deck.gl (which has no built-in scale control).
 *
 * Positioned bottom-left, styled to match the existing dark theme.
 */

const NICE_DISTANCES = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
const MAX_BAR_WIDTH = 100; // pixels

export class ScaleControl {
  private container: HTMLDivElement;
  private bar: HTMLDivElement;
  private label: HTMLSpanElement;

  constructor(parent: HTMLElement) {
    this.container = document.createElement("div");
    this.container.style.cssText =
      "position:absolute;bottom:8px;left:8px;pointer-events:none;z-index:1;";

    this.bar = document.createElement("div");
    this.bar.style.cssText =
      "border:2px solid rgba(255,255,255,0.8);border-top:none;height:6px;background:rgba(0,0,0,0.3);";

    this.label = document.createElement("span");
    this.label.style.cssText =
      "display:block;font:11px/1.2 Arial,sans-serif;color:rgba(255,255,255,0.9);text-shadow:0 0 3px rgba(0,0,0,0.8);margin-bottom:2px;white-space:nowrap;";

    this.container.appendChild(this.label);
    this.container.appendChild(this.bar);
    parent.appendChild(this.container);
  }

  /** Recompute the scale bar for the given zoom level. */
  update(zoom: number): void {
    // At the equator (lat=0), meters per pixel = (circumference) / (2^zoom * tileSize)
    const metersPerPixel = (40075016.686) / (Math.pow(2, zoom) * 256);
    const maxMeters = metersPerPixel * MAX_BAR_WIDTH;

    // Find the largest "nice" distance that fits
    let distance = NICE_DISTANCES[0];
    for (const d of NICE_DISTANCES) {
      if (d <= maxMeters) distance = d;
      else break;
    }

    const barWidth = distance / metersPerPixel;
    this.bar.style.width = `${Math.round(barWidth)}px`;

    if (distance >= 1000) {
      this.label.textContent = `${distance / 1000} km`;
    } else {
      this.label.textContent = `${distance} m`;
    }
  }

  dispose(): void {
    this.container.remove();
  }
}
