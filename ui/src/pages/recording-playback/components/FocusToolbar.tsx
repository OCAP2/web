import { Show } from "solid-js";
import type { JSX, Accessor } from "solid-js";
import { useEngine } from "../../../hooks/useEngine";
import { formatElapsedTime } from "../../../playback/time";
import { ScissorsIcon, BracketInIcon, BracketOutIcon, CheckIcon } from "../../../components/Icons";
import styles from "./BottomBar.module.css";

export interface FocusRange {
  inFrame: number;
  outFrame: number;
}

export interface FocusToolbarProps {
  draft: Accessor<FocusRange | null>;
  onSetIn: () => void;
  onSetOut: () => void;
  onClear: () => void;
  onCancel: () => void;
  onSave: () => void;
}

export function FocusToolbar(props: FocusToolbarProps): JSX.Element {
  const engine = useEngine();

  const fmtFrame = (frame: number) =>
    formatElapsedTime(frame, engine.captureDelayMs());

  return (
    <div class={styles.focusToolbarRow}>
      <div class={styles.focusToolbarLeft}>
        <span class={styles.focusToolbarLabel}>
          <ScissorsIcon size={12} />
          Focus Range
        </span>

        <Show when={props.draft()}>
          {(d) => (
            <span class={styles.focusToolbarRange}>
              {fmtFrame(d().inFrame)} &rarr; {fmtFrame(d().outFrame)}
            </span>
          )}
        </Show>
      </div>

      <div class={styles.focusToolbarRight}>
        <button class={`${styles.focusToolbarBtn} ${styles.focusToolbarGold}`} onClick={props.onSetIn} title="Set in-point to playhead  [I]">
          <BracketInIcon size={10} /> Set In <kbd>I</kbd>
        </button>
        <button class={`${styles.focusToolbarBtn} ${styles.focusToolbarGold}`} onClick={props.onSetOut} title="Set out-point to playhead  [O]">
          <BracketOutIcon size={10} /> Set Out <kbd>O</kbd>
        </button>

        <div class={styles.focusToolbarSep} />

        <button class={styles.focusToolbarBtn} onClick={props.onClear}>
          Clear
        </button>
        <button class={styles.focusToolbarBtn} onClick={props.onCancel} title="Cancel  [Esc]">
          Cancel <kbd>Esc</kbd>
        </button>
        <button
          class={`${styles.focusToolbarBtn} ${styles.focusToolbarSave}`}
          onClick={props.onSave}
        >
          <CheckIcon size={12} /> Save
        </button>
      </div>
    </div>
  );
}
