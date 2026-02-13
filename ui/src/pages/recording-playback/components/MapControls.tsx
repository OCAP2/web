import { createSignal, createMemo, createEffect, Show, For } from "solid-js";
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
  const [activeStyle, setActiveStyle] = createSignal(0);
  const [hoveredPreview, setHoveredPreview] = createSignal<string | null>(null);

  // Poll styles from renderer (they populate asynchronously after probing)
  const [styleList, setStyleList] = createSignal(renderer.getMapStyles());
  createEffect(() => {
    // Re-read styles periodically until all previews are loaded
    const id = setInterval(() => {
      const current = renderer.getMapStyles();
      setStyleList([...current]);
      // Stop polling once all available styles have previews (or after 15s)
      const allLoaded = current
        .filter((s) => s.available)
        .every((s) => s.previewUrl);
      if (allLoaded && current.length > 0) clearInterval(id);
    }, 500);
    setTimeout(() => clearInterval(id), 15_000);
  });

  // Sync active index from renderer
  createEffect(() => {
    setActiveStyle(renderer.getActiveStyleIndex());
  });

  const handleZoomIn = () => {
    const zoom = renderer.getZoom();
    renderer.setView(renderer.getCenter(), zoom + 1);
  };

  const handleZoomOut = () => {
    const zoom = renderer.getZoom();
    renderer.setView(renderer.getCenter(), zoom - 1);
  };

  const handleStyleClick = (index: number) => {
    renderer.setMapStyle(index);
    setActiveStyle(index);
  };

  const availableStyles = createMemo(() =>
    styleList()
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
                  activeStyle() === opt.index
                    ? styles.styleBtnActive
                    : styles.styleBtnDefault
                }`}
                onClick={() => handleStyleClick(opt.index)}
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
