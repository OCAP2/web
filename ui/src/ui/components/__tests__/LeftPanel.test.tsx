import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent } from "@solidjs/testing-library";
import { PlaybackEngine } from "../../../playback/engine";
import { MockRenderer } from "../../../renderers/mock-renderer";
import { EngineProvider } from "../../hooks/useEngine";
import { CustomizeProvider } from "../../hooks/useCustomize";
import { I18nProvider } from "../../hooks/useLocale";
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
  groupName: string = "Alpha",
): Unit {
  return new Unit(id, name, "man", 0, 100, side, isPlayer, groupName);
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
      <CustomizeProvider><I18nProvider locale="en"><EngineProvider engine={engine}>
        <LeftPanel />
      </EngineProvider></I18nProvider></CustomizeProvider>
    ));
    expect(getByTestId("left-panel")).toBeDefined();
  });

  it("is hidden when leftPanelVisible is false", () => {
    shortcuts.setLeftPanelVisible(false);
    const { queryByTestId } = render(() => (
      <CustomizeProvider><I18nProvider locale="en"><EngineProvider engine={engine}>
        <LeftPanel />
      </EngineProvider></I18nProvider></CustomizeProvider>
    ));
    expect(queryByTestId("left-panel")).toBeNull();
  });

  it("renders side tabs for all four sides", () => {
    const { getByTestId } = render(() => (
      <CustomizeProvider><I18nProvider locale="en"><EngineProvider engine={engine}>
        <LeftPanel />
      </EngineProvider></I18nProvider></CustomizeProvider>
    ));
    expect(getByTestId("tab-WEST")).toBeDefined();
    expect(getByTestId("tab-EAST")).toBeDefined();
    expect(getByTestId("tab-GUER")).toBeDefined();
    expect(getByTestId("tab-CIV")).toBeDefined();
  });

  it("side tabs show display names with side color classes", () => {
    const { getByTestId } = render(() => (
      <CustomizeProvider><I18nProvider locale="en"><EngineProvider engine={engine}>
        <LeftPanel />
      </EngineProvider></I18nProvider></CustomizeProvider>
    ));
    expect(getByTestId("tab-WEST").textContent).toContain("BLUFOR");
    expect(getByTestId("tab-WEST").textContent).toContain("(0)");
    expect(getByTestId("tab-WEST").className).toContain("blufor");
    expect(getByTestId("tab-EAST").textContent).toContain("OPFOR");
    expect(getByTestId("tab-EAST").className).toContain("opfor");
    expect(getByTestId("tab-GUER").textContent).toContain("IND");
    expect(getByTestId("tab-GUER").className).toContain("ind");
    expect(getByTestId("tab-CIV").textContent).toContain("CIV");
    expect(getByTestId("tab-CIV").className).toContain("civ");
  });

  it("side tabs are at the bottom (after panel content in DOM)", () => {
    const { getByTestId } = render(() => (
      <CustomizeProvider><I18nProvider locale="en"><EngineProvider engine={engine}>
        <LeftPanel />
      </EngineProvider></I18nProvider></CustomizeProvider>
    ));
    const panel = getByTestId("left-panel");
    const content = getByTestId("left-panel-content");
    const tabs = getByTestId("left-panel-tabs");
    const children = Array.from(panel.children);
    expect(children.indexOf(content)).toBeLessThan(children.indexOf(tabs));
  });

  it("shows units after loadOperation without needing a tab click", () => {
    const { getByTestId, queryByTestId } = render(() => (
      <CustomizeProvider><I18nProvider locale="en"><EngineProvider engine={engine}>
        <LeftPanel />
      </EngineProvider></I18nProvider></CustomizeProvider>
    ));

    // No units yet
    expect(queryByTestId("unit-item-1")).toBeNull();

    // Load operation (adds entities + sets endFrame signal)
    engine.loadOperation({
      worldName: "test", missionName: "test", captureDelayMs: 1000,
      frameCount: 101, chunkSize: 300,
      entities: [
        { id: 1, type: "man", name: "Alpha1", side: "WEST", groupName: "Alpha", isPlayer: true, startFrame: 0, endFrame: 100 },
      ],
      events: [],
    });

    // Unit should appear reactively without clicking any tab
    expect(getByTestId("unit-item-1")).toBeDefined();
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
      <CustomizeProvider><I18nProvider locale="en"><EngineProvider engine={engine}>
        <LeftPanel />
      </EngineProvider></I18nProvider></CustomizeProvider>
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
      <CustomizeProvider><I18nProvider locale="en"><EngineProvider engine={engine}>
        <LeftPanel />
      </EngineProvider></I18nProvider></CustomizeProvider>
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
      <CustomizeProvider><I18nProvider locale="en"><EngineProvider engine={engine}>
        <LeftPanel />
      </EngineProvider></I18nProvider></CustomizeProvider>
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

  it("renders player unit name with kill count", () => {
    const unit = createUnit(1, "John", "WEST", true);
    const { getByTestId } = render(() => (
      <CustomizeProvider><EngineProvider engine={engine}>
        <UnitListItem unit={unit} />
      </EngineProvider></CustomizeProvider>
    ));
    expect(getByTestId("unit-item-1").textContent).toBe("John (0)");
  });

  it("renders AI unit name with [AI] suffix and kill count", () => {
    const unit = createUnit(1, "AI_Soldier", "WEST", false);
    const { getByTestId } = render(() => (
      <CustomizeProvider><EngineProvider engine={engine}>
        <UnitListItem unit={unit} />
      </EngineProvider></CustomizeProvider>
    ));
    expect(getByTestId("unit-item-1").textContent).toBe("AI_Soldier [AI] (0)");
  });

  it("shows updated kill count", () => {
    const unit = createUnit(1, "John", "WEST", true);
    unit.killCount = 3;
    const { getByTestId } = render(() => (
      <CustomizeProvider><EngineProvider engine={engine}>
        <UnitListItem unit={unit} />
      </EngineProvider></CustomizeProvider>
    ));
    expect(getByTestId("unit-item-1").textContent).toBe("John (3)");
  });

  it("player units have player class", () => {
    const unit = createUnit(1, "John", "WEST", true);
    const { getByTestId } = render(() => (
      <CustomizeProvider><EngineProvider engine={engine}>
        <UnitListItem unit={unit} />
      </EngineProvider></CustomizeProvider>
    ));
    expect(getByTestId("unit-item-1").className).toContain("player");
  });

  it("AI units do not have player class", () => {
    const unit = createUnit(1, "AI_Soldier", "WEST", false);
    const { getByTestId } = render(() => (
      <CustomizeProvider><EngineProvider engine={engine}>
        <UnitListItem unit={unit} />
      </EngineProvider></CustomizeProvider>
    ));
    expect(getByTestId("unit-item-1").className).not.toContain("player");
  });

  it("calls engine.followEntity on click with correct ID", () => {
    const unit = createUnit(5, "John", "WEST");
    const spy = vi.spyOn(engine, "followEntity");

    const { getByTestId } = render(() => (
      <CustomizeProvider><EngineProvider engine={engine}>
        <UnitListItem unit={unit} />
      </EngineProvider></CustomizeProvider>
    ));

    fireEvent.click(getByTestId("unit-item-5"));
    expect(spy).toHaveBeenCalledWith(5);
  });

  it("highlights the currently followed unit", () => {
    const unit = createUnit(7, "John", "WEST");
    engine.followEntity(7);

    const { getByTestId } = render(() => (
      <CustomizeProvider><EngineProvider engine={engine}>
        <UnitListItem unit={unit} />
      </EngineProvider></CustomizeProvider>
    ));

    expect(getByTestId("unit-item-7").className).toContain("followed");
  });

  it("does not highlight a unit that is not followed", () => {
    const unit = createUnit(7, "John", "WEST");
    // Follow a different unit
    engine.followEntity(99);

    const { getByTestId } = render(() => (
      <CustomizeProvider><EngineProvider engine={engine}>
        <UnitListItem unit={unit} />
      </EngineProvider></CustomizeProvider>
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

  it("groups units by groupName", () => {
    const units = [
      createUnit(1, "Alpha1", "WEST", false, "Alpha"),
      createUnit(2, "Alpha2", "WEST", false, "Alpha"),
      createUnit(3, "Bravo1", "WEST", false, "Bravo"),
    ];

    const { getByTestId } = render(() => (
      <CustomizeProvider><EngineProvider engine={engine}>
        <SideGroup side="WEST" units={units} />
      </EngineProvider></CustomizeProvider>
    ));

    expect(getByTestId("group-Alpha")).toBeDefined();
    expect(getByTestId("group-Bravo")).toBeDefined();
    expect(getByTestId("group-Alpha").textContent).toContain("Alpha");
    expect(getByTestId("group-Bravo").textContent).toContain("Bravo");
  });

  it("renders a UnitListItem for each unit under its group", () => {
    const units = [
      createUnit(1, "Alpha1", "WEST", false, "Alpha"),
      createUnit(2, "Alpha2", "WEST", false, "Alpha"),
      createUnit(3, "Bravo1", "WEST", false, "Bravo"),
    ];

    const { getByTestId } = render(() => (
      <CustomizeProvider><EngineProvider engine={engine}>
        <SideGroup side="WEST" units={units} />
      </EngineProvider></CustomizeProvider>
    ));

    expect(getByTestId("unit-item-1")).toBeDefined();
    expect(getByTestId("unit-item-2")).toBeDefined();
    expect(getByTestId("unit-item-3")).toBeDefined();
    // Alpha units should be inside the Alpha group
    expect(getByTestId("group-Alpha").contains(getByTestId("unit-item-1"))).toBe(true);
    expect(getByTestId("group-Alpha").contains(getByTestId("unit-item-2"))).toBe(true);
    expect(getByTestId("group-Bravo").contains(getByTestId("unit-item-3"))).toBe(true);
  });

  it("sorts groups alphabetically", () => {
    const units = [
      createUnit(1, "Charlie1", "WEST", false, "Charlie"),
      createUnit(2, "Alpha1", "WEST", false, "Alpha"),
      createUnit(3, "Bravo1", "WEST", false, "Bravo"),
    ];

    const { getByTestId } = render(() => (
      <CustomizeProvider><EngineProvider engine={engine}>
        <SideGroup side="WEST" units={units} />
      </EngineProvider></CustomizeProvider>
    ));

    const sideGroup = getByTestId("side-group-WEST");
    const groups = sideGroup.querySelectorAll("[data-testid^='group-']");
    expect(groups[0].getAttribute("data-testid")).toBe("group-Alpha");
    expect(groups[1].getAttribute("data-testid")).toBe("group-Bravo");
    expect(groups[2].getAttribute("data-testid")).toBe("group-Charlie");
  });

  it("renders empty list when no units", () => {
    const { getByTestId } = render(() => (
      <CustomizeProvider><EngineProvider engine={engine}>
        <SideGroup side="EAST" units={[]} />
      </EngineProvider></CustomizeProvider>
    ));

    const sideGroup = getByTestId("side-group-EAST");
    expect(sideGroup.children.length).toBe(0);
  });
});
