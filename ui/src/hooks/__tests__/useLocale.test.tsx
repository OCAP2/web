import { describe, it, expect } from "vitest";
import { render } from "@solidjs/testing-library";
import { useI18n, I18nProvider } from "../useLocale";

describe("useI18n", () => {
  it("throws when used outside I18nProvider", () => {
    expect(() => {
      render(() => {
        useI18n();
        return <div />;
      });
    }).toThrow("useI18n must be used within an I18nProvider");
  });

  it("returns t, locale, and setLocale when used within I18nProvider", () => {
    let captured: ReturnType<typeof useI18n> | undefined;

    render(() => (
      <I18nProvider locale="en">
        {(() => {
          captured = useI18n();
          return <div />;
        })()}
      </I18nProvider>
    ));

    expect(captured).toBeDefined();
    expect(typeof captured!.t).toBe("function");
    expect(typeof captured!.setLocale).toBe("function");
    expect(captured!.locale()).toBe("en");
  });
});
