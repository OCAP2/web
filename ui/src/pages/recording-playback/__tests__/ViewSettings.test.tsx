import { createSignal } from "solid-js";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { ViewSettings } from "../components/ViewSettings";
import type { TimeMode } from "../../../playback/time";
import type { WorldConfig } from "../../../data/types";
import type { Manifest } from "../../../data/types";
import {
  createTestEngine,
  TestProviders,
  makeManifest,
} from "./testHelpers";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderViewSettings(overrides?: {
  manifest?: Manifest;
  worldConfig?: WorldConfig | undefined;
}) {
  const { engine, renderer } = createTestEngine();
  engine.loadRecording(overrides?.manifest ?? makeManifest([], [], 200));

  const [timeMode, setTimeMode] = createSignal<TimeMode>("elapsed");
  const onTimeMode = vi.fn((mode: TimeMode) => setTimeMode(mode));
  const [worldConfig] = createSignal<WorldConfig | undefined>(
    overrides?.worldConfig,
  );

  const result = render(() => (
    <TestProviders engine={engine} renderer={renderer}>
      <ViewSettings
        timeMode={timeMode}
        onTimeMode={onTimeMode}
        worldConfig={worldConfig}
      />
    </TestProviders>
  ));

  return { engine, renderer, onTimeMode, ...result };
}

function openPanel() {
  const btn = screen.getByTitle("View Settings");
  fireEvent.click(btn);
}

describe("ViewSettings - panel", () => {
  it("opens on click and shows sections", () => {
    renderViewSettings();

    // Panel should be closed initially
    expect(screen.queryByText("MAP LAYERS")).toBeNull();

    openPanel();

    // All sections visible
    expect(screen.getByText("MAP LAYERS")).toBeTruthy();
    expect(screen.getByText("TIME FORMAT")).toBeTruthy();
    expect(screen.getByText("UNIT LABELS")).toBeTruthy();
    expect(screen.getByText("MARKERS")).toBeTruthy();
  });

  it("closes on second click", () => {
    renderViewSettings();
    openPanel();
    expect(screen.getByText("MAP LAYERS")).toBeTruthy();

    // Click again to close
    fireEvent.click(screen.getByTitle("View Settings"));
    expect(screen.queryByText("MAP LAYERS")).toBeNull();
  });

  it("closes when clicking outside", () => {
    renderViewSettings();
    openPanel();
    expect(screen.getByText("MAP LAYERS")).toBeTruthy();

    fireEvent(document, new MouseEvent("pointerdown", { bubbles: true }));
    expect(screen.queryByText("MAP LAYERS")).toBeNull();
  });
});

describe("ViewSettings - map layers", () => {
  it("shows base layer items", () => {
    renderViewSettings();
    openPanel();

    expect(screen.getByText("Units & vehicles")).toBeTruthy();
    expect(screen.getByText("Side markers")).toBeTruthy();
    expect(screen.getByText("Projectiles")).toBeTruthy();
    expect(screen.getByText("Coordinate grid")).toBeTruthy();
  });

  it("toggles a layer via renderer.setLayerVisible", () => {
    const { renderer } = renderViewSettings();
    const spy = vi.spyOn(renderer, "setLayerVisible");
    openPanel();

    fireEvent.click(screen.getByText("Units & vehicles"));
    expect(spy).toHaveBeenCalledWith("entities", false);

    fireEvent.click(screen.getByText("Units & vehicles"));
    expect(spy).toHaveBeenCalledWith("entities", true);
  });

  it("shows MapLibre-specific layers when worldConfig has maplibre", () => {
    renderViewSettings({
      worldConfig: {
        worldName: "Altis",
        worldSize: 30720,
        imageSize: 30720,
        maxZoom: 18,
        minZoom: 10,
        maplibre: true,
      },
    });
    openPanel();

    expect(screen.getByText("Map icons")).toBeTruthy();
    expect(screen.getByText("3D Buildings")).toBeTruthy();
  });
});

