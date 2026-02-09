import { onMount, onCleanup } from "solid-js";
import type { JSX } from "solid-js";
import type { MapRenderer } from "../../renderers/renderer.interface";
import type { WorldConfig } from "../../data/types";

export interface MapContainerProps {
  renderer: MapRenderer;
  worldConfig?: WorldConfig;
}

/**
 * Map container component.
 * Creates a div that fills the viewport and initializes the renderer on mount.
 * Handles resize events to keep the map responsive.
 */
export function MapContainer(props: MapContainerProps): JSX.Element {
  let containerRef!: HTMLDivElement;

  onMount(() => {
    if (props.worldConfig) {
      props.renderer.init(containerRef, props.worldConfig);
    }

    const onResize = () => {
      // Trigger map invalidation by dispatching a resize on the container
      containerRef.dispatchEvent(new Event("resize"));
    };

    window.addEventListener("resize", onResize);

    onCleanup(() => {
      window.removeEventListener("resize", onResize);
    });
  });

  return (
    <div
      ref={containerRef}
      style={{
        width: "100vw",
        height: "100vh",
        position: "absolute",
        top: "0",
        left: "0",
      }}
      data-testid="map-container"
    />
  );
}
