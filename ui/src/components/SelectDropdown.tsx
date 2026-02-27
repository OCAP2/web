import { createSignal, Show, For } from "solid-js";
import type { JSX, Accessor } from "solid-js";
import { ChevronDownIcon } from "./Icons";
import { useClickOutside } from "../hooks/useClickOutside";
import styles from "./SelectDropdown.module.css";

export interface SelectDropdownProps<T extends string> {
  value: Accessor<T>;
  options: readonly T[];
  getLabel: (option: T) => string;
  onSelect: (option: T) => void;
  isDisabled?: (option: T) => boolean;
  wide?: boolean;
}

export function SelectDropdown<T extends string>(
  props: SelectDropdownProps<T>,
): JSX.Element {
  const [open, setOpen] = createSignal(false);
  let wrapperRef: HTMLDivElement | undefined;
  useClickOutside(() => wrapperRef, setOpen);

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <button
        class={styles.trigger}
        classList={{ [styles.triggerWide]: !!props.wide }}
        onClick={() => setOpen((v) => !v)}
      >
        {props.getLabel(props.value())}
        <ChevronDownIcon />
      </button>

      <Show when={open()}>
        <div
          class={styles.popup}
          classList={{ [styles.popupWide]: !!props.wide }}
        >
          <For each={[...props.options]}>
            {(option) => {
              const disabled = () => props.isDisabled?.(option) ?? false;
              return (
                <button
                  class={styles.option}
                  classList={{
                    [styles.optionActive]: props.value() === option,
                    [styles.optionDisabled]: disabled(),
                  }}
                  disabled={disabled()}
                  onClick={() => {
                    props.onSelect(option);
                    setOpen(false);
                  }}
                >
                  {props.getLabel(option)}
                </button>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}
