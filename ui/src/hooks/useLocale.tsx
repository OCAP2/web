import { createContext, useContext } from "solid-js";
import type { Accessor, JSX } from "solid-js";
import { createI18n } from "../i18n/i18n";
import type { I18n, Locale } from "../i18n/i18n";

const I18nContext = createContext<Accessor<I18n>>();

/**
 * Provider component that wraps the app with i18n context.
 */
export function I18nProvider(props: {
  locale?: Locale;
  children: JSX.Element;
}): JSX.Element {
  const locale = () => props.locale;
  const i18n = createI18n(locale());
  const accessor = () => i18n;
  return (
    <I18nContext.Provider value={accessor}>
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
  const i18n = ctx();
  return { t: i18n.t, locale: i18n.locale, setLocale: i18n.setLocale };
}
