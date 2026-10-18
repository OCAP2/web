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
    expect(screen.queryByText("VIRTUAL")).toBeNull();
  });

  it("lists Zeus entities under VIRTUAL", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(
      makeManifest(
        [unitDef({ id: 7, name: "Possessed", side: "EAST", groupName: "AI", role: "Rifleman" })],
        [
          { frameNum: 0, type: "zeusEntity", payload: { curatorId: 90, name: "Danny", playerUid: "7656", bodyUnitId: -1 } },
          { frameNum: 0, type: "zeusCamera", payload: { curatorId: 90, x: 100, y: 200, dir: 0, fov: 0.75 } },
        ],
      ),
    );

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <UnitsTab />
      </TestProviders>
    ));

    expect(screen.getByText("VIRTUAL")).toBeTruthy();
    fireEvent.click(screen.getByText("VIRTUAL"));
    expect(screen.getByText("Danny")).toBeTruthy();
  });

  it("shows Zeus occupancy as name controlling unit (type)", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(
      makeManifest(
        [unitDef({ id: 7, name: "Bakunin", side: "EAST", groupName: "AI", role: "Man" })],
        [
          { frameNum: 0, type: "zeusEntity", payload: { curatorId: 90, name: "Danny", playerUid: "7656", bodyUnitId: -1 } },
          { frameNum: 0, type: "zeusCamera", payload: { curatorId: 90, x: 100, y: 200, dir: 0, fov: 0.75 } },
          { frameNum: 0, type: "zeusRemoteControl", payload: { curatorId: 90, unitId: 7, active: true, playerName: "Danny" } },
        ],
      ),
    );
    engine.seekTo(0);

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <UnitsTab />
      </TestProviders>
    ));

    fireEvent.click(screen.getByText("VIRTUAL"));
    expect(screen.getByText("Danny controlling Bakunin (Rifleman)")).toBeTruthy();
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
    expect(screen.getByText(/kills/i)).toBeTruthy();
    expect(screen.getByText(/deaths/i)).toBeTruthy();
    expect(screen.getByText(/markers/i)).toBeTruthy();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByText(/weight/i)).toBeNull();
    expect(screen.queryByText("Stamina")).toBeNull();
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

  it("styles a despawned unit (no kill event) as inactive", () => {
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

    engine.seekTo(1);

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <UnitsTab />
      </TestProviders>
    ));

    // Unit despawned without a kill event → inactive styling, not dead
    const deletedRow = screen.getByText("Deleted Unit").closest("button");
    expect(deletedRow?.className).toMatch(/unitRowInactive/);
    expect(deletedRow?.className).not.toMatch(/unitRowDead/);
  });

  it("styles a unit killed by a kill event as dead", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(
      makeManifest(
        [
          unitDef({
            id: 1,
            name: "Victim",
            side: "WEST",
            groupName: "Alpha",
            role: "Trooper",
            positions: [
              { position: [100, 200], direction: 0, alive: 1 },
              { position: [100, 200], direction: 0, alive: 0 }, // dead at frame 1
            ],
          }),
          unitDef({
            id: 2,
            name: "Killer",
            side: "EAST",
            groupName: "Bravo",
            role: "Trooper",
            positions: [
              { position: [50, 50], direction: 0, alive: 1 },
              { position: [50, 50], direction: 0, alive: 1 },
            ],
          }),
        ],
        [killedEvent(1, 1, 2)],
      ),
    );

    setActiveSide("WEST");
    engine.seekTo(1);

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <UnitsTab />
      </TestProviders>
    ));

    const row = screen.getByText("Victim").closest("button");
    expect(row?.className).toMatch(/unitRowDead/);
    expect(row?.className).not.toMatch(/unitRowInactive/);
  });

  it("keeps dead styling for a killed unit even after body despawns", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(
      makeManifest(
        [
          unitDef({
            id: 1,
            name: "Victim",
            side: "WEST",
            groupName: "Alpha",
            role: "Trooper",
            endFrame: 3, // body despawns at frame 3
            positions: [
              { position: [100, 200], direction: 0, alive: 1 },
              { position: [100, 200], direction: 0, alive: 0 },
              { position: [100, 200], direction: 0, alive: 0 },
              { position: [100, 200], direction: 0, alive: 0 },
            ],
          }),
          unitDef({
            id: 2,
            name: "Killer",
            side: "EAST",
            groupName: "Bravo",
            role: "Trooper",
            positions: [
              { position: [50, 50], direction: 0, alive: 1 },
              { position: [50, 50], direction: 0, alive: 1 },
            ],
          }),
        ],
        [killedEvent(1, 1, 2)],
      ),
    );

    setActiveSide("WEST");
    engine.seekTo(10); // well beyond endFrame=3, no snapshot for unit 1

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <UnitsTab />
      </TestProviders>
    ));

    // No snapshot but deaths=1 → still dead, not inactive
    const row = screen.getByText("Victim").closest("button");
    expect(row?.className).toMatch(/unitRowDead/);
    expect(row?.className).not.toMatch(/unitRowInactive/);
  });

  it("styles a respawned unit as alive even when they have prior deaths", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(
      makeManifest(
        [
          unitDef({
            id: 1,
            name: "Respawner",
            side: "WEST",
            groupName: "Alpha",
            role: "Trooper",
            positions: [
              { position: [100, 200], direction: 0, alive: 1 },
              { position: [100, 200], direction: 0, alive: 0 }, // killed
              { position: [200, 300], direction: 0, alive: 1 }, // respawned
            ],
          }),
          unitDef({
            id: 2,
            name: "Killer",
            side: "EAST",
            groupName: "Bravo",
            role: "Trooper",
            positions: [
              { position: [50, 50], direction: 0, alive: 1 },
              { position: [50, 50], direction: 0, alive: 1 },
              { position: [50, 50], direction: 0, alive: 1 },
            ],
          }),
        ],
        [killedEvent(1, 1, 2)],
      ),
    );

    setActiveSide("WEST");
    engine.seekTo(2); // respawned frame — alive=1 in snapshot, deaths=1 in events

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <UnitsTab />
      </TestProviders>
    ));

    const row = screen.getByText("Respawner").closest("button");
    // Alive in snapshot takes priority — no dead or inactive class
    expect(row?.className).not.toMatch(/unitRowDead/);
    expect(row?.className).not.toMatch(/unitRowInactive/);
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
    expect(screen.queryByText("VIRTUAL")).toBeNull();
  });

  it("keeps VIRTUAL visible when three combat sides are populated", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(
      makeManifest(
        [
          unitDef({ id: 1, name: "NATO Soldier", side: "WEST", groupName: "Alpha", role: "Trooper" }),
          unitDef({ id: 2, name: "CSAT Soldier", side: "EAST", groupName: "Bravo", role: "Trooper" }),
          unitDef({ id: 3, name: "Guerrilla", side: "GUER", groupName: "Charlie", role: "Fighter" }),
          unitDef({ id: 4, name: "Civilian", side: "CIV", groupName: "Civilians", role: "Civilian" }),
        ],
        [
          { frameNum: 0, type: "zeusEntity", payload: { curatorId: 90, name: "Danny", playerUid: "7656", bodyUnitId: -1 } },
        ],
      ),
    );

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <UnitsTab />
      </TestProviders>
    ));

    expect(screen.getByText("BLUFOR")).toBeTruthy();
    expect(screen.getByText("OPFOR")).toBeTruthy();
    expect(screen.getByText("IND")).toBeTruthy();
    expect(screen.getByText("CIV")).toBeTruthy();
    expect(screen.getByText("VIRTUAL")).toBeTruthy();
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
    expect(screen.getByText(/admin actions/i)).toBeTruthy();
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
    expect(screen.queryByText(/admin actions/i)).toBeNull();
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
    const markersStat = screen.getByText(/^markers$/i).parentElement!;
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
    expect(screen.queryByText(/admin actions/i)).toBeNull();
  });
});
