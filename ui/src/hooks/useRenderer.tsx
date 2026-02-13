import { createContext, useContext } from "solid-js";
import type { JSX } from "solid-js";
import type { MapRenderer } from "../renderers/renderer.interface";

const RendererContext = createContext<MapRenderer>();

/**
 * Provider component that wraps children with MapRenderer context.
 */
export function RendererProvider(props: {
  renderer: MapRenderer;
  children: JSX.Element;
}): JSX.Element {
  return (
    <RendererContext.Provider value={props.renderer}>
      {props.children}
    </RendererContext.Provider>
  );
}

/**
 * Hook to access the MapRenderer from any component within the RendererProvider.
 * Throws a descriptive error if used outside the provider.
 */
export function useRenderer(): MapRenderer {
  const ctx = useContext(RendererContext);
  if (!ctx) {
    throw new Error("useRenderer must be used within a RendererProvider");
  }
  return ctx;
}
