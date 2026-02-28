import { createSignal, createMemo, Show, For } from "solid-js";
import type { JSX } from "solid-js";
import { useRenderer } from "../../../hooks/useRenderer";
import { useI18n } from "../../../hooks/useLocale";
import styles from "./MapControls.module.css";

/**
 * Map zoom controls (right-center) and style switcher (bottom-right).
 */
export function MapControls(): JSX.Element {
  const renderer = useRenderer();
  const { t } = useI18n();
  const [hoveredPreview, setHoveredPreview] = createSignal<string | null>(null);

  const handleZoomIn = () => {
    const zoom = renderer.getZoom();
    renderer.setView(renderer.getCenter(), zoom + 1);
  };

  const handleZoomOut = () => {
    const zoom = renderer.getZoom();
    renderer.setView(renderer.getCenter(), zoom - 1);
  };

  const availableStyles = createMemo(() =>
    renderer.mapStyles()
      .map((s, i) => ({ ...s, index: i }))
      .filter((s) => s.available),
  );

  return (
    <>
      <div class={styles.zoomControls}>
        <button class={styles.zoomBtn} onClick={handleZoomIn} title={t("zoom_in")}>
          +
        </button>
        <button
          class={styles.zoomBtn}
          onClick={handleZoomOut}
          title={t("zoom_out")}
        >
          {"\u2212"}
        </button>
      </div>
      <Show when={availableStyles().length > 1}>
        <div class={styles.styleSwitcher}>
          <For each={availableStyles()}>
            {(opt) => (
              <button
                class={`${styles.styleBtn} ${
                  renderer.activeStyleIndex() === opt.index
                    ? styles.styleBtnActive
                    : styles.styleBtnDefault
                }`}
                onClick={() => renderer.setMapStyle(opt.index)}
                title={opt.label}
                onMouseEnter={() => setHoveredPreview(opt.previewUrl ?? null)}
                onMouseLeave={() => setHoveredPreview(null)}
              >
                {opt.label}
              </button>
            )}
          </For>
        </div>
        <Show when={hoveredPreview()}>
          <div class={styles.previewTooltip}>
            <img
              class={styles.previewImage}
              src={hoveredPreview()!}
              alt="Style preview"
            />
          </div>
        </Show>
      </Show>
    </>
  );
}
