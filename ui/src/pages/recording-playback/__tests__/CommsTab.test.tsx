import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";

import { CommsTab } from "../components/CommsTab";
import type { EventDef } from "../../../data/types";
import { createTestEngine, TestProviders, unitDef, makeManifest } from "./testHelpers";

afterEach(cleanup);

function radio(frequency: number) {
  return {
    class: "TFAR_anprc152_1",
    mod: "TFAR",
    type: "SW",
    channel: 1,
    frequency,
    code: "",
    rangeMeters: 5000,
    additional: false,
  };
}

function radioSnapshot(unitId: number, frequency: number): EventDef {
  return {
    type: "radioSnapshot",
    frameNum: 0,
    payload: { unitId, playerUid: `uid${unitId}`, radios: [radio(frequency)] },
  } as unknown as EventDef;
}

/**
 * Three players on two nets: Alpha and Bravo share 100.000, Charlie sits alone
 * on 200.000. Two nets is the minimum that can show whether opening one closes
 * the other.
 */
function renderComms() {
  const { engine, renderer } = createTestEngine();
  const positions = [{ position: [100, 200] as [number, number], direction: 0, alive: 1 as const }];

  engine.loadRecording(
    makeManifest(
      [
        unitDef({ id: 1, name: "Alpha", positions }),
        unitDef({ id: 2, name: "Bravo", positions }),
        unitDef({ id: 3, name: "Charlie", positions }),
      ],
      [radioSnapshot(1, 100), radioSnapshot(2, 100), radioSnapshot(3, 200)],
    ),
  );

  render(() => (
    <TestProviders engine={engine} renderer={renderer}>
      <CommsTab />
    </TestProviders>
  ));

  return { engine };
}

const NET_A = "100 MHz";
const NET_B = "200 MHz";

/** The net header is the clickable row; the members live under it. */
function header(label: string): HTMLElement {
  return screen.getByText(label).closest("button") as HTMLElement;
}

describe("CommsTab net list", () => {
  it("lists every net", () => {
    renderComms();
    expect(screen.getByText(NET_A)).toBeTruthy();
    expect(screen.getByText(NET_B)).toBeTruthy();
  });

  // A mission can run a dozen nets. Opening them all by default turns the tab
  // into a wall of rosters and buries the index of which nets existed at all.
  it("starts with every net collapsed", () => {
    renderComms();

    expect(screen.queryByText("Alpha")).toBeNull();
    expect(screen.queryByText("Bravo")).toBeNull();
    expect(screen.queryByText("Charlie")).toBeNull();
  });

  it("expands a net when its header is clicked", () => {
    renderComms();

    fireEvent.click(header(NET_A));

    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Bravo")).toBeTruthy();
  });

  it("collapses the same net again on a second click", () => {
    renderComms();

    fireEvent.click(header(NET_A));
    fireEvent.click(header(NET_A));

    expect(screen.queryByText("Alpha")).toBeNull();
  });

  // The regression this replaced: a single-open accordion closed one net the
  // moment another was opened, so two nets could never be compared side by side.
  it("keeps nets open independently of each other", () => {
    renderComms();

    fireEvent.click(header(NET_A));
    fireEvent.click(header(NET_B));

    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Charlie")).toBeTruthy();
  });

  it("closing one net leaves the others open", () => {
    renderComms();

    fireEvent.click(header(NET_A));
    fireEvent.click(header(NET_B));
    fireEvent.click(header(NET_A));

    expect(screen.queryByText("Alpha")).toBeNull();
    expect(screen.getByText("Charlie")).toBeTruthy();
  });

  it("reports its expanded state to assistive tech", () => {
    renderComms();

    expect(header(NET_A).getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(header(NET_A));
    expect(header(NET_A).getAttribute("aria-expanded")).toBe("true");
  });
});
