import { onCleanup } from "solid-js";

/**
 * Closes a signal-controlled dropdown when the user clicks outside a ref element.
 *
 * Must be called inside a reactive owner (component body or `createRoot`).
 *
 * @param ref  - Getter returning the container element (or `undefined` before mount)
 * @param setOpen - Setter to call with `false` on outside click
 */
export function useClickOutside(
  ref: () => HTMLElement | undefined,
  setOpen: (v: false) => void,
): void {
  const handler = (e: MouseEvent) => {
    const el = ref();
    if (el && !el.contains(e.target as Node)) {
      setOpen(false);
    }
  };

  document.addEventListener("pointerdown", handler);
  onCleanup(() => document.removeEventListener("pointerdown", handler));
}
