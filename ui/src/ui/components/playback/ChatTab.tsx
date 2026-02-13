import type { JSX } from "solid-js";
import styles from "./SidePanel.module.css";

export function ChatTab(): JSX.Element {
  return (
    <div class={styles.tabContent}>
      <div class={styles.placeholder}>
        Chat messages not available for this recording
      </div>
    </div>
  );
}
