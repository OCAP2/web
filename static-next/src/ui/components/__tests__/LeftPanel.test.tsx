import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent } from "@solidjs/testing-library";
import { PlaybackEngine } from "../../../playback/engine";
import { MockRenderer } from "../../../renderers/mock-renderer";
import { EngineProvider } from "../../hooks/useEngine";
import { LeftPanel } from "../LeftPanel";
import { UnitListItem } from "../UnitListItem";
import { SideGroup } from "../SideGroup";
import { Unit } from "../../../playback/entities/unit";
import * as shortcuts from "../../shortcuts";

function createEngine(): PlaybackEngine {
  return new PlaybackEngine(new MockRenderer());
}

function createUnit(
  id: number,
  name: string,
  side: "WEST" | "EAST" | "GUER" | "CIV",
  isPlayer: boolean = false,
): Unit {
  return new Unit(id, name, "man", 0, 100, side, isPlayer, "Alpha");
}

describe("LeftPanel", () => {
  let engine: PlaybackEngine;

  beforeEach(() => {
    engine = createEngine();
    // Ensure panel is visible by default
    shortcuts.setLeftPanelVisible(true);
  });

  afterEach(() => {
    cleanup();
  });

  it("renders when leftPanelVisible is true", () => {
    const { getByTestId } = render(() => (
      <EngineProvider engine={engine}>
        <LeftPanel />
      </EngineProvider>
    ));
    expect(getByTestId("left-panel")).toBeDefined();
  });

  it("is hidden when leftPanelVisible is false", () => {
    shortcuts.setLeftPanelVisible(false);
    const { queryByTestId } = render(() => (
      <EngineProvider engine={engine}>
        <LeftPanel />
      </EngineProvider>
    ));
    expect(queryByTestId("left-panel")).toBeNull();
  });

  it("renders side tabs for all four sides", () => {
    const { getByTestId } = render(() => (
      <EngineProvider engine={engine}>
        <LeftPanel />
      </EngineProvider>
    ));
    expect(getByTestId("tab-WEST")).toBeDefined();
    expect(getByTestId("tab-EAST")).toBeDefined();
    expect(getByTestId("tab-GUER")).toBeDefined();
    expect(getByTestId("tab-CIV")).toBeDefined();
  });

  it("shows correct unit counts per side tab", () => {
    // Add units to different sides
    engine.entityManager.addEntity({
      id: 1, type: "man", name: "Alpha1", side: "WEST",
      groupName: "Alpha", isPlayer: true, startFrame: 0, endFrame: 100,
    });
    engine.entityManager.addEntity({
      id: 2, type: "man", name: "Alpha2", side: "WEST",
      groupName: "Alpha", isPlayer: false, startFrame: 0, endFrame: 100,
    });
    engine.entityManager.addEntity({
      id: 3, type: "man", name: "Bravo1", side: "EAST",
      groupName: "Bravo", isPlayer: false, startFrame: 0, endFrame: 100,
    });

    const { getByTestId } = render(() => (
      <EngineProvider engine={engine}>
        <LeftPanel />
      </EngineProvider>
    ));

    expect(getByTestId("tab-WEST").textContent).toContain("2");
    expect(getByTestId("tab-EAST").textContent).toContain("1");
    expect(getByTestId("tab-GUER").textContent).toContain("0");
    expect(getByTestId("tab-CIV").textContent).toContain("0");
  });

  it("renders correct number of units for the active side tab", () => {
    engine.entityManager.addEntity({
      id: 1, type: "man", name: "Alpha1", side: "WEST",
      groupName: "Alpha", isPlayer: true, startFrame: 0, endFrame: 100,
    });
    engine.entityManager.addEntity({
      id: 2, type: "man", name: "Alpha2", side: "WEST",
      groupName: "Alpha", isPlayer: false, startFrame: 0, endFrame: 100,
    });
    engine.entityManager.addEntity({
      id: 3, type: "man", name: "Bravo1", side: "EAST",
      groupName: "Bravo", isPlayer: false, startFrame: 0, endFrame: 100,
    });

    const { getByTestId } = render(() => (
      <EngineProvider engine={engine}>
        <LeftPanel />
      </EngineProvider>
    ));

    // Default tab is WEST, so we should see 2 unit items
    expect(getByTestId("unit-item-1")).toBeDefined();
    expect(getByTestId("unit-item-2")).toBeDefined();
  });

  it("switches side tab on click and shows correct units", async () => {
    engine.entityManager.addEntity({
      id: 1, type: "man", name: "Alpha1", side: "WEST",
      groupName: "Alpha", isPlayer: true, startFrame: 0, endFrame: 100,
    });
    engine.entityManager.addEntity({
      id: 3, type: "man", name: "Bravo1", side: "EAST",
      groupName: "Bravo", isPlayer: false, startFrame: 0, endFrame: 100,
    });

    const { getByTestId, queryByTestId } = render(() => (
      <EngineProvider engine={engine}>
        <LeftPanel />
      </EngineProvider>
    ));

    // Click EAST tab
    fireEvent.click(getByTestId("tab-EAST"));

    // Now EAST unit should be visible, WEST unit should not
    expect(getByTestId("unit-item-3")).toBeDefined();
    expect(queryByTestId("unit-item-1")).toBeNull();
  });

  it("does not include vehicles in the unit list", () => {
    engine.entityManager.addEntity({
      id: 1, type: "man", name: "Alpha1", side: "WEST",
      groupName: "Alpha", isPlayer: true, startFrame: 0, endFrame: 100,
    });
    engine.entityManager.addEntity({
      id: 2, type: "car", name: "Humvee", side: "WEST",
      groupName: "Alpha", isPlayer: false, startFrame: 0, endFrame: 100,
    });

    const { getByTestId, queryByTestId } = render(() => (
      <EngineProvider engine={engine}>
        <LeftPanel />
      </EngineProvider>
    ));

    expect(getByTestId("unit-item-1")).toBeDefined();
    expect(queryByTestId("unit-item-2")).toBeNull();
  });
});

