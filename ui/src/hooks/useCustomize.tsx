import { createContext, useContext, createSignal, onMount, onCleanup } from "solid-js";
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
  let appliedProps: string[] = [];

  onMount(async () => {
    try {
      const api = new ApiClient();
      const data = await api.getCustomize();
      if (!data.enabled) {
        // disableKillCount is a privacy toggle, not a branding option, so
        // honor it even when customize itself is not enabled.
        if (data.disableKillCount) {
          setConfig({ disableKillCount: true });
        }
        return;
      }
      setConfig(data);

      // Apply CSS variable overrides to :root
      if (data.cssOverrides) {
        const style = document.documentElement.style;
        for (const [prop, value] of Object.entries(data.cssOverrides)) {
          if (prop.startsWith("--")) {
            style.setProperty(prop, value);
            appliedProps.push(prop);
          }
        }
      }
    } catch (err) {
      console.error("Failed to fetch customize config:", err);
    }
  });

  onCleanup(() => {
    const style = document.documentElement.style;
    for (const prop of appliedProps) {
      style.removeProperty(prop);
    }
    appliedProps = [];
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
