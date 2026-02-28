import { createContext, useContext } from "solid-js";
import type { Accessor, JSX } from "solid-js";
import type { PlaybackEngine } from "../playback/engine";

const EngineContext = createContext<Accessor<PlaybackEngine>>();

/**
 * Provider component that wraps children with PlaybackEngine context.
 */
export function EngineProvider(props: {
  engine: PlaybackEngine;
  children: JSX.Element;
}): JSX.Element {
  const engine = () => props.engine;
  return (
    <EngineContext.Provider value={engine}>
      {props.children}
    </EngineContext.Provider>
  );
}

/**
 * Hook to access the PlaybackEngine from any component within the EngineProvider.
 * Throws a descriptive error if used outside the provider.
 */
export function useEngine(): PlaybackEngine {
  const ctx = useContext(EngineContext);
  if (!ctx) {
    throw new Error("useEngine must be used within an EngineProvider");
  }
  return ctx();
}
