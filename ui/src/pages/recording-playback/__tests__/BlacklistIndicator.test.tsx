import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { BlacklistIndicator } from "../components/BlacklistIndicator";

afterEach(() => {
  cleanup();
});

describe("BlacklistIndicator", () => {
  it("shows total blacklisted marker count", () => {
    const [blacklist] = createSignal(new Set([1, 2]));
    const [markerCounts] = createSignal(
      new Map([
        [1, 3],
        [2, 5],
        [3, 10], // not blacklisted, should not count
      ]),
    );

    render(() => (
      <BlacklistIndicator blacklist={blacklist} markerCounts={markerCounts} />
    ));

    expect(screen.getByText("8 markers blacklisted")).toBeTruthy();
  });

  it("shows 0 when blacklisted players have no markers", () => {
    const [blacklist] = createSignal(new Set([99]));
    const [markerCounts] = createSignal(new Map<number, number>());

    render(() => (
      <BlacklistIndicator blacklist={blacklist} markerCounts={markerCounts} />
    ));

    expect(screen.getByText("0 markers blacklisted")).toBeTruthy();
  });
});
