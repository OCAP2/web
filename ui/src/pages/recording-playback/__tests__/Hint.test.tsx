import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { Hint, showHint } from "../components/Hint";

beforeEach(() => {
  vi.useFakeTimers();
  // Reset module-level signal state by triggering showHint then clearing
  showHint("");
  vi.advanceTimersByTime(2000);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Hint", () => {
  it("is hidden when visible is false", () => {
    const [msg] = createSignal("Hidden message");
    const [vis] = createSignal(false);

    render(() => <Hint message={msg} visible={vis} />);

    expect(screen.queryByTestId("hint")).toBeNull();
  });

  it("shows message when visible is true", () => {
    const [msg] = createSignal("Test message");
    const [vis] = createSignal(true);

    render(() => <Hint message={msg} visible={vis} />);

    const hint = screen.getByTestId("hint");
    expect(hint).toBeTruthy();
    expect(hint.textContent).toBe("Test message");
  });

  it("showHint() makes component visible with correct message", () => {
    render(() => <Hint />);

    expect(screen.queryByTestId("hint")).toBeNull();

    showHint("Hello");

    const hint = screen.getByTestId("hint");
    expect(hint).toBeTruthy();
    expect(hint.textContent).toBe("Hello");
  });

  it("showHint() auto-dismisses after 2 seconds", () => {
    render(() => <Hint />);

    showHint("Temporary");

    expect(screen.getByTestId("hint")).toBeTruthy();

    vi.advanceTimersByTime(2000);

    expect(screen.queryByTestId("hint")).toBeNull();
  });

  it("calling showHint() again resets the timer", () => {
    render(() => <Hint />);

    showHint("First");
    vi.advanceTimersByTime(1500);

    // Still visible after 1.5s
    expect(screen.getByTestId("hint")).toBeTruthy();
    expect(screen.getByTestId("hint").textContent).toBe("First");

    // Call again — resets the 2s timer
    showHint("Second");
    vi.advanceTimersByTime(1500);

    // 1.5s after second call — still visible
    expect(screen.getByTestId("hint")).toBeTruthy();
    expect(screen.getByTestId("hint").textContent).toBe("Second");

    // Advance remaining 500ms — now it should dismiss
    vi.advanceTimersByTime(500);
    expect(screen.queryByTestId("hint")).toBeNull();
  });
});
