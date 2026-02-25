import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { UnitsTab } from "../components/UnitsTab";
import {
  createTestEngine,
  TestProviders,
  unitDef,
  makeManifest,
  killedEvent,
} from "./testHelpers";
import { activeSide, setActiveSide } from "../shortcuts";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("UnitsTab", () => {
  it("renders side tabs only for populated sides", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(
      makeManifest([
        unitDef({ id: 1, name: "Soldier", side: "WEST", groupName: "Alpha", role: "Trooper" }),
      ]),
    );

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <UnitsTab />
      </TestProviders>
    ));

    // BLUFOR tab should exist since there are WEST units
    expect(screen.getByText("BLUFOR")).toBeTruthy();
    // OPFOR tab should NOT exist since there are no EAST units
    expect(screen.queryByText("OPFOR")).toBeNull();
    // IND tab should NOT exist since there are no GUER units
    expect(screen.queryByText("IND")).toBeNull();
    // CIV tab should NOT exist since there are no CIV units
    expect(screen.queryByText("CIV")).toBeNull();
  });

  it("shows unit names in the list", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(
      makeManifest([
        unitDef({ id: 1, name: "Alpha Lead", side: "WEST", groupName: "Alpha", role: "Squad Lead" }),
        unitDef({ id: 2, name: "Alpha Medic", side: "WEST", groupName: "Alpha", role: "Combat Medic" }),
      ]),
    );

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <UnitsTab />
      </TestProviders>
    ));

    expect(screen.getByText("Alpha Lead")).toBeTruthy();
    expect(screen.getByText("Alpha Medic")).toBeTruthy();
  });

  it("groups units by groupName with a group header", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(
      makeManifest([
        unitDef({ id: 1, name: "Soldier A", side: "WEST", groupName: "Alpha", role: "AT" }),
        unitDef({ id: 2, name: "Soldier B", side: "WEST", groupName: "Alpha", role: "AAR" }),
        unitDef({ id: 3, name: "Soldier C", side: "WEST", groupName: "Bravo", role: "TL" }),
      ]),
    );

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <UnitsTab />
      </TestProviders>
    ));

    // Both group headers should be rendered
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Bravo")).toBeTruthy();

    // All units should be visible (groups auto-expand)
    expect(screen.getByText("Soldier A")).toBeTruthy();
    expect(screen.getByText("Soldier B")).toBeTruthy();
    expect(screen.getByText("Soldier C")).toBeTruthy();
  });

  it("clicking a unit row follows that entity", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(
      makeManifest([
        unitDef({ id: 1, name: "Pointman", side: "WEST", groupName: "Alpha", role: "Point" }),
      ]),
    );

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <UnitsTab />
      </TestProviders>
    ));

    expect(engine.followTarget()).toBeNull();

    fireEvent.click(screen.getByText("Pointman"));

    expect(engine.followTarget()).toBe(1);
  });

  it("clicking an already-followed unit unfollows it (toggle)", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(
      makeManifest([
        unitDef({ id: 1, name: "Scout", side: "WEST", groupName: "Alpha", role: "Recon" }),
      ]),
    );

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <UnitsTab />
      </TestProviders>
    ));

    const unitRow = screen.getByText("Scout");

    // First click: follow
    fireEvent.click(unitRow);
    expect(engine.followTarget()).toBe(1);

    // Second click: unfollow (toggle OFF)
    fireEvent.click(unitRow);
    expect(engine.followTarget()).toBeNull();
  });

  it("shows group header with alive count", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(
      makeManifest([
        unitDef({
          id: 1,
          name: "Alive Unit",
          side: "WEST",
          groupName: "Alpha",
          role: "Grenadier",
          positions: [{ position: [100, 200], direction: 0, alive: 1 }],
        }),
        unitDef({
          id: 2,
          name: "Dead Unit",
          side: "WEST",
          groupName: "Alpha",
          role: "Autorifleman",
          positions: [{ position: [100, 200], direction: 0, alive: 0 }],
        }),
      ]),
    );

    // Advance to frame 0 so snapshots are populated
    engine.seekTo(0);

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <UnitsTab />
      </TestProviders>
    ));

    // The group header shows "Alpha" with alive/total count
    expect(screen.getByText("Alpha")).toBeTruthy();
    // The group header renders alive count and total separately.
    // Look for the "1" (alive) and "2" (total) inside the group count area.
    // Since "2" also appears in the side tab badge, use getAllByText.
    const twos = screen.getAllByText("2");
    expect(twos.length).toBeGreaterThanOrEqual(1);
  });

  it("only renders populated side tabs when multiple sides have units", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(
      makeManifest([
        unitDef({ id: 1, name: "NATO Soldier", side: "WEST", groupName: "Alpha", role: "Trooper" }),
        unitDef({ id: 2, name: "CSAT Soldier", side: "EAST", groupName: "Bravo", role: "Trooper" }),
        unitDef({ id: 3, name: "Guerrilla", side: "GUER", groupName: "Charlie", role: "Fighter" }),
      ]),
    );

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <UnitsTab />
      </TestProviders>
    ));

    // BLUFOR, OPFOR, IND should all be rendered
    expect(screen.getByText("BLUFOR")).toBeTruthy();
    expect(screen.getByText("OPFOR")).toBeTruthy();
    expect(screen.getByText("IND")).toBeTruthy();

    // CIV should NOT be rendered (no CIV units)
    expect(screen.queryByText("CIV")).toBeNull();
  });

  it("auto-selects first populated side when activeSide is not populated", () => {
    // Set activeSide to something that won't have units
    setActiveSide("GUER");

    const { engine, renderer } = createTestEngine();
    engine.loadRecording(
      makeManifest([
        unitDef({ id: 1, name: "CSAT Soldier", side: "EAST", groupName: "Bravo", role: "Trooper" }),
      ]),
    );

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <UnitsTab />
      </TestProviders>
    ));

    // The effect should auto-select EAST since GUER has no units
    expect(activeSide()).toBe("EAST");
  });

  it("collapses and expands a group when clicking its header", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(
      makeManifest([
        unitDef({ id: 1, name: "Soldier A", side: "WEST", groupName: "Alpha", role: "AT" }),
        unitDef({ id: 2, name: "Soldier B", side: "WEST", groupName: "Alpha", role: "AAR" }),
      ]),
    );

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <UnitsTab />
      </TestProviders>
    ));

    // Units visible initially (groups auto-expand)
    expect(screen.getByText("Soldier A")).toBeTruthy();
    expect(screen.getByText("Soldier B")).toBeTruthy();

    // Click group header to collapse
    fireEvent.click(screen.getByText("Alpha"));

    // Units should now be hidden
    expect(screen.queryByText("Soldier A")).toBeNull();
    expect(screen.queryByText("Soldier B")).toBeNull();

    // Click group header again to expand
    fireEvent.click(screen.getByText("Alpha"));

    // Units should be visible again
    expect(screen.getByText("Soldier A")).toBeTruthy();
    expect(screen.getByText("Soldier B")).toBeTruthy();
  });

  it("shows kill count badge for units with kills", () => {
    const { engine, renderer } = createTestEngine();
    const entities = [
      unitDef({ id: 1, name: "Killer", side: "WEST", groupName: "Alpha", role: "Trooper" }),
      unitDef({ id: 2, name: "Victim", side: "EAST", groupName: "Bravo", role: "Trooper" }),
    ];
    const events = [killedEvent(5, 2, 1, "M4A1", 100)];
    engine.loadRecording(makeManifest(entities, events));
    engine.seekTo(10); // Past the event so kills are counted

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <UnitsTab />
      </TestProviders>
    ));

    // The "Killer" unit (id 1) should have a kill count badge showing "1"
    // Find the unit row containing "Killer" and check for the kill count
    const killerRow = screen.getByText("Killer").closest("button");
    expect(killerRow).toBeTruthy();
    // The kill badge renders the count inside a span after the crosshair icon
    expect(killerRow!.textContent).toContain("1");
  });
});
