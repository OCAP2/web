import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { FollowIndicator } from "../components/FollowIndicator";
import {
  createTestEngine,
  TestProviders,
  unitDef,
  makeManifest,
} from "./test-helpers";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("FollowIndicator", () => {
  it("is hidden when no follow target is set", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadOperation(makeManifest([unitDef()]));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <FollowIndicator />
      </TestProviders>
    ));

    expect(screen.queryByTestId("follow-indicator")).toBeNull();
  });

  it("shows chip with unit name when following", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadOperation(makeManifest([unitDef({ id: 1, name: "Rifleman" })]));
    engine.followEntity(1);

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <FollowIndicator />
      </TestProviders>
    ));

    expect(screen.queryByTestId("follow-indicator")).not.toBeNull();
    expect(screen.getByText("Rifleman")).toBeTruthy();
  });

  it("shows side-colored dot when snapshot has side", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadOperation(
      makeManifest([unitDef({ id: 1, name: "Grenadier", side: "WEST" })]),
    );
    engine.followEntity(1);

    const { container } = render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <FollowIndicator />
      </TestProviders>
    ));

    // The dot is a span inside the chip with an inline background style
    const chip = screen.getByTestId("follow-indicator");
    const dot = chip.querySelector("span[style]");
    expect(dot).not.toBeNull();
    expect(dot!.getAttribute("style")).toContain("background");
  });

  it("close button calls unfollowEntity", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadOperation(makeManifest([unitDef({ id: 1, name: "Medic" })]));
    engine.followEntity(1);

    const unfollowSpy = vi.spyOn(engine, "unfollowEntity");

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <FollowIndicator />
      </TestProviders>
    ));

    const closeBtn = screen.getByLabelText("Stop following");
    fireEvent.click(closeBtn);

    expect(unfollowSpy).toHaveBeenCalledOnce();
  });

  it("hides when follow target is cleared", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadOperation(makeManifest([unitDef({ id: 1, name: "Sniper" })]));
    engine.followEntity(1);

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <FollowIndicator />
      </TestProviders>
    ));

    // Chip should be visible while following
    expect(screen.queryByTestId("follow-indicator")).not.toBeNull();

    // Clear the follow target
    engine.unfollowEntity();

    // Chip should disappear
    expect(screen.queryByTestId("follow-indicator")).toBeNull();
  });
});
