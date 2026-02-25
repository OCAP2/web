import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import { StatsTab } from "../components/StatsTab";
import {
  createTestEngine,
  TestProviders,
  unitDef,
  makeManifest,
  killedEvent,
} from "./testHelpers";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("StatsTab", () => {
  it("shows force cards only for sides with units", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(
      makeManifest([
        unitDef({ id: 1, name: "Alpha", side: "WEST" }),
        unitDef({ id: 2, name: "Bravo", side: "WEST" }),
      ]),
    );

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <StatsTab />
      </TestProviders>
    ));

    expect(screen.getByText("BLUFOR")).toBeTruthy();
    expect(screen.queryByText("OPFOR")).toBeNull();
    expect(screen.queryByText("IND")).toBeNull();
    expect(screen.queryByText("CIV")).toBeNull();
  });

  it("shows alive/total counts in force cards", () => {
    const { engine, renderer } = createTestEngine();
    // Unit 1: alive at frame 0 and 1
    // Unit 2: alive at frame 0, dead at frame 1
    engine.loadRecording(
      makeManifest([
        unitDef({
          id: 1,
          name: "Alpha",
          side: "WEST",
          positions: [
            { position: [100, 200], direction: 0, alive: 1 },
            { position: [100, 200], direction: 0, alive: 1 },
          ],
        }),
        unitDef({
          id: 2,
          name: "Bravo",
          side: "WEST",
          positions: [
            { position: [100, 200], direction: 0, alive: 1 },
            { position: [100, 200], direction: 0, alive: 0 },
          ],
        }),
      ]),
    );
    engine.seekTo(1);

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <StatsTab />
      </TestProviders>
    ));

    // TOTAL and ALIVE labels should be present in the stat grid
    expect(screen.getByText("TOTAL")).toBeTruthy();
    expect(screen.getByText("ALIVE")).toBeTruthy();
    // alive=1 and total=2 appear as stat numbers
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("shows kills and deaths in force cards", () => {
    const { engine, renderer } = createTestEngine();
    const entities = [
      unitDef({
        id: 1,
        name: "Killer",
        side: "WEST",
        positions: Array.from({ length: 10 }, () => ({
          position: [100, 200] as [number, number],
          direction: 0,
          alive: 1 as const,
        })),
        endFrame: 9,
      }),
      unitDef({
        id: 2,
        name: "Victim",
        side: "EAST",
        positions: Array.from({ length: 10 }, () => ({
          position: [300, 400] as [number, number],
          direction: 0,
          alive: 1 as const,
        })),
        endFrame: 9,
      }),
    ];
    // Unit 1 kills Unit 2 at frame 5
    const events = [killedEvent(5, 2, 1, "M4A1", 100)];
    engine.loadRecording(makeManifest(entities, events, 10));
    engine.seekTo(5);

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <StatsTab />
      </TestProviders>
    ));

    // Both sides should show their labels
    expect(screen.getByText("BLUFOR")).toBeTruthy();
    expect(screen.getByText("OPFOR")).toBeTruthy();

    // KILLS and DEATHS labels should be present (one per side card)
    expect(screen.getAllByText("KILLS").length).toBe(2);
    expect(screen.getAllByText("DEATHS").length).toBe(2);

    // BLUFOR has 1 kill, OPFOR has 1 death
    // The kill/death count "1" appears in forceStatNum elements
    const statNums = screen.getAllByText("1");
    expect(statNums.length).toBeGreaterThanOrEqual(2);
  });

  it("shows leaderboard entries sorted by kills", () => {
    const { engine, renderer } = createTestEngine();
    const entities = [
      unitDef({
        id: 1,
        name: "TopKiller",
        side: "WEST",
        positions: Array.from({ length: 20 }, () => ({
          position: [100, 200] as [number, number],
          direction: 0,
          alive: 1 as const,
        })),
        endFrame: 19,
      }),
      unitDef({
        id: 2,
        name: "SecondKiller",
        side: "WEST",
        positions: Array.from({ length: 20 }, () => ({
          position: [100, 200] as [number, number],
          direction: 0,
          alive: 1 as const,
        })),
        endFrame: 19,
      }),
      unitDef({
        id: 3,
        name: "VictimA",
        side: "EAST",
        positions: Array.from({ length: 20 }, () => ({
          position: [300, 400] as [number, number],
          direction: 0,
          alive: 1 as const,
        })),
        endFrame: 19,
      }),
      unitDef({
        id: 4,
        name: "VictimB",
        side: "EAST",
        positions: Array.from({ length: 20 }, () => ({
          position: [300, 400] as [number, number],
          direction: 0,
          alive: 1 as const,
        })),
        endFrame: 19,
      }),
      unitDef({
        id: 5,
        name: "VictimC",
        side: "EAST",
        positions: Array.from({ length: 20 }, () => ({
          position: [300, 400] as [number, number],
          direction: 0,
          alive: 1 as const,
        })),
        endFrame: 19,
      }),
    ];
    const events = [
      killedEvent(5, 3, 1, "M4A1", 100),  // TopKiller kills VictimA
      killedEvent(6, 4, 1, "M4A1", 120),  // TopKiller kills VictimB
      killedEvent(7, 5, 2, "AK-47", 80),  // SecondKiller kills VictimC
    ];
    engine.loadRecording(makeManifest(entities, events, 20));
    engine.seekTo(10);

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <StatsTab />
      </TestProviders>
    ));

    // Leaderboard should be visible
    expect(screen.getByText("LEADERBOARD")).toBeTruthy();
    expect(screen.getByText("TopKiller")).toBeTruthy();
    expect(screen.getByText("SecondKiller")).toBeTruthy();

    // TopKiller (2 kills) should appear before SecondKiller (1 kill)
    const topKillerEl = screen.getByText("TopKiller");
    const secondKillerEl = screen.getByText("SecondKiller");
    const topPos = topKillerEl.compareDocumentPosition(secondKillerEl);
    // DOCUMENT_POSITION_FOLLOWING means secondKiller comes after topKiller in DOM
    expect(topPos & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("hides leaderboard when no kills or deaths", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(
      makeManifest([
        unitDef({ id: 1, name: "Alpha", side: "WEST" }),
        unitDef({ id: 2, name: "Bravo", side: "EAST" }),
      ]),
    );

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <StatsTab />
      </TestProviders>
    ));

    // Force summary should still be visible
    expect(screen.getByText("FORCE SUMMARY")).toBeTruthy();
    // Leaderboard should not appear
    expect(screen.queryByText("LEADERBOARD")).toBeNull();
  });

  it("excludes AI units from leaderboard", () => {
    const { engine, renderer } = createTestEngine();
    const positions = Array.from({ length: 20 }, () => ({
      position: [100, 200] as [number, number],
      direction: 0,
      alive: 1 as const,
    }));
    const entities = [
      unitDef({ id: 1, name: "PlayerKiller", side: "WEST", isPlayer: true, positions, endFrame: 19 }),
      unitDef({ id: 2, name: "AIKiller", side: "WEST", isPlayer: false, positions, endFrame: 19 }),
      unitDef({ id: 3, name: "VictimA", side: "EAST", isPlayer: true, positions, endFrame: 19 }),
      unitDef({ id: 4, name: "VictimB", side: "EAST", isPlayer: true, positions, endFrame: 19 }),
    ];
    const events = [
      killedEvent(5, 3, 1, "M4A1", 100),  // PlayerKiller kills VictimA
      killedEvent(6, 4, 2, "AK-47", 80),  // AIKiller kills VictimB
    ];
    engine.loadRecording(makeManifest(entities, events, 20));
    engine.seekTo(10);

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <StatsTab />
      </TestProviders>
    ));

    // Player should appear in leaderboard, AI should not
    expect(screen.getByText("LEADERBOARD")).toBeTruthy();
    expect(screen.getByText("PlayerKiller")).toBeTruthy();
    expect(screen.queryByText("AIKiller")).toBeNull();
  });

  it("hides leaderboard when only AI units have kills", () => {
    const { engine, renderer } = createTestEngine();
    const positions = Array.from({ length: 20 }, () => ({
      position: [100, 200] as [number, number],
      direction: 0,
      alive: 1 as const,
    }));
    const entities = [
      unitDef({ id: 1, name: "AIKiller", side: "WEST", isPlayer: false, positions, endFrame: 19 }),
      unitDef({ id: 2, name: "AIVictim", side: "EAST", isPlayer: false, positions, endFrame: 19 }),
    ];
    const events = [killedEvent(5, 2, 1, "AK-47", 50)];
    engine.loadRecording(makeManifest(entities, events, 20));
    engine.seekTo(10);

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <StatsTab />
      </TestProviders>
    ));

    // Force summary still shows (AI units count toward totals)
    expect(screen.getByText("FORCE SUMMARY")).toBeTruthy();
    expect(screen.getByText("BLUFOR")).toBeTruthy();
    // Leaderboard hidden because no players have kills/deaths
    expect(screen.queryByText("LEADERBOARD")).toBeNull();
  });

  it("includes AI kills in force summary totals", () => {
    const { engine, renderer } = createTestEngine();
    const positions = Array.from({ length: 20 }, () => ({
      position: [100, 200] as [number, number],
      direction: 0,
      alive: 1 as const,
    }));
    const entities = [
      unitDef({ id: 1, name: "AIKiller", side: "WEST", isPlayer: false, positions, endFrame: 19 }),
      unitDef({ id: 2, name: "Victim", side: "EAST", isPlayer: true, positions, endFrame: 19 }),
    ];
    const events = [killedEvent(5, 2, 1, "AK-47", 50)];
    engine.loadRecording(makeManifest(entities, events, 20));
    engine.seekTo(10);

    const { container } = render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <StatsTab />
      </TestProviders>
    ));

    // Both sides should appear in force summary
    expect(screen.getByText("BLUFOR")).toBeTruthy();
    expect(screen.getByText("OPFOR")).toBeTruthy();
    // KILLS and DEATHS labels should be present (AI kill still counted in force card)
    expect(screen.getAllByText("KILLS").length).toBe(2);
    expect(screen.getAllByText("DEATHS").length).toBe(2);
  });

  it("shows multiple side cards when multiple sides have units", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(
      makeManifest([
        unitDef({ id: 1, name: "BluforGuy", side: "WEST" }),
        unitDef({ id: 2, name: "OpforGuy", side: "EAST" }),
        unitDef({ id: 3, name: "IndGuy", side: "GUER" }),
      ]),
    );

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <StatsTab />
      </TestProviders>
    ));

    expect(screen.getByText("BLUFOR")).toBeTruthy();
    expect(screen.getByText("OPFOR")).toBeTruthy();
    expect(screen.getByText("IND")).toBeTruthy();
    expect(screen.queryByText("CIV")).toBeNull();
  });
});
