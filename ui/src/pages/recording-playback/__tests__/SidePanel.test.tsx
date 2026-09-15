import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { SidePanel } from "../components/SidePanel";
import {
  createTestEngine,
  TestProviders,
  unitDef,
  makeManifest,
} from "./testHelpers";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SidePanel", () => {
  it("renders every tab button", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(makeManifest([unitDef()]));

    const [activeTab] = createSignal("units");

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <SidePanel activeTab={activeTab} onTabChange={() => {}} />
      </TestProviders>
    ));

    for (const label of ["Units", "Events", "ORBAT", "Comms", "Stats"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  // Five tabs share a panel fixed at 370px, so an inactive label can be
  // truncated to fit. The tooltip is the only place the full name survives, and
  // it is what stops a clipped tab from becoming an unidentifiable icon.
  it("gives every tab a title carrying its full label", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(makeManifest([unitDef()]));

    const [activeTab] = createSignal("units");

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <SidePanel activeTab={activeTab} onTabChange={() => {}} />
      </TestProviders>
    ));

    for (const label of ["Units", "Events", "ORBAT", "Comms", "Stats"]) {
      expect(screen.getByTitle(label)).toBeTruthy();
    }
  });

  it("calls onTabChange when clicking a tab", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(makeManifest([unitDef()]));

    const [activeTab, setActiveTab] = createSignal("units");
    const onTabChange = vi.fn((tab: string) => setActiveTab(tab));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <SidePanel activeTab={activeTab} onTabChange={onTabChange} />
      </TestProviders>
    ));

    fireEvent.click(screen.getByText("Events"));
    expect(onTabChange).toHaveBeenCalledWith("events");

    fireEvent.click(screen.getByText("Stats"));
    expect(onTabChange).toHaveBeenCalledWith("stats");

    fireEvent.click(screen.getByText("Units"));
    expect(onTabChange).toHaveBeenCalledWith("units");
  });

  it("shows UnitsTab content when activeTab is 'units'", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(
      makeManifest([
        unitDef({ id: 1, name: "Soldier", side: "WEST", groupName: "Alpha" }),
      ]),
    );

    const [activeTab] = createSignal("units");

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <SidePanel activeTab={activeTab} onTabChange={() => {}} />
      </TestProviders>
    ));

    // UnitsTab renders side tabs for populated sides
    expect(screen.getByText("BLUFOR")).toBeTruthy();
  });

  it("switches content when activeTab changes", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(
      makeManifest([
        unitDef({ id: 1, name: "Soldier", side: "WEST", groupName: "Alpha" }),
      ]),
    );

    const [activeTab, setActiveTab] = createSignal("units");
    const onTabChange = vi.fn((tab: string) => setActiveTab(tab));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <SidePanel activeTab={activeTab} onTabChange={onTabChange} />
      </TestProviders>
    ));

    // Initially shows UnitsTab content (side tabs)
    expect(screen.getByText("BLUFOR")).toBeTruthy();

    // Click Events tab to switch
    fireEvent.click(screen.getByText("Events"));

    // EventsTab content should now be visible (no-events placeholder since no kill events)
    expect(screen.getByText("No events to display")).toBeTruthy();
    // UnitsTab side tabs should no longer be rendered
    expect(screen.queryByText("BLUFOR")).toBeNull();
  });

  it("lists a Zeus module event with its recorded English name", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(
      makeManifest(
        [unitDef({ id: 1, name: "Allen", side: "WEST", groupName: "Alpha" })],
        [
          {
            frameNum: 0,
            type: "zeusModule",
            payload: {
              curatorId: 90,
              curatorName: "Danny",
              className: "zen_modules_moduleHeal",
              displayName: "Heal",
              x: 100,
              y: 200,
              attachedName: "Allen",
            },
          },
        ],
      ),
    );

    const [activeTab] = createSignal("events");

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <SidePanel activeTab={activeTab} onTabChange={() => {}} />
      </TestProviders>
    ));

    expect(screen.getByText(/Danny/)).toBeTruthy();
    expect(screen.getByText(/Heal/)).toBeTruthy();
    expect(screen.getByText(/Allen/)).toBeTruthy();
  });

});