describe("ViewSettings - time format", () => {
  it("selects a time mode and calls onTimeMode", () => {
    const manifest = makeManifest([], [], 200);
    manifest.times = [
      {
        frameNum: 0,
        systemTimeUtc: "2024-01-15T12:00:00",
        date: "2035-06-10T05:30:00",
        timeMultiplier: 1,
      },
    ];
    const { onTimeMode } = renderViewSettings({ manifest });
    openPanel();

    fireEvent.click(screen.getByText("In-Game World Time"));
    expect(onTimeMode).toHaveBeenCalledWith("mission");
  });

  it("disables 'system' time mode when no times array", () => {
    renderViewSettings();
    openPanel();

    const systemOption = screen.getByText("Server Time UTC").closest("button")! as HTMLButtonElement;
    expect(systemOption.disabled).toBe(true);
  });

  it("disables 'mission' time mode when no missionDate", () => {
    renderViewSettings();
    openPanel();

    const missionOption = screen.getByText("In-Game World Time").closest("button")! as HTMLButtonElement;
    expect(missionOption.disabled).toBe(true);
  });

  it("enables 'system' time mode when times array is populated", () => {
    const manifest = makeManifest([], [], 200);
    manifest.times = [
      { frameNum: 0, systemTimeUtc: "2024-01-15T12:00:00" },
      { frameNum: 100, systemTimeUtc: "2024-01-15T12:01:40" },
    ];
    renderViewSettings({ manifest });
    openPanel();

    const systemOption = screen.getByText("Server Time UTC").closest("button")! as HTMLButtonElement;
    expect(systemOption.disabled).toBe(false);
  });

  it("enables 'mission' time mode when missionDate is present", () => {
    const manifest = makeManifest([], [], 200);
    manifest.times = [
      {
        frameNum: 0,
        systemTimeUtc: "2024-01-15T12:00:00",
        date: "2035-06-10T05:30:00",
        timeMultiplier: 1,
      },
    ];
    renderViewSettings({ manifest });
    openPanel();

    const missionOption = screen.getByText("In-Game World Time").closest("button")! as HTMLButtonElement;
    expect(missionOption.disabled).toBe(false);
  });

  it("'elapsed' mode is always available", () => {
    renderViewSettings();
    openPanel();

    const elapsedOption = screen.getByText("Recording Time Elapsed").closest("button")! as HTMLButtonElement;
    expect(elapsedOption.disabled).toBe(false);
  });
});

describe("ViewSettings - unit labels", () => {
  it("selects 'All Names' and calls renderer.setNameDisplayMode", () => {
    const { renderer } = renderViewSettings();
    const spy = vi.spyOn(renderer, "setNameDisplayMode");
    openPanel();

    fireEvent.click(screen.getByText("All Names"));
    expect(spy).toHaveBeenCalledWith("all");
  });

  it("selects 'Hide All' and calls renderer.setNameDisplayMode", () => {
    const { renderer } = renderViewSettings();
    const spy = vi.spyOn(renderer, "setNameDisplayMode");
    openPanel();

    fireEvent.click(screen.getByText("Hide All"));
    expect(spy).toHaveBeenCalledWith("none");
  });
});

describe("ViewSettings - markers", () => {
  it("selects 'Markers only' and calls renderer.setMarkerDisplayMode", () => {
    const { renderer } = renderViewSettings();
    const spy = vi.spyOn(renderer, "setMarkerDisplayMode");
    openPanel();

    fireEvent.click(screen.getByText("Markers only"));
    expect(spy).toHaveBeenCalledWith("noLabels");
  });

  it("selects 'Hide markers' and calls renderer.setMarkerDisplayMode", () => {
    const { renderer } = renderViewSettings();
    const spy = vi.spyOn(renderer, "setMarkerDisplayMode");
    openPanel();

    fireEvent.click(screen.getByText("Hide markers"));
    expect(spy).toHaveBeenCalledWith("none");
  });
});
