import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@solidjs/testing-library";
import { OrbatTab } from "../OrbatTab";
import { createTestEngine, TestProviders, unitDef, vehicleDef } from "../../__tests__/testHelpers";

afterEach(() => {
  cleanup();
});

describe("OrbatTab", () => {
  it("renders a faction tab for a side with units", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording({
      version: 1,
      worldName: "test_world",
      missionName: "test_mission",
      endFrame: 50,
      chunkSize: 300,
      chunkCount: 1,
      captureDelayMs: 1000,
      entities: [
        unitDef({ id: 1, side: "WEST", name: "Alpha 1-1", groupName: "Alpha", role: "leader" }),
        unitDef({ id: 2, side: "WEST", name: "Alpha 1-2", groupName: "Alpha", role: "Rifleman" }),
      ],
      events: [],
      markers: [],
      times: [],
    });

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <OrbatTab />
      </TestProviders>
    ));

    // The faction tab has a label (also shown in the section header).
    expect(screen.getAllByText("BLUFOR").length).toBeGreaterThan(0);
    // The ORBAT group and its members render.
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Alpha 1-1")).toBeTruthy();
    expect(screen.getByText("Alpha 1-2")).toBeTruthy();
  });

  it("shows the leader badge for a group leader", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording({
      version: 1,
      worldName: "test_world",
      missionName: "test_mission",
      endFrame: 50,
      chunkSize: 300,
      chunkCount: 1,
      captureDelayMs: 1000,
      entities: [
        unitDef({ id: 1, side: "WEST", name: "Alpha 1-1", groupName: "Alpha", role: "leader" }),
      ],
      events: [],
      markers: [],
      times: [],
    });

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <OrbatTab />
      </TestProviders>
    ));

    expect(screen.getByText("LEAD")).toBeTruthy();
  });

  it("shows an empty placeholder when the active side has no players", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording({
      version: 1,
      worldName: "test_world",
      missionName: "test_mission",
      endFrame: 50,
      chunkSize: 300,
      chunkCount: 1,
      captureDelayMs: 1000,
      entities: [
        unitDef({ id: 1, side: "EAST", name: "AI", groupName: "EastGrp", role: "", isPlayer: false }),
      ],
      events: [],
      markers: [],
      times: [],
    });

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <OrbatTab />
      </TestProviders>
    ));

    expect(screen.getByText("OPFOR")).toBeTruthy();
    // Empty ORBAT for a faction without players.
    expect(screen.getByText("No player units on this side")).toBeTruthy();
  });

  it("search filters the member list", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording({
      version: 1,
      worldName: "test_world",
      missionName: "test_mission",
      endFrame: 50,
      chunkSize: 300,
      chunkCount: 1,
      captureDelayMs: 1000,
      entities: [
        unitDef({ id: 1, side: "WEST", name: "Alpha 1-1", groupName: "Alpha", role: "leader" }),
        unitDef({ id: 2, side: "WEST", name: "Bravo 2-1", groupName: "Bravo", role: "Rifleman" }),
      ],
      events: [],
      markers: [],
      times: [],
    });

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <OrbatTab />
      </TestProviders>
    ));

    const input = screen.getByPlaceholderText("Search ORBAT...") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "Alpha" } });
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.queryByText("Bravo 2-1")).toBeNull();
  });
});

function orbatManifest(entities: ReturnType<typeof unitDef>[]) {
  return {
    version: 1 as const,
    worldName: "test_world",
    missionName: "test_mission",
    endFrame: 50,
    chunkSize: 300,
    chunkCount: 1,
    captureDelayMs: 1000,
    entities,
    events: [],
    markers: [],
    times: [],
  };
}

