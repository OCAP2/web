import type { JSX } from "solid-js";
import styles from "./MapControls.module.css";

/**
 * Keyboard shortcut hints displayed at the bottom-center of the playback view.
 */
export function KeyboardHints(): JSX.Element {
  return (
    <div class={styles.hints}>
      <div class={styles.hintItem}>
        <kbd class={styles.hintKey}>Space</kbd>
        <span class={styles.hintAction}>Play/Pause</span>
      </div>
      <div class={styles.hintItem}>
        <kbd class={styles.hintKey}>E</kbd>
        <span class={styles.hintAction}>Panel</span>
      </div>
    </div>
  );
}
