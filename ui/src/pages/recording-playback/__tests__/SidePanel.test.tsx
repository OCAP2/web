import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { SidePanel } from "../components/SidePanel";
import {
  createTestEngine,
  TestProviders,
  unitDef,
  makeManifest,
} from "./test-helpers";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SidePanel", () => {
  it("renders three tab buttons (Units, Events, Stats)", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadOperation(makeManifest([unitDef()]));

    const [activeTab] = createSignal("units");

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <SidePanel activeTab={activeTab} onTabChange={() => {}} />
      </TestProviders>
    ));

    expect(screen.getByText("Units")).toBeTruthy();
    expect(screen.getByText("Events")).toBeTruthy();
    expect(screen.getByText("Stats")).toBeTruthy();
  });

  it("calls onTabChange when clicking a tab", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadOperation(makeManifest([unitDef()]));

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
    engine.loadOperation(
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
    engine.loadOperation(
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
});
