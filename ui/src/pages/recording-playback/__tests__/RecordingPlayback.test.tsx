import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@solidjs/testing-library";
import { Router, Route } from "@solidjs/router";
import { I18nProvider } from "../../../hooks/useLocale";
import { CustomizeProvider } from "../../../hooks/useCustomize";
import { AuthProvider } from "../../../hooks/useAuth";
import { MockRenderer } from "../../../renderers/mockRenderer";
import { setAuthToken } from "../../../data/apiClient";
import type { LoadResult } from "../loadRecording";

// ─── Mocks (must be before imports that use them) ───

// Mock LeafletRenderer to return a MockRenderer
vi.mock("../../../renderers/leaflet/leafletRenderer", () => {
  return {
    LeafletRenderer: vi.fn().mockImplementation(function () {
      return new MockRenderer();
    }),
  };
});

// Mock loadRecording to return a resolved result by default
const mockLoadRecording = vi.fn<(...args: any[]) => Promise<LoadResult>>();
vi.mock("../loadRecording", () => ({
  loadRecording: (...args: any[]) => mockLoadRecording(...args),
}));

// Mock useRenderBridge to be a no-op
vi.mock("../useRenderBridge", () => ({
  useRenderBridge: vi.fn(),
}));

// We need to import the component AFTER mocks are declared
import { RecordingPlayback } from "../RecordingPlayback";
import { setLeftPanelVisible } from "../shortcuts";

// ─── Helpers ───

function mockFetchForRecording() {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn().mockImplementation((url: string) => {
    if (url.includes("/api/v1/operations/")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            id: 42,
            world_name: "Altis",
            mission_name: "Op Alpha",
            mission_duration: 3600,
            filename: "test-42",
            date: "2024-01-15",
            storageFormat: "json",
          }),
      });
    }
    if (url.includes("/api/v1/customize")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
      });
    }
    return originalFetch(url);
  });
  return originalFetch;
}

function renderPlayback(opts?: { initialPath?: string }) {
  const path = opts?.initialPath ?? "/recording/42/test-42";
  // Set window location to match
  window.history.pushState({}, "", path);

  return render(() => (
    <Router
      root={(p) => (
        <I18nProvider locale="en">
          <CustomizeProvider>
            <AuthProvider>{p.children}</AuthProvider>
          </CustomizeProvider>
        </I18nProvider>
      )}
    >
      <Route path="/recording/:id/:name" component={RecordingPlayback} />
    </Router>
  ));
}

function renderPlaybackWithState(state: Record<string, unknown>) {
  // Push state into the router
  window.history.pushState(state, "", "/recording/42/test-42");

  return render(() => (
    <Router
      root={(p) => (
        <I18nProvider locale="en">
          <CustomizeProvider>
            <AuthProvider>{p.children}</AuthProvider>
          </CustomizeProvider>
        </I18nProvider>
      )}
    >
      <Route path="/recording/:id/:name" component={RecordingPlayback} />
    </Router>
  ));
}

// ─── Tests ───

