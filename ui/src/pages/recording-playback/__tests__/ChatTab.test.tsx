import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import { ChatTab } from "../components/ChatTab";
import { I18nProvider } from "../../../hooks/useLocale";

afterEach(() => {
  cleanup();
});

describe("ChatTab", () => {
  it("renders the chat unavailable message", () => {
    render(() => (
      <I18nProvider locale="en">
        <ChatTab />
      </I18nProvider>
    ));

    expect(
      screen.getByText("Chat messages not available for this recording"),
    ).toBeTruthy();
  });
});
