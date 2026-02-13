import { createSignal, Show, For, onMount, onCleanup } from "solid-js";
import type { JSX } from "solid-js";
import { useEngine } from "../../../hooks/useEngine";
import { ChevronDownIcon } from "./Icons";
import styles from "./BottomBar.module.css";

const SPEEDS = [1, 2, 5, 10, 20, 30, 60];

export function SpeedSelector(): JSX.Element {
  const engine = useEngine();

  const [open, setOpen] = createSignal(false);
  let wrapperRef: HTMLDivElement | undefined;

  const handleClickOutside = (e: MouseEvent) => {
    if (wrapperRef && !wrapperRef.contains(e.target as Node)) {
      setOpen(false);
    }
  };

  onMount(() => {
    document.addEventListener("pointerdown", handleClickOutside);
  });

  onCleanup(() => {
    document.removeEventListener("pointerdown", handleClickOutside);
  });

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <button
        class={styles.speedBtn}
        onClick={() => setOpen((prev) => !prev)}
      >
        {engine.playbackSpeed()}x
        <ChevronDownIcon />
      </button>

      <Show when={open()}>
        <div class={styles.speedPopup}>
          <For each={SPEEDS}>
            {(s) => (
              <button
                class={styles.speedOption}
                classList={{
                  [styles.speedOptionActive]:
                    engine.playbackSpeed() === s,
                }}
                onClick={() => {
                  engine.setSpeed(s);
                  setOpen(false);
                }}
              >
                {s}x
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