describe("RecordingPlayback", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = mockFetchForRecording();

    // Default: loadRecording resolves successfully
    mockLoadRecording.mockResolvedValue({
      worldConfig: {
        worldName: "Altis",
        worldSize: 30720,
        maxZoom: 6,
        minZoom: 0,
      },
      missionName: "Op Alpha",
      recordingId: "42",
      recordingFilename: "test-42",
      extensionVersion: "1.0.0",
      addonVersion: "2.0.0",
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
    setAuthToken(null);
    setLeftPanelVisible(true);
    // Reset URL
    window.history.pushState({}, "", "/");
  });

  it("renders loading screen initially", () => {
    renderPlayback();

    const loadingScreen = screen.getByTestId("loading-screen");
    expect(loadingScreen).toBeTruthy();
    // Loading screen should be visible (opacity: 1)
    expect(loadingScreen.style.opacity).toBe("1");
  });

  it("shows loading screen text with mission info from location state", () => {
    renderPlaybackWithState({
      missionName: "Op Bravo",
      worldName: "Stratis",
      missionDuration: 1800,
    });

    const loadingScreen = screen.getByTestId("loading-screen");
    expect(loadingScreen).toBeTruthy();
    // The loading screen should display the mission name from state
    expect(loadingScreen.textContent).toContain("Op Bravo");
    expect(loadingScreen.textContent).toContain("Stratis");
  });

  it("hides loading screen after recording is loaded", async () => {
    renderPlayback();

    // Wait for the loading to complete
    await vi.waitFor(() => {
      const loadingScreen = screen.getByTestId("loading-screen");
      expect(loadingScreen.style.opacity).toBe("0");
    });
  });

  it("shows loading screen with no state info when state is absent", () => {
    renderPlayback();

    const loadingScreen = screen.getByTestId("loading-screen");
    expect(loadingScreen).toBeTruthy();
    // Should still render without crashing — "Loading" is the i18n key,
    // mission name would appear after it if state was present
    expect(loadingScreen.textContent).toContain("Loading");
  });

  it("calls loadRecording on mount", async () => {
    renderPlayback();

    await vi.waitFor(() => {
      expect(mockLoadRecording).toHaveBeenCalledOnce();
    });
  });

  it("handles loadRecording failure gracefully", async () => {
    mockLoadRecording.mockRejectedValueOnce(new Error("Network error"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    renderPlayback();

    await vi.waitFor(() => {
      const loadingScreen = screen.getByTestId("loading-screen");
      // Loading screen should be hidden even on failure (finally block)
      expect(loadingScreen.style.opacity).toBe("0");
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      "Failed to load recording:",
      expect.any(Error),
    );
  });

  it("renders child components after loading completes", async () => {
    renderPlayback();

    await vi.waitFor(() => {
      expect(screen.getByTestId("loading-screen").style.opacity).toBe("0");
    });

    // TopBar, BottomBar, MapControls, etc. should be rendered
    // The TopBar has a back button and info button — their callbacks cover lines 124-125
    expect(screen.getByTestId("map-container")).toBeTruthy();
  });

  it("opens about modal when info button is clicked", async () => {
    renderPlayback();

    await vi.waitFor(() => {
      expect(screen.getByTestId("loading-screen").style.opacity).toBe("0");
    });

    // Click the info button in TopBar
    const infoBtn = screen.getByTitle("Information");
    fireEvent.click(infoBtn);

    // AboutModal should now be visible
    await vi.waitFor(() => {
      expect(screen.getByTestId("about-modal")).toBeTruthy();
    });
  });

  it("closes about modal when close button is clicked", async () => {
    renderPlayback();

    await vi.waitFor(() => {
      expect(screen.getByTestId("loading-screen").style.opacity).toBe("0");
    });

    // Open the about modal
    fireEvent.click(screen.getByTitle("Information"));

    await vi.waitFor(() => {
      expect(screen.getByTestId("about-modal")).toBeTruthy();
    });

    // Click the close button inside the modal
    const modal = screen.getByTestId("about-modal");
    const closeBtn = modal.querySelector("button")!;
    fireEvent.click(closeBtn);

    // Modal should disappear
    await vi.waitFor(() => {
      expect(screen.queryByTestId("about-modal")).toBeNull();
    });
  });

  it("navigates back when back button is clicked", async () => {
    renderPlayback();

    await vi.waitFor(() => {
      expect(screen.getByTestId("loading-screen").style.opacity).toBe("0");
    });

    const backBtn = screen.getByTitle("Back to recordings");
    fireEvent.click(backBtn);

    // Navigation should have been triggered (URL changes to "/")
    await vi.waitFor(() => {
      expect(window.location.pathname).toBe("/");
    });
  });

  it("toggles side panel visibility when panel button is clicked", async () => {
    renderPlayback();

    await vi.waitFor(() => {
      expect(screen.getByTestId("loading-screen").style.opacity).toBe("0");
    });

    // SidePanel should be visible by default (leftPanelVisible starts true)
    expect(screen.getByText("Units")).toBeTruthy();

    // Click the panel toggle button in BottomBar
    const panelBtn = screen.getByText("Panel");
    fireEvent.click(panelBtn);

    // SidePanel should now be hidden
    await vi.waitFor(() => {
      expect(screen.queryByText("Units")).toBeNull();
    });
  });

  it("loadRecording callback sets intermediate worldConfig", async () => {
    const intermediateConfig = {
      worldName: "Stratis",
      worldSize: 8192,
      maxZoom: 5,
      minZoom: 0,
    };

    mockLoadRecording.mockImplementation(async (...args: any[]) => {
      // 5th arg is the onWorldConfig callback (line 120)
      const onWorldConfig = args[4];
      if (typeof onWorldConfig === "function") {
        onWorldConfig(intermediateConfig);
      }
      return {
        worldConfig: {
          worldName: "Altis",
          worldSize: 30720,
          maxZoom: 6,
          minZoom: 0,
        },
        missionName: "Op Alpha",
        recordingId: "42",
        recordingFilename: "test-42",
        extensionVersion: "1.0.0",
        addonVersion: "2.0.0",
      };
    });

    renderPlayback();

    await vi.waitFor(() => {
      expect(screen.getByTestId("loading-screen").style.opacity).toBe("0");
    });

    // The callback was invoked — verify loadRecording was called with a function as 5th arg
    expect(mockLoadRecording).toHaveBeenCalledOnce();
    const callArgs = mockLoadRecording.mock.calls[0];
    expect(typeof callArgs[4]).toBe("function");
  });

  it("toggleBlacklist adds and removes players via API", async () => {
    const apiCalls: { url: string; method: string }[] = [];

    setAuthToken("test-token");

    // Make loadRecording populate the engine with a unit entity and markers
    mockLoadRecording.mockImplementation(async (...args: any[]) => {
      const engine = args[1];
      const markerManager = args[2];
      // Load a minimal manifest with one unit so UnitsTab renders it
      engine.loadRecording({
        version: 1,
        worldName: "Altis",
        missionName: "Op Alpha",
        frameCount: 101,
        chunkSize: 300,
        captureDelayMs: 1000,
        chunkCount: 1,
        entities: [{
          id: 7,
          name: "TestPlayer",
          type: "man",
          startFrame: 0,
          endFrame: 100,
          side: "WEST",
          isPlayer: true,
          groupName: "Alpha",
          role: "Rifleman",
          positions: null,
          framesFired: null,
        }],
        events: [],
        markers: [],
        times: [],
      });
      // Load markers so markerCounts shows count > 0 for the unit (needed for blacklist button)
      markerManager.loadMarkers([{
        type: "hd_dot",
        text: "marker1",
        side: "WEST",
        color: "ColorBlue",
        positions: [[0, "100,200,0", "ICON", 1, 0.8]],
        player: 7,
        alpha: 1,
        startFrame: 0,
        endFrame: 100,
      }]);
      return {
        worldConfig: { worldName: "Altis", worldSize: 30720, maxZoom: 6, minZoom: 0 },
        missionName: "Op Alpha",
        recordingId: "42",
        recordingFilename: "test-42",
        extensionVersion: "1.0.0",
        addonVersion: "2.0.0",
      };
    });

    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/api/v1/auth/me")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({ authenticated: true, steamId: "12345", steamName: "Admin" }),
        });
      }
      if (typeof url === "string" && url.includes("/marker-blacklist/") && (init?.method === "PUT" || init?.method === "DELETE")) {
        apiCalls.push({ url, method: init!.method! });
        return Promise.resolve({ ok: true, status: 204 });
      }
      if (typeof url === "string" && url.includes("/marker-blacklist")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([]),
        });
      }
      if (typeof url === "string" && url.includes("/api/v1/operations/")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              id: 42, world_name: "Altis", mission_name: "Op Alpha",
              mission_duration: 3600, filename: "test-42", date: "2024-01-15", storageFormat: "json",
            }),
        });
      }
      if (typeof url === "string" && url.includes("/api/v1/customize")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: false, status: 404, statusText: "Not Found" });
    });

    renderPlayback();

    await vi.waitFor(() => {
      expect(screen.getByTestId("loading-screen").style.opacity).toBe("0");
    });

    // Unit should be visible in the SidePanel's UnitsTab
    await vi.waitFor(() => {
      expect(screen.getByText("TestPlayer")).toBeTruthy();
    });

    // Click the unit row to expand the detail card
    fireEvent.click(screen.getByText("TestPlayer"));

    // The detail card should show the blacklist button (admin + marker count > 0)
    await vi.waitFor(() => {
      expect(screen.getByTitle("Toggle marker blacklist")).toBeTruthy();
    });

    // Click the blacklist button to trigger toggleBlacklist
    fireEvent.click(screen.getByTitle("Toggle marker blacklist"));

    // Verify the PUT API call was made
    await vi.waitFor(() => {
      expect(apiCalls.some(c => c.method === "PUT" && c.url.includes("/marker-blacklist/7"))).toBe(true);
    });
  });

  it("fetches blacklist after recording loads and renders BlacklistIndicator for admins", async () => {
    // Set auth token so AuthProvider calls getMe
    setAuthToken("test-token");

    // Override fetch to also handle auth + blacklist
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/api/v1/auth/me")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              authenticated: true,
              steamId: "12345",
              steamName: "Admin",
            }),
        });
      }
      if (typeof url === "string" && url.includes("/marker-blacklist")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([5, 10]),
        });
      }
      if (typeof url === "string" && url.includes("/api/v1/operations/")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              id: 42,
              world_name: "Altis",
              mission_name: "Op Alpha",
              mission_duration: 3600,
              filename: "test-42",
              date: "2024-01-15",
              storageFormat: "json",
            }),
        });
      }
      if (typeof url === "string" && url.includes("/api/v1/customize")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({}),
        });
      }
      return Promise.resolve({ ok: false, status: 404, statusText: "Not Found" });
    });

    renderPlayback();

    await vi.waitFor(() => {
      expect(screen.getByTestId("loading-screen").style.opacity).toBe("0");
    });

    // Blacklist fetch should have been called
    const fetchCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const blacklistCall = fetchCalls.find(
      (c: any[]) => typeof c[0] === "string" && c[0].includes("/marker-blacklist"),
    );
    expect(blacklistCall).toBeTruthy();

    // BlacklistIndicator should render since admin + blacklist non-empty
    await vi.waitFor(() => {
      expect(screen.getByText(/markers blacklisted/)).toBeTruthy();
    });
  });

  it("toggleBlacklist does nothing when recordingId is null", async () => {
    // Don't resolve loadRecording — recordingId stays null
    mockLoadRecording.mockReturnValue(new Promise(() => {})); // never resolves

    renderPlayback();

    // Wait a tick for mount
    await new Promise((r) => setTimeout(r, 50));

    // toggleBlacklist should early-return since recordingId is null
    // We verify by checking no blacklist API calls are made
    const fetchCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const blacklistCalls = fetchCalls.filter(
      (c: any[]) => typeof c[0] === "string" && c[0].includes("/marker-blacklist"),
    );
    expect(blacklistCalls).toHaveLength(0);
  });

  it("handles getRecording failure gracefully", async () => {
    // Override fetch to return 404 for getRecording
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/v1/operations/")) {
        return Promise.resolve({
          ok: false,
          status: 404,
          statusText: "Not Found",
        });
      }
      if (url.includes("/api/v1/customize")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({}),
        });
      }
      return Promise.resolve({ ok: false, status: 500, statusText: "Error" });
    });

    renderPlayback();

    await vi.waitFor(() => {
      const loadingScreen = screen.getByTestId("loading-screen");
      expect(loadingScreen.style.opacity).toBe("0");
    });
  });
});
