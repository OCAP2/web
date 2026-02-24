import { createContext, useContext, createSignal, onMount } from "solid-js";
import type { JSX } from "solid-js";
import type { Accessor } from "solid-js";
import { ApiClient } from "../data/apiClient";
import type { CustomizeConfig } from "../data/apiClient";

const CustomizeContext = createContext<Accessor<CustomizeConfig>>();

/**
 * Provider that fetches /api/v1/customize on mount and shares the config app-wide.
 */
export function CustomizeProvider(props: {
  children: JSX.Element;
}): JSX.Element {
  const [config, setConfig] = createSignal<CustomizeConfig>({});

  onMount(async () => {
    try {
      const api = new ApiClient();
      const data = await api.getCustomize();
      setConfig(data);
    } catch (err) {
      console.error("Failed to fetch customize config:", err);
    }
  });

  return (
    <CustomizeContext.Provider value={config}>
      {props.children}
    </CustomizeContext.Provider>
  );
}

/**
 * Hook to access customize settings from any component within the CustomizeProvider.
 */
export function useCustomize(): Accessor<CustomizeConfig> {
  const ctx = useContext(CustomizeContext);
  if (!ctx) {
    throw new Error("useCustomize must be used within a CustomizeProvider");
  }
  return ctx;
}
