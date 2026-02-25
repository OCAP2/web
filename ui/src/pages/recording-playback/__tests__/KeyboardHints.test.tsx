import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import { KeyboardHints } from "../components/KeyboardHints";

afterEach(() => {
  cleanup();
});

describe("KeyboardHints", () => {
  it("renders both hint items with correct keys", () => {
    const { container } = render(() => <KeyboardHints />);

    const kbds = container.querySelectorAll("kbd");
    const kbdTexts = Array.from(kbds).map((el) => el.textContent);

    expect(kbdTexts).toContain("Space");
    expect(kbdTexts).toContain("E");
  });

  it("shows correct action labels", () => {
    render(() => <KeyboardHints />);

    expect(screen.getByText("Play/Pause")).toBeTruthy();
    expect(screen.getByText("Panel")).toBeTruthy();
  });
});
