import type { JSX } from "solid-js";
import type { RouteSectionProps } from "@solidjs/router";
import { I18nProvider } from "./hooks/useLocale";
import { CustomizeProvider } from "./hooks/useCustomize";
import { AuthProvider } from "./hooks/useAuth";
import "leaflet/dist/leaflet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles/variables.css";
import "./styles/base.css";
import "./styles/global.css";
import "./styles/entities.css";
import "./styles/leaflet.css";
import "./styles/responsive.css";

/**
 * Root layout component.
 *
 * Provides i18n, customize, and auth contexts around routed page content.
 */
export function App(props: RouteSectionProps): JSX.Element {
  return (
    <I18nProvider>
      <CustomizeProvider>
        <AuthProvider>
          {props.children}
        </AuthProvider>
      </CustomizeProvider>
    </I18nProvider>
  );
}
