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
  const [recordingId] = createSignal<string | null>("op-123");
  const [recordingFilename] = createSignal<string | null>("test-op");
  const [worldConfig] = createSignal<WorldConfig | undefined>(undefined);
  const onInfoClick = vi.fn();
  const onBack = vi.fn();

  const props = {
    missionName,
    mapName,
    duration,
    recordingId,
    recordingFilename,
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
    engine.loadRecording(makeManifest([]));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <TopBar {...props} />
      </TestProviders>
    ));

    expect(screen.getByText("Test Mission")).toBeTruthy();
  });

  it("shows map name", () => {
    const { engine, renderer, props } = renderTopBar();
    engine.loadRecording(makeManifest([]));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <TopBar {...props} />
      </TestProviders>
    ));

    expect(screen.getByText(/Altis/)).toBeTruthy();
  });

  it("shows force indicators for sides with entities", () => {
    const { engine, renderer, props } = renderTopBar();
    engine.loadRecording(
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
    engine.loadRecording(makeManifest([]));

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
    engine.loadRecording(makeManifest([]));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <TopBar {...props} />
      </TestProviders>
    ));

    const backBtn = screen.getByTitle("Back to recordings");
    fireEvent.click(backBtn);

    expect(onBack).toHaveBeenCalledOnce();
  });

  it("layer dropdown opens on click", () => {
    const { engine, renderer, props } = renderTopBar();
    engine.loadRecording(makeManifest([]));

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

  it("toggling a layer calls renderer.setLayerVisible", () => {
    const { engine, renderer, props } = renderTopBar();
    engine.loadRecording(makeManifest([]));
    const spy = vi.spyOn(renderer, "setLayerVisible");

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <TopBar {...props} />
      </TestProviders>
    ));

    // Open layer dropdown
    fireEvent.click(screen.getByTitle("Layers"));

    // Click "Units & vehicles" to toggle it off (default is on)
    fireEvent.click(screen.getByText("Units & vehicles"));
    expect(spy).toHaveBeenCalledWith("entities", false);

    // Click again to toggle it back on
    fireEvent.click(screen.getByText("Units & vehicles"));
    expect(spy).toHaveBeenCalledWith("entities", true);
  });

  it("shows MapLibre-specific layers when worldConfig has maplibre", () => {
    const [worldConfig] = createSignal<WorldConfig | undefined>({
      worldName: "Altis",
      worldSize: 30720,
      imageSize: 30720,
      maplibre: true,
    });
    const { engine, renderer, props } = renderTopBar({ worldConfig });
    engine.loadRecording(makeManifest([]));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <TopBar {...props} />
      </TestProviders>
    ));

    fireEvent.click(screen.getByTitle("Layers"));

    // MapLibre-specific layers should appear
    expect(screen.getByText("Map icons")).toBeTruthy();
    expect(screen.getByText("3D Buildings")).toBeTruthy();
  });

  it("share button copies URL to clipboard and shows toast", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });

    const { engine, renderer, props } = renderTopBar();
    engine.loadRecording(makeManifest([]));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <TopBar {...props} />
      </TestProviders>
    ));

    const shareBtn = screen.getByTitle("Share");
    fireEvent.click(shareBtn);

    // clipboard.writeText should have been called with a URL containing the recording ID
    expect(writeTextMock).toHaveBeenCalledOnce();
    const copiedUrl = writeTextMock.mock.calls[0][0] as string;
    expect(copiedUrl).toContain("/recording/op-123/test-op");

    // Wait for the promise to resolve so the toast appears
    await vi.waitFor(() => {
      expect(screen.getByText("Link copied!")).toBeTruthy();
    });
  });

  it("share button does nothing when recordingId is null", () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });

    const [recordingId] = createSignal<string | null>(null);
    const { engine, renderer, props } = renderTopBar({ recordingId });
    engine.loadRecording(makeManifest([]));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <TopBar {...props} />
      </TestProviders>
    ));

    // Share button should not be rendered when recordingId is null
    expect(screen.queryByTitle("Share")).toBeNull();
  });

  it("download link has correct href", () => {
    const { engine, renderer, props } = renderTopBar();
    engine.loadRecording(makeManifest([]));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <TopBar {...props} />
      </TestProviders>
    ));

    const downloadLink = screen.getByTitle("Download") as HTMLAnchorElement;
    expect(downloadLink.tagName).toBe("A");
    expect(downloadLink.getAttribute("href")).toContain("data/test-op.json.gz");
    expect(downloadLink.hasAttribute("download")).toBe(true);
  });

  it("download link falls back to recordingId when filename is null", () => {
    const [recordingFilename] = createSignal<string | null>(null);
    const { engine, renderer, props } = renderTopBar({ recordingFilename });
    engine.loadRecording(makeManifest([]));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <TopBar {...props} />
      </TestProviders>
    ));

    const downloadLink = screen.getByTitle("Download") as HTMLAnchorElement;
    expect(downloadLink.getAttribute("href")).toContain("data/op-123.json.gz");
  });

  it("shows custom branding logo without URL", async () => {
    // Mock fetch to return customize config with a logo but no URL
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/v1/customize")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ websiteLogo: "/custom-logo.png" }),
        });
      }
      return originalFetch(url);
    });

    const { engine, renderer, props } = renderTopBar();
    engine.loadRecording(makeManifest([]));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <TopBar {...props} />
      </TestProviders>
    ));

    // Wait for customize config to load
    await vi.waitFor(() => {
      const img = document.querySelector("img[src='/custom-logo.png']") as HTMLImageElement;
      expect(img).toBeTruthy();
    });

    // Logo should be rendered as a plain img (no link wrapper since no websiteURL)
    const img = document.querySelector("img[src='/custom-logo.png']") as HTMLImageElement;
    expect(img.parentElement?.tagName).not.toBe("A");

    globalThis.fetch = originalFetch;
  });

  it("shows custom branding logo linked to websiteURL", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/v1/customize")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              websiteLogo: "/custom-logo.png",
              websiteURL: "https://example.com",
            }),
        });
      }
      return originalFetch(url);
    });

    const { engine, renderer, props } = renderTopBar();
    engine.loadRecording(makeManifest([]));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <TopBar {...props} />
      </TestProviders>
    ));

    await vi.waitFor(() => {
      const img = document.querySelector("img[src='/custom-logo.png']") as HTMLImageElement;
      expect(img).toBeTruthy();
    });

    // Logo should be wrapped in an anchor pointing to websiteURL
    const img = document.querySelector("img[src='/custom-logo.png']") as HTMLImageElement;
    const link = img.closest("a") as HTMLAnchorElement;
    expect(link).toBeTruthy();
    expect(link.href).toBe("https://example.com/");

    globalThis.fetch = originalFetch;
  });

  it("shows custom header title and subtitle", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/v1/customize")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              headerTitle: "My Server",
              headerSubtitle: "Best Arma Group",
            }),
        });
      }
      return originalFetch(url);
    });

    const { engine, renderer, props } = renderTopBar();
    engine.loadRecording(makeManifest([]));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <TopBar {...props} />
      </TestProviders>
    ));

    await vi.waitFor(() => {
      expect(screen.getByText("My Server")).toBeTruthy();
    });
    expect(screen.getByText("Best Arma Group")).toBeTruthy();

    globalThis.fetch = originalFetch;
  });
});
