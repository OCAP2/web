import type { JSX } from "solid-js";
import { Show } from "solid-js";
import { useCustomize } from "../../../hooks/useCustomize";
import { leftPanelVisible } from "../shortcuts";
import styles from "./CustomizeLogo.module.css";

/**
 * Floating logo overlay from customize settings.
 * Positioned absolutely at bottom-left, shifting with the left panel.
 */
export function CustomizeLogo(): JSX.Element {
  const customize = useCustomize();

  return (
    <Show when={customize().websiteLogo}>
      {(logo) => {
        const size = () => customize().websiteLogoSize ?? "32px";
        const left = () =>
          leftPanelVisible()
            ? "calc(var(--pb-panel-width) + 25px)"
            : "25px";
        const img = () => (
          <img
            class={styles.logo}
            src={logo()}
            alt="Logo"
            style={{ width: size(), height: size(), left: left() }}
          />
        );
        return (
          <Show when={customize().websiteURL} fallback={img()}>
            {(url) => <a href={url()} target="_blank" rel="noopener noreferrer">{img()}</a>}
          </Show>
        );
      }}
    </Show>
  );
}
