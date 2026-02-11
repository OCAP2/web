import { createContext, useContext } from "solid-js";
import type { JSX } from "solid-js";
import { createI18n } from "../i18n/i18n";
import type { I18n, Locale } from "../i18n/i18n";

const I18nContext = createContext<I18n>();

/**
 * Provider component that wraps the app with i18n context.
 */
export function I18nProvider(props: {
  locale?: Locale;
  children: JSX.Element;
}): JSX.Element {
  const i18n = createI18n(props.locale);
  return (
    <I18nContext.Provider value={i18n}>
      {props.children}
    </I18nContext.Provider>
  );
}

/**
 * Hook to access the i18n system from any component within the I18nProvider.
 * Returns { t, locale, setLocale }.
 */
export function useI18n(): {
  t: I18n["t"];
  locale: I18n["locale"];
  setLocale: I18n["setLocale"];
} {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return { t: ctx.t, locale: ctx.locale, setLocale: ctx.setLocale };
}
