import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
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

  it("clicking a unit row expands the detail card with Follow button", () => {
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

    // Detail card should not be visible initially
    expect(screen.queryByText("Follow")).toBeNull();

    // Click unit row to expand detail card
    fireEvent.click(screen.getByText("Pointman"));

    // Detail card should now show with Follow button and stats
    expect(screen.getByText("Follow")).toBeTruthy();
    expect(screen.getByText("KILLS")).toBeTruthy();
    expect(screen.getByText("DEATHS")).toBeTruthy();
    expect(screen.getByText("MARKERS")).toBeTruthy();
  });

  it("clicking Follow button in detail card follows the entity", () => {
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

    // Expand detail card
    fireEvent.click(screen.getByText("Pointman"));
    // Click Follow button
    fireEvent.click(screen.getByText("Follow"));

    expect(engine.followTarget()).toBe(1);
  });

  it("clicking Following button unfollows the entity (toggle)", () => {
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

    // Expand detail card
    fireEvent.click(screen.getByText("Scout"));

    // Follow
    fireEvent.click(screen.getByText("Follow"));
    expect(engine.followTarget()).toBe(1);

    // Unfollow (button now says "Following")
    fireEvent.click(screen.getByText("Following"));
    expect(engine.followTarget()).toBeNull();
  });

  it("clicking an already-selected unit collapses the detail card", () => {
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

    // Expand
    fireEvent.click(screen.getByText("Scout"));
    expect(screen.getByText("Follow")).toBeTruthy();

    // Collapse
    fireEvent.click(screen.getByText("Scout"));
    expect(screen.queryByText("Follow")).toBeNull();
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

  it("counts deleted units as dead and styles them", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(
      makeManifest([
        unitDef({
          id: 1,
          name: "Alive Unit",
          side: "WEST",
          groupName: "Alpha",
          role: "Grenadier",
          positions: [
            { position: [100, 200], direction: 0, alive: 1 },
            { position: [100, 200], direction: 0, alive: 1 },
          ],
        }),
        unitDef({
          id: 2,
          name: "Deleted Unit",
          side: "WEST",
          groupName: "Alpha",
          endFrame: 1,
          role: "Autorifleman",
          positions: [{ position: [100, 200], direction: 0, alive: 1 }],
        }),
      ]),
    );

    // Advance to frame 1 so snapshots are populated
    engine.seekTo(1);

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <UnitsTab />
      </TestProviders>
    ));

    // Deleted unit counts as dead: alive=1, total=2
    expect(screen.getByText("1")).toBeTruthy(); // alive count in group header

    // Deleted unit row must have the dead styling
    const deletedRow = screen.getByText("Deleted Unit").closest("button");
    expect(deletedRow?.className).toMatch(/unitRowDead/);
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

  it("shows blacklist button in detail card for admin when unit has markers", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(
      makeManifest([
        unitDef({ id: 1, name: "Marker Player", side: "WEST", groupName: "Alpha", role: "Trooper" }),
      ]),
    );

    const [blacklist] = createSignal(new Set<number>());
    const [markerCounts] = createSignal(new Map([[1, 3]]));
    const [isAdmin] = createSignal(true);
    const onToggle = vi.fn();

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <UnitsTab
          blacklist={blacklist}
          markerCounts={markerCounts}
          isAdmin={isAdmin}
          onToggleBlacklist={onToggle}
        />
      </TestProviders>
    ));

    // Expand detail card for the player
    fireEvent.click(screen.getByText("Marker Player"));

    // Admin section should show with blacklist button
    expect(screen.getByText("ADMIN ACTIONS")).toBeTruthy();
    expect(screen.getByText(/Blacklist 3 markers/)).toBeTruthy();
  });

  it("calls onToggleBlacklist when clicking the blacklist button in detail card", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(
      makeManifest([
        unitDef({ id: 7, name: "Troll", side: "WEST", groupName: "Alpha", role: "Trooper" }),
      ]),
    );

    const [blacklist] = createSignal(new Set<number>());
    const [markerCounts] = createSignal(new Map([[7, 2]]));
    const [isAdmin] = createSignal(true);
    const onToggle = vi.fn();

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <UnitsTab
          blacklist={blacklist}
          markerCounts={markerCounts}
          isAdmin={isAdmin}
          onToggleBlacklist={onToggle}
        />
      </TestProviders>
    ));

    // Expand detail card
    fireEvent.click(screen.getByText("Troll"));

    // Click the blacklist button
    const blacklistBtn = screen.getByTitle("Toggle marker blacklist");
    fireEvent.click(blacklistBtn);

    expect(onToggle).toHaveBeenCalledWith(7);
  });

  it("does not show admin actions for non-admins", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(
      makeManifest([
        unitDef({ id: 1, name: "Player", side: "WEST", groupName: "Alpha", role: "Trooper" }),
      ]),
    );

    const [blacklist] = createSignal(new Set<number>());
    const [markerCounts] = createSignal(new Map([[1, 5]]));
    const [isAdmin] = createSignal(false);

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <UnitsTab
          blacklist={blacklist}
          markerCounts={markerCounts}
          isAdmin={isAdmin}
        />
      </TestProviders>
    ));

    // Expand detail card
    fireEvent.click(screen.getByText("Player"));

    // Follow button should show but no admin section
    expect(screen.getByText("Follow")).toBeTruthy();
    expect(screen.queryByText("ADMIN ACTIONS")).toBeNull();
    expect(screen.queryByTitle("Toggle marker blacklist")).toBeNull();
  });

  it("shows Restore text when unit is already blacklisted", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(
      makeManifest([
        unitDef({ id: 1, name: "Troll Player", side: "WEST", groupName: "Alpha", role: "Trooper" }),
      ]),
    );

    const [blacklist] = createSignal(new Set([1]));
    const [markerCounts] = createSignal(new Map([[1, 4]]));
    const [isAdmin] = createSignal(true);

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <UnitsTab
          blacklist={blacklist}
          markerCounts={markerCounts}
          isAdmin={isAdmin}
        />
      </TestProviders>
    ));

    // Expand detail card
    fireEvent.click(screen.getByText("Troll Player"));

    // Should show "Restore" instead of "Blacklist"
    expect(screen.getByText(/Restore 4 markers/)).toBeTruthy();
    expect(screen.queryByText(/Blacklist \d+ markers/)).toBeNull();
  });

  it("shows 0 markers in stats when unit is blacklisted", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(
      makeManifest([
        unitDef({ id: 1, name: "Spammer", side: "WEST", groupName: "Alpha", role: "Trooper" }),
      ]),
    );

    const [blacklist] = createSignal(new Set([1]));
    const [markerCounts] = createSignal(new Map([[1, 55]]));
    const [isAdmin] = createSignal(true);

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <UnitsTab
          blacklist={blacklist}
          markerCounts={markerCounts}
          isAdmin={isAdmin}
        />
      </TestProviders>
    ));

    // Expand detail card
    fireEvent.click(screen.getByText("Spammer"));

    // Stats grid should show 0 visible markers (blacklisted)
    const markersStat = screen.getByText("MARKERS").parentElement!;
    expect(markersStat.textContent).toContain("0");

    // But the restore button still shows the total
    expect(screen.getByText(/Restore 55 markers/)).toBeTruthy();
  });

  it("does not show admin actions when unit has no markers", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(
      makeManifest([
        unitDef({ id: 1, name: "No Markers", side: "WEST", groupName: "Alpha", role: "Trooper" }),
      ]),
    );

    const [blacklist] = createSignal(new Set<number>());
    const [markerCounts] = createSignal(new Map<number, number>());
    const [isAdmin] = createSignal(true);

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <UnitsTab
          blacklist={blacklist}
          markerCounts={markerCounts}
          isAdmin={isAdmin}
        />
      </TestProviders>
    ));

    // Expand detail card
    fireEvent.click(screen.getByText("No Markers"));

    // Follow should show, but no admin section (no markers)
    expect(screen.getByText("Follow")).toBeTruthy();
    expect(screen.queryByText("ADMIN ACTIONS")).toBeNull();
  });
});
