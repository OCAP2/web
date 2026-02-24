/**
 * CSS-class–based marker smoothing for Leaflet.
 *
 * Smoothing is achieved by adding/removing CSS classes on the map container
 * element.  The CSS rules (`.marker-transition.speed-N:not(.zooming)`) apply
 * `transition: transform <duration>s linear` to `.leaflet-marker-icon.animation`
 * and `.leaflet-popup.animation` elements, making marker movements animate
 * between frame updates.
 *
 * Speed-dependent durations mirror the legacy CSS:
 *   speed  1 → 1.0 s
 *   speed  2 → 0.9 s
 *   speed  3 → 0.8 s
 *   ...
 *   speed  9 → 0.2 s
 *   speed 10+ → 0.15 s   (the default `.marker-transition` rule)
 */

// --------------- Speed → duration mapping ---------------

/**
 * Return the CSS transition duration (in seconds) for a given playback speed.
 *
 * This is a pure function suitable for unit testing.
 */
export function getTransitionDuration(speed: number): number {
  if (speed >= 10) return 0.15;
  if (speed < 1) return 1;
  // speed 1 → 1.0, speed 2 → 0.9, …, speed 9 → 0.2
  return Math.round((1.1 - speed * 0.1) * 100) / 100;
}

// --------------- Class manipulation ---------------

/** Remove any existing `speed-N` class from the container. */
function removeSpeedClasses(container: HTMLElement): void {
  const toRemove: string[] = [];
  for (const cls of container.classList) {
    if (/^speed-\d+$/.test(cls)) {
      toRemove.push(cls);
    }
  }
  for (const cls of toRemove) {
    container.classList.remove(cls);
  }
}

/**
 * Enable marker CSS smoothing on the container.
 *
 * Adds the `marker-transition` class and the appropriate `speed-N` class
 * so that the companion CSS rules animate marker transforms.
 */
export function enableSmoothing(container: HTMLElement, speed: number): void {
  container.classList.add("marker-transition");
  removeSpeedClasses(container);
  // Only add a speed class for speeds 1-9; speed >= 10 uses the
  // default `.marker-transition` rule (0.15 s).
  const s = Math.max(1, Math.min(Math.floor(speed), 9));
  if (speed < 10) {
    container.classList.add(`speed-${s}`);
  }
}

/**
 * Disable marker CSS smoothing on the container.
 *
 * Removes the `marker-transition` and all `speed-N` classes.
 */
export function disableSmoothing(container: HTMLElement): void {
  container.classList.remove("marker-transition");
  removeSpeedClasses(container);
}

/**
 * Toggle the `zooming` class on the container.
 *
 * While zooming is active the CSS selector `:not(.zooming)` ensures marker
 * transitions are temporarily suppressed, preventing visual glitches during
 * the zoom animation.
 */
export function setZooming(container: HTMLElement, zooming: boolean): void {
  if (zooming) {
    container.classList.add("zooming");
  } else {
    container.classList.remove("zooming");
  }
}
