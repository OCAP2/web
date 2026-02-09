import { onMount, onCleanup, createEffect } from "solid-js";
import type { JSX } from "solid-js";
import type { MapRenderer } from "../../renderers/renderer.interface";
import type { WorldConfig } from "../../data/types";

export interface MapContainerProps {
  renderer: MapRenderer;
  worldConfig?: WorldConfig;
}

/**
 * Map container component.
 * Creates a div that fills the viewport and initializes the renderer when
 * worldConfig becomes available. Handles resize events to keep the map responsive.
 */
export function MapContainer(props: MapContainerProps): JSX.Element {
  let containerRef!: HTMLDivElement;
  let initialized = false;

  createEffect(() => {
    const wc = props.worldConfig;
    if (wc && containerRef && !initialized) {
      initialized = true;
      props.renderer.init(containerRef, wc);
    }
  });

  onMount(() => {
    const onResize = () => {
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
      class="map-container"
      data-testid="map-container"
    />
  );
}
