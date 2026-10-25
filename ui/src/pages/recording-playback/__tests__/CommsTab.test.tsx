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

import { vi } from "vitest";

function transmission(frameNum: number, unitId: number, action: "Start" | "Stop", frequency: number): EventDef {
  return {
    type: "radioTransmission",
    frameNum,
    payload: { unitId, radio: "TFAR_anprc152", type: "SW", action, channel: 1, additional: false, frequency, code: "" },
  };
}

/** A player whose radio snapshot carries no radios: no net, no range guess. */
function bareSnapshot(unitId: number): EventDef {
  return {
    type: "radioSnapshot",
    frameNum: 0,
    payload: { unitId, playerUid: `uid${unitId}`, radios: [] },
  } as unknown as EventDef;
}


/** Engine snapshot effects settle on the microtask queue after a seek. */
async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}


/** Entity states for every frame 0..100, so snapshots resolve at any playhead. */
function stillAt(x: number, y: number) {
  return Array.from({ length: 101 }, () => ({ position: [x, y] as [number, number], direction: 0, alive: 1 as const }));
}


describe("CommsTab transmissions", () => {
  // Alpha keys up on net 100; Bravo shares the net from the same spot; Charlie
  // is on the same net but 9 km away — beyond the radio's 5000 m range.
  function renderNet() {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(
      makeManifest(
        [
          unitDef({ id: 1, name: "Alpha", positions: stillAt(100, 200) }),
          unitDef({ id: 2, name: "Bravo", positions: stillAt(100, 200) }),
          unitDef({ id: 3, name: "Charlie", positions: stillAt(9100, 200) }),
        ],
        [
          radioSnapshot(1, 100),
          radioSnapshot(2, 100),
          radioSnapshot(3, 100),
          transmission(5, 1, "Start", 100),
          transmission(15, 1, "Stop", 100),
        ],
      ),
    );
    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <CommsTab />
      </TestProviders>
    ));
    return { engine };
  }

  it("counts who could hear a live transmission from where they stood", async () => {
    const { engine } = renderNet();
    engine.seekTo(10);
    await settle();

    // Charlie is out of range, Bravo in: 1 of 2 peers heard.
    expect(screen.getByText("1/2")).toBeTruthy();
  });

  it("seeks to the transmission's start and opens its net on click", async () => {
    const { engine } = renderNet();
    engine.seekTo(10);
    await settle();

    const seek = vi.spyOn(engine, "seekTo");
    fireEvent.click(screen.getByText("Alpha"));
    expect(seek).toHaveBeenCalledWith(5);
    seek.mockRestore();

    // The net opened, so the roster is visible.
    expect(screen.getByText("Bravo")).toBeTruthy();
  });

  it("pans to a member when their roster row is clicked", async () => {
    const { engine } = renderNet();
    engine.seekTo(10);
    await settle();
    fireEvent.click(screen.getByText("Alpha")); // opens net A
    expect(screen.getByText("Bravo")).toBeTruthy();

    const pan = vi.spyOn(engine, "panToEntity");
    fireEvent.click(screen.getByText("Bravo"));
    expect(pan).toHaveBeenCalledWith(2);
    pan.mockRestore();
  });

  it("keeps only transmissions near the playhead", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(
      makeManifest(
        [unitDef({ id: 1, name: "Alpha", positions: stillAt(100, 200) })],
        [radioSnapshot(1, 100), transmission(800, 1, "Start", 100), transmission(820, 1, "Stop", 100)],
        900,
      ),
    );
    engine.seekTo(10);
    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <CommsTab />
      </TestProviders>
    ));

    expect(screen.getByText("No transmissions near the playhead")).toBeTruthy();
  });

  it("searches transmissions by speaker, net and radio", async () => {
    const { engine } = renderNet();
    engine.seekTo(10);
    await settle();
    const input = screen.getByPlaceholderText("Search radios...") as HTMLInputElement;

    fireEvent.input(input, { target: { value: "alpha" } });
    expect(screen.getByText("1/2")).toBeTruthy();

    // Radio model match also surfaces the row.
    fireEvent.input(input, { target: { value: "anprc152" } });
    expect(screen.getByText("1/2")).toBeTruthy();

    // ...and so does the formatted net.
    fireEvent.input(input, { target: { value: "100 mhz" } });
    expect(screen.getByText("1/2")).toBeTruthy();

    fireEvent.input(input, { target: { value: "zzz" } });
    expect(screen.getByText("No transmissions match this search")).toBeTruthy();
  });

  it("narrows nets to a member hit and opens it without touching the others", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(
      makeManifest(
        [
          unitDef({ id: 1, name: "Alpha", positions: stillAt(100, 200) }),
          unitDef({ id: 2, name: "Bravo", positions: stillAt(100, 200) }),
          unitDef({ id: 3, name: "Charlie", positions: stillAt(9100, 200) }),
        ],
        [radioSnapshot(1, 100), radioSnapshot(2, 100), radioSnapshot(3, 200)],
      ),
    );
    engine.seekTo(0);
    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <CommsTab />
      </TestProviders>
    ));

    const input = screen.getByPlaceholderText("Search radios...") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "charlie" } });

    // The member hit keeps its net alone, auto-expanded so the match shows.
    expect(screen.queryByText("100 MHz")).toBeNull();
    expect(screen.getByText("200 MHz")).toBeTruthy();
    expect(screen.getByText("Charlie")).toBeTruthy();

    // A net-label hit keeps the roster; a member hit opens the net. Searching
    // the label itself only lists the net without expanding it.
    fireEvent.input(input, { target: { value: "200" } });
    expect(screen.getByText("200 MHz")).toBeTruthy();

    fireEvent.input(input, { target: { value: "zzz" } });
    expect(screen.getByText("No nets match this search")).toBeTruthy();
  });

  it("falls back to the unit id when a speaker has no entity and no range to a radio", async () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(
      makeManifest(
        [unitDef({ id: 1, name: "Alpha", positions: stillAt(100, 200) })],
        [
          bareSnapshot(9),
          transmission(5, 9, "Start", 100),
          transmission(15, 9, "Stop", 100),
        ],
      ),
    );
    engine.seekTo(10);
    await settle();
    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <CommsTab />
      </TestProviders>
    ));

    // Unknown unit names resolve to `Unit 9`, and with no snapshot radio the row
    // carries no heard count (the addon's fallback range applies silently).
    expect(screen.getByText("Unit 9")).toBeTruthy();
    expect(screen.queryByText(/\/\d/)).toBeNull();
  });

  it("shows the no-data placeholder without radio data", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(
      makeManifest([unitDef({ id: 1, name: "Alpha", positions: stillAt(100, 200) })], []),
    );
    engine.seekTo(0);
    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <CommsTab />
      </TestProviders>
    ));

    expect(screen.getByText("No radio data in this recording")).toBeTruthy();
  });
});