describe("OrbatTab search and vehicles", () => {
  it("narrows groups to a member-name hit and keeps only that member", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(orbatManifest([
      unitDef({ id: 1, side: "WEST", name: "Alpha 1-1", groupName: "Alpha", role: "leader" }),
      unitDef({ id: 2, side: "WEST", name: "Alpha 1-2", groupName: "Alpha", role: "Rifleman" }),
      unitDef({ id: 3, side: "WEST", name: "Charlie 3-1", groupName: "Charlie", role: "Medic" }),
    ]));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <OrbatTab />
      </TestProviders>
    ));

    const input = screen.getByPlaceholderText("Search ORBAT...") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "alpha 1-2" } });

    // The member hit keeps its group with only that member, alive recounted.
    expect(screen.getByText("Alpha 1-2")).toBeTruthy();
    expect(screen.queryByText("Alpha 1-1")).toBeNull();
    expect(screen.queryByText("Charlie 3-1")).toBeNull();
    // The group header still reads Alpha, with the recounted strength 1/2.
    expect(screen.getByText("Alpha")).toBeTruthy();
  });

  it("matches a member by role and reports no matches for junk", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(orbatManifest([
      unitDef({ id: 1, side: "WEST", name: "Alpha 1-1", groupName: "Alpha", role: "leader" }),
      unitDef({ id: 2, side: "WEST", name: "Alpha 1-2", groupName: "Alpha", role: "Medic" }),
    ]));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <OrbatTab />
      </TestProviders>
    ));

    const input = screen.getByPlaceholderText("Search ORBAT...") as HTMLInputElement;

    // A role hit keeps only the member carrying it.
    fireEvent.input(input, { target: { value: "medic" } });
    expect(screen.getByText("Alpha 1-2")).toBeTruthy();
    expect(screen.queryByText("Alpha 1-1")).toBeNull();

    fireEvent.input(input, { target: { value: "zzz" } });
    expect(screen.getByText("No groups match this search")).toBeTruthy();
  });

  it("opens on the faction with players, then honours an explicit pick", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(orbatManifest([
      unitDef({ id: 1, side: "EAST", name: "Opfor Lead", groupName: "Bears", role: "leader" }),
      unitDef({ id: 2, side: "WEST", name: "West AI", role: "", isPlayer: false }),
    ]));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <OrbatTab />
      </TestProviders>
    ));

    // The faction with players is preselected, not the first side alphabetically.
    expect(screen.getByText("Opfor Lead")).toBeTruthy();
    expect(screen.queryByText("West AI")).toBeNull();

    // Picking the player-less faction is a deliberate choice and sticks.
    fireEvent.click(screen.getByText("BLUFOR"));
    expect(screen.getByText("No player units on this side")).toBeTruthy();

    // ...and returning to OPFOR works.
    fireEvent.click(screen.getByText("OPFOR"));
    expect(screen.getByText("Opfor Lead")).toBeTruthy();
  });

  it("follows a member when their row is clicked", async () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(orbatManifest([
      unitDef({ id: 1, side: "WEST", name: "Alpha 1-1", groupName: "Alpha", role: "leader" }),
    ]));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <OrbatTab />
      </TestProviders>
    ));

    const follow = vi.spyOn(engine, "followEntity");
    fireEvent.click(screen.getByText("Alpha 1-1"));
    expect(follow).toHaveBeenCalledWith(1);
    follow.mockRestore();
  });

  it("lists vehicles players crewed, searchable by name and by crew", async () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(orbatManifest([
      unitDef({ id: 1, side: "WEST", name: "Driver Dave", groupName: "Alpha", role: "driver" }),
      unitDef({ id: 2, side: "WEST", name: "Gunner Gus", groupName: "Alpha", role: "gunner" }),
      vehicleDef({
        id: 50,
        name: "Hunter",
        side: "WEST",
        startFrame: 0,
        endFrame: 50,
        positions: [
          { position: [300, 400], direction: 90, alive: 1 as const, crewIds: [1, 2] },
        ],
      }),
      vehicleDef({
        id: 51,
        name: "Badger",
        side: "WEST",
        startFrame: 0,
        endFrame: 50,
        positions: [
          { position: [320, 420], direction: 0, alive: 1 as const, crewIds: [1] },
        ],
      }),
    ]));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <OrbatTab />
      </TestProviders>
    ));

    // Occupancy resolves asynchronously.
    await vi.waitFor(() => expect(screen.getByText("Hunter")).toBeTruthy());

    const input = screen.getByPlaceholderText("Search ORBAT...") as HTMLInputElement;

    // By vehicle name.
    fireEvent.input(input, { target: { value: "badger" } });
    expect(screen.getByText("Badger")).toBeTruthy();
    expect(screen.queryByText("Hunter")).toBeNull();

    // By a crew member's name.
    fireEvent.input(input, { target: { value: "gus" } });
    expect(screen.getByText("Hunter")).toBeTruthy();
    expect(screen.queryByText("Badger")).toBeNull();
  });

  it("shows the empty note when no player vehicle exists", async () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(orbatManifest([
      unitDef({ id: 1, side: "WEST", name: "Lone Wolf", groupName: "Alpha", role: "" }),
    ]));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <OrbatTab />
      </TestProviders>
    ));

    await vi.waitFor(() =>
      expect(screen.getByText("No vehicle was crewed by players on this side")).toBeTruthy(),
    );
  });
});