describe("UnitListItem", () => {
  let engine: PlaybackEngine;

  beforeEach(() => {
    engine = createEngine();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders unit name", () => {
    const unit = createUnit(1, "John", "WEST");
    const { getByTestId } = render(() => (
      <EngineProvider engine={engine}>
        <UnitListItem unit={unit} />
      </EngineProvider>
    ));
    expect(getByTestId("unit-item-1").textContent).toBe("John");
  });

  it("player units have player class", () => {
    const unit = createUnit(1, "John", "WEST", true);
    const { getByTestId } = render(() => (
      <EngineProvider engine={engine}>
        <UnitListItem unit={unit} />
      </EngineProvider>
    ));
    expect(getByTestId("unit-item-1").className).toContain("player");
  });

  it("AI units do not have player class", () => {
    const unit = createUnit(1, "AI_Soldier", "WEST", false);
    const { getByTestId } = render(() => (
      <EngineProvider engine={engine}>
        <UnitListItem unit={unit} />
      </EngineProvider>
    ));
    expect(getByTestId("unit-item-1").className).not.toContain("player");
  });

  it("applies side CSS class", () => {
    const westUnit = createUnit(1, "John", "WEST");
    const eastUnit = createUnit(2, "Ivan", "EAST");
    const guerUnit = createUnit(3, "Stavros", "GUER");
    const civUnit = createUnit(4, "Civilian", "CIV");

    const { getByTestId } = render(() => (
      <EngineProvider engine={engine}>
        <UnitListItem unit={westUnit} />
        <UnitListItem unit={eastUnit} />
        <UnitListItem unit={guerUnit} />
        <UnitListItem unit={civUnit} />
      </EngineProvider>
    ));

    expect(getByTestId("unit-item-1").className).toContain("blufor");
    expect(getByTestId("unit-item-2").className).toContain("opfor");
    expect(getByTestId("unit-item-3").className).toContain("ind");
    expect(getByTestId("unit-item-4").className).toContain("civ");
  });

  it("calls engine.followEntity on click with correct ID", () => {
    const unit = createUnit(5, "John", "WEST");
    const spy = vi.spyOn(engine, "followEntity");

    const { getByTestId } = render(() => (
      <EngineProvider engine={engine}>
        <UnitListItem unit={unit} />
      </EngineProvider>
    ));

    fireEvent.click(getByTestId("unit-item-5"));
    expect(spy).toHaveBeenCalledWith(5);
  });

  it("highlights the currently followed unit", () => {
    const unit = createUnit(7, "John", "WEST");
    engine.followEntity(7);

    const { getByTestId } = render(() => (
      <EngineProvider engine={engine}>
        <UnitListItem unit={unit} />
      </EngineProvider>
    ));

    expect(getByTestId("unit-item-7").className).toContain("followed");
  });

  it("does not highlight a unit that is not followed", () => {
    const unit = createUnit(7, "John", "WEST");
    // Follow a different unit
    engine.followEntity(99);

    const { getByTestId } = render(() => (
      <EngineProvider engine={engine}>
        <UnitListItem unit={unit} />
      </EngineProvider>
    ));

    expect(getByTestId("unit-item-7").className).not.toContain("followed");
  });
});

describe("SideGroup", () => {
  let engine: PlaybackEngine;

  beforeEach(() => {
    engine = createEngine();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders side header with unit count", () => {
    const units = [
      createUnit(1, "Alpha1", "WEST"),
      createUnit(2, "Alpha2", "WEST"),
    ];

    const { getByTestId } = render(() => (
      <EngineProvider engine={engine}>
        <SideGroup side="WEST" units={units} />
      </EngineProvider>
    ));

    const header = getByTestId("side-group-header-WEST");
    expect(header.textContent).toContain("WEST");
    expect(header.textContent).toContain("2");
  });

  it("renders a UnitListItem for each unit", () => {
    const units = [
      createUnit(1, "Alpha1", "WEST"),
      createUnit(2, "Alpha2", "WEST"),
      createUnit(3, "Alpha3", "WEST"),
    ];

    const { getByTestId } = render(() => (
      <EngineProvider engine={engine}>
        <SideGroup side="WEST" units={units} />
      </EngineProvider>
    ));

    expect(getByTestId("unit-item-1")).toBeDefined();
    expect(getByTestId("unit-item-2")).toBeDefined();
    expect(getByTestId("unit-item-3")).toBeDefined();
  });

  it("renders empty list when no units", () => {
    const { getByTestId } = render(() => (
      <EngineProvider engine={engine}>
        <SideGroup side="EAST" units={[]} />
      </EngineProvider>
    ));

    const header = getByTestId("side-group-header-EAST");
    expect(header.textContent).toContain("0");
  });
});
