import { createSignal, Show, onCleanup } from "solid-js";
import type { JSX, Accessor } from "solid-js";
import styles from "./Hint.module.css";

// ─── Module-level hint state for external use ───

const [hintMessage, setHintMessage] = createSignal("");
const [hintVisible, setHintVisible] = createSignal(false);

let hintTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Show a transient hint notification.
 * Auto-dismisses after ~2 seconds.
 */
export function showHint(msg: string): void {
  if (hintTimer !== null) {
    clearTimeout(hintTimer);
  }
  setHintMessage(msg);
  setHintVisible(true);
  hintTimer = setTimeout(() => {
    setHintVisible(false);
    hintTimer = null;
  }, 2000);
}

/** Exported signals for testing or external observation. */
export { hintMessage, hintVisible };

// ─── Component ───

export interface HintProps {
  message?: Accessor<string>;
  visible?: Accessor<boolean>;
}

/**
 * Transient notification toast component.
 *
 * Can be driven either by explicit props (message/visible accessors)
 * or by the module-level `showHint()` function which uses internal signals.
 * Applies a fade-in/fade-out animation class.
 */
export function Hint(props?: HintProps): JSX.Element {
  const msg = () => (props?.message ? props.message() : hintMessage());
  const vis = () => (props?.visible ? props.visible() : hintVisible());

  onCleanup(() => {
    if (hintTimer !== null) {
      clearTimeout(hintTimer);
      hintTimer = null;
    }
  });

  return (
    <Show when={vis()}>
      <div
        data-testid="hint"
        class={`${styles.hint} ${vis() ? styles.hintVisible : styles.hintHidden}`}
      >
        {msg()}
      </div>
    </Show>
  );
}
