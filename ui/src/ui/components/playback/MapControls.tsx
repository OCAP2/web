import { createSignal, createMemo, For } from "solid-js";
import type { JSX, Accessor } from "solid-js";
import type { WorldConfig } from "../../../data/types";
import { useRenderer } from "../../hooks/useRenderer";
import styles from "./MapControls.module.css";

export interface MapControlsProps {
  worldConfig: Accessor<WorldConfig | undefined>;
}

interface StyleOption {
  name: string;
  available: boolean;
}

/**
 * Map zoom controls (right-center) and style switcher (bottom-right).
 */
export function MapControls(props: MapControlsProps): JSX.Element {
  const renderer = useRenderer();
  const [activeStyle, setActiveStyle] = createSignal("Topo");

  const handleZoomIn = () => {
    const zoom = renderer.getZoom();
    renderer.setView(renderer.getCenter(), zoom + 1);
  };

  const handleZoomOut = () => {
    const zoom = renderer.getZoom();
    renderer.setView(renderer.getCenter(), zoom - 1);
  };

  const styleOptions = createMemo((): StyleOption[] => {
    const wc = props.worldConfig();
    return [
      { name: "Topo", available: wc?.hasTopo ?? false },
      { name: "Dark", available: wc?.hasTopoDark ?? false },
      { name: "Relief", available: wc?.hasTopoRelief ?? false },
      { name: "Sat", available: wc?.hasColorRelief ?? false },
    ];
  });

  return (
    <>
      <div class={styles.zoomControls}>
        <button class={styles.zoomBtn} onClick={handleZoomIn} title="Zoom in">
          +
        </button>
        <button
          class={styles.zoomBtn}
          onClick={handleZoomOut}
          title="Zoom out"
        >
          {"\u2212"}
        </button>
      </div>
      <div class={styles.styleSwitcher}>
        <For each={styleOptions()}>
          {(opt) => (
            <button
              class={`${styles.styleBtn} ${
                activeStyle() === opt.name
                  ? styles.styleBtnActive
                  : styles.styleBtnDefault
              }`}
              onClick={() => setActiveStyle(opt.name)}
              disabled={!opt.available}
              title={opt.name}
            >
              {opt.name}
            </button>
          )}
        </For>
      </div>
    </>
  );
}
