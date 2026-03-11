import { describe, it, expect, afterEach } from "vitest";
import { createRoot } from "solid-js";
import { detectLocale, createI18n } from "../i18n";
import type { Locale } from "../i18n";
import { translations } from "../locales";

describe("detectLocale", () => {
  const originalNavigator = globalThis.navigator;

  function mockLanguage(lang: string) {
    Object.defineProperty(globalThis, "navigator", {
      value: { language: lang },
      writable: true,
      configurable: true,
    });
  }

  afterEach(() => {
    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
  });

  it("returns 'en' for English browser", () => {
    mockLanguage("en-US");
    expect(detectLocale()).toBe("en");
  });

  it("returns 'ru' for Russian browser", () => {
    mockLanguage("ru-RU");
    expect(detectLocale()).toBe("ru");
  });

  it("returns 'de' for German browser", () => {
    mockLanguage("de-DE");
    expect(detectLocale()).toBe("de");
  });

  it("returns 'cs' for Czech browser", () => {
    mockLanguage("cs");
    expect(detectLocale()).toBe("cs");
  });

  it("returns 'it' for Italian browser", () => {
    mockLanguage("it-IT");
    expect(detectLocale()).toBe("it");
  });

  it("falls back to 'en' for unsupported language", () => {
    mockLanguage("ja-JP");
    expect(detectLocale()).toBe("en");
  });

  it("falls back to 'en' for empty language", () => {
    mockLanguage("");
    expect(detectLocale()).toBe("en");
  });
});

describe("createI18n", () => {
  it("initializes with the provided locale", () => {
    createRoot((dispose) => {
      const i18n = createI18n("de");
      expect(i18n.locale()).toBe("de");
      dispose();
    });
  });

  it("t() returns correct string for English", () => {
    createRoot((dispose) => {
      const i18n = createI18n("en");
      expect(i18n.t("players")).toBe("Players");
      expect(i18n.t("events")).toBe("Events");
      expect(i18n.t("loading")).toBe("Loading...");
      dispose();
    });
  });

  it("t() returns correct string for Russian", () => {
    createRoot((dispose) => {
      const i18n = createI18n("ru");
      expect(i18n.t("players")).toBe("Игроки");
      expect(i18n.t("events")).toBe("События");
      dispose();
    });
  });

  it("t() returns correct string for German", () => {
    createRoot((dispose) => {
      const i18n = createI18n("de");
      expect(i18n.t("players")).toBe("Spieler");
      expect(i18n.t("close")).toBe("Schließen");
      dispose();
    });
  });

  it("t() returns correct string for Czech", () => {
    createRoot((dispose) => {
      const i18n = createI18n("cs");
      expect(i18n.t("players")).toBe("Hráči");
      expect(i18n.t("loading")).toBe("Načítání...");
      dispose();
    });
  });

  it("t() returns correct string for Italian", () => {
    createRoot((dispose) => {
      const i18n = createI18n("it");
      expect(i18n.t("players")).toBe("Giocatori");
      expect(i18n.t("close")).toBe("Chiudi");
      dispose();
    });
  });

  it("t() returns key itself for missing key", () => {
    createRoot((dispose) => {
      const i18n = createI18n("en");
      expect(i18n.t("nonexistent_key")).toBe("nonexistent_key");
      expect(i18n.t("another_missing")).toBe("another_missing");
      dispose();
    });
  });

  it("t() works with hyphenated keys", () => {
    createRoot((dispose) => {
      const i18n = createI18n("en");
      expect(i18n.t("play-pause")).toBe("Play/pause: space");
      expect(i18n.t("version-server")).toBe("Server version: ");
      expect(i18n.t("event_dis-connected")).toBe("Connects / Disconnects");
      dispose();
    });
  });

  it("setLocale switches language", () => {
    createRoot((dispose) => {
      const i18n = createI18n("en");
      expect(i18n.t("players")).toBe("Players");

      i18n.setLocale("ru");
      expect(i18n.locale()).toBe("ru");
      expect(i18n.t("players")).toBe("Игроки");

      i18n.setLocale("de");
      expect(i18n.locale()).toBe("de");
      expect(i18n.t("players")).toBe("Spieler");

      dispose();
    });
  });

  it("setLocale updates t() reactively", () => {
    createRoot((dispose) => {
      const i18n = createI18n("en");
      expect(i18n.t("close")).toBe("Close");

      i18n.setLocale("it");
      expect(i18n.t("close")).toBe("Chiudi");

      i18n.setLocale("cs");
      expect(i18n.t("close")).toBe("Zavřít");

      dispose();
    });
  });
});

describe("translations completeness", () => {
  const locales: Locale[] = ["en", "ru", "de", "cs", "it", "fr", "fi", "uk"];

  it("every key has all 8 locale entries", () => {
    for (const [key, entry] of Object.entries(translations)) {
      for (const locale of locales) {
        expect(
          entry[locale],
          `Missing locale '${locale}' for key '${key}'`,
        ).toBeDefined();
        expect(
          typeof entry[locale],
          `Translation for '${key}' in '${locale}' should be a string`,
        ).toBe("string");
      }
    }
  });

  it("has at least 50 translation keys (original has 58)", () => {
    const keyCount = Object.keys(translations).length;
    expect(keyCount).toBeGreaterThanOrEqual(50);
  });
});
