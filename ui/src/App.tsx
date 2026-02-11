import type { JSX } from "solid-js";
import type { RouteSectionProps } from "@solidjs/router";
import { I18nProvider } from "./ui/hooks/useLocale";
import { CustomizeProvider } from "./ui/hooks/useCustomize";
import "leaflet/dist/leaflet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import "./ui/styles/variables.css";
import "./ui/styles/base.css";
import "./ui/styles/global.css";
import "./ui/styles/entities.css";
import "./ui/styles/leaflet.css";
import "./ui/styles/responsive.css";

/**
 * Root layout component.
 *
 * Provides i18n and customize contexts around routed page content.
 */
export function App(props: RouteSectionProps): JSX.Element {
  return (
    <I18nProvider>
      <CustomizeProvider>
        {props.children}
      </CustomizeProvider>
    </I18nProvider>
  );
}
