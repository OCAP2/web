import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@solidjs/testing-library";
import { OrbatTab } from "../OrbatTab";
import { createTestEngine, TestProviders, unitDef } from "../../__tests__/testHelpers";

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
