import { createSignal } from "solid-js";
import type { Accessor } from "solid-js";
import { translations, LOCALES } from "./locales";
import type { Locale } from "./locales";

export type { Locale };
export { LOCALES };

/**
 * Detect locale from navigator.language, falling back to 'en'.
 * Extracts the first two characters and checks against supported locales.
 */
const STORAGE_KEY = "current_lang";

export function detectLocale(): Locale {
  // Check localStorage first (user's previous choice)
  if (typeof localStorage !== "undefined") {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && LOCALES.includes(stored as Locale)) {
      return stored as Locale;
    }
  }
  if (typeof navigator === "undefined" || !navigator.language) {
    return "en";
  }
  const lang = navigator.language.substring(0, 2).toLowerCase();
  if (LOCALES.includes(lang as Locale)) {
    return lang as Locale;
  }
  return "en";
}

export interface I18n {
  locale: Accessor<Locale>;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
}

/**
 * Create an i18n system backed by SolidJS signals.
 * Returns a reactive locale accessor, a setter, and a translation function.
 */
export function createI18n(initialLocale?: Locale): I18n {
  const [locale, rawSetLocale] = createSignal<Locale>(
    initialLocale ?? detectLocale(),
  );

  function setLocale(loc: Locale) {
    rawSetLocale(loc);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, loc);
    }
  }

  function t(key: string): string {
    const entry = translations[key];
    if (!entry) {
      return key;
    }
    return entry[locale()] ?? entry["en"] ?? key;
  }

  return { locale, setLocale, t };
}
