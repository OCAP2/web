import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { TopBar } from "../components/TopBar";
import type { WorldConfig } from "../../../data/types";
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

function renderTopBar(overrides: Partial<Parameters<typeof TopBar>[0]> = {}) {
  const { engine, renderer } = createTestEngine();
  const [missionName] = createSignal("Test Mission");
  const [mapName] = createSignal("Altis");
  const [duration] = createSignal("01:30:00");
  const [operationId] = createSignal<string | null>("op-123");
  const [operationFilename] = createSignal<string | null>("test-op");
  const [worldConfig] = createSignal<WorldConfig | undefined>(undefined);
  const onInfoClick = vi.fn();
  const onBack = vi.fn();

  const props = {
    missionName,
    mapName,
    duration,
    operationId,
    operationFilename,
    worldConfig,
    onInfoClick,
    onBack,
    ...overrides,
  };

  return { engine, renderer, props, onInfoClick, onBack };
}

describe("TopBar", () => {
  it("shows mission name", () => {
    const { engine, renderer, props } = renderTopBar();
    engine.loadOperation(makeManifest([]));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <TopBar {...props} />
      </TestProviders>
    ));

    expect(screen.getByText("Test Mission")).toBeTruthy();
  });

  it("shows map name", () => {
    const { engine, renderer, props } = renderTopBar();
    engine.loadOperation(makeManifest([]));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <TopBar {...props} />
      </TestProviders>
    ));

    expect(screen.getByText(/Altis/)).toBeTruthy();
  });

  it("shows force indicators for sides with entities", () => {
    const { engine, renderer, props } = renderTopBar();
    engine.loadOperation(
      makeManifest([
        unitDef({ id: 1, name: "NATO 1", side: "WEST", positions: [{ position: [100, 200], direction: 0, alive: 1 }] }),
        unitDef({ id: 2, name: "NATO 2", side: "WEST", positions: [{ position: [100, 200], direction: 0, alive: 0 }] }),
        unitDef({ id: 3, name: "CSAT 1", side: "EAST", positions: [{ position: [100, 200], direction: 0, alive: 1 }] }),
      ]),
    );
    engine.seekTo(0);

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <TopBar {...props} />
      </TestProviders>
    ));

    // BLUFOR indicator should show alive/total
    const bluforIndicator = screen.getByTitle("BLUFOR");
    expect(bluforIndicator).toBeTruthy();

    // OPFOR indicator should exist
    const opforIndicator = screen.getByTitle("OPFOR");
    expect(opforIndicator).toBeTruthy();

    // IND/CIV should NOT exist since there are no GUER/CIV units
    expect(screen.queryByTitle("IND")).toBeNull();
    expect(screen.queryByTitle("CIV")).toBeNull();
  });

  it("info button calls onInfoClick", () => {
    const { engine, renderer, props, onInfoClick } = renderTopBar();
    engine.loadOperation(makeManifest([]));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <TopBar {...props} />
      </TestProviders>
    ));

    const infoBtn = screen.getByTitle("Information");
    fireEvent.click(infoBtn);

    expect(onInfoClick).toHaveBeenCalledOnce();
  });

  it("back button calls onBack", () => {
    const { engine, renderer, props, onBack } = renderTopBar();
    engine.loadOperation(makeManifest([]));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <TopBar {...props} />
      </TestProviders>
    ));

    const backBtn = screen.getByTitle("Back to missions");
    fireEvent.click(backBtn);

    expect(onBack).toHaveBeenCalledOnce();
  });

  it("layer dropdown opens on click", () => {
    const { engine, renderer, props } = renderTopBar();
    engine.loadOperation(makeManifest([]));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <TopBar {...props} />
      </TestProviders>
    ));

    // Dropdown should not be visible initially
    expect(screen.queryByText("Units & vehicles")).toBeNull();

    // Click the layers button
    const layerBtn = screen.getByTitle("Layers");
    fireEvent.click(layerBtn);

    // Dropdown should now show layer items
    expect(screen.getByText("Units & vehicles")).toBeTruthy();
    expect(screen.getByText("Side markers")).toBeTruthy();
    expect(screen.getByText("Briefing markers")).toBeTruthy();
    expect(screen.getByText("Projectiles")).toBeTruthy();
    expect(screen.getByText("Coordinate grid")).toBeTruthy();
  });
});
